"""Boundary-safe Captain Title transcription pipeline.

Public interfaces intentionally match the existing backend module:
    await transcribe_words(audio_path, speech_language)
    await convert_to_hinglish(words, context)
"""
from __future__ import annotations

import asyncio
import audioop
import json
import os
import re
import tempfile
import wave
from collections import Counter
from pathlib import Path

from openai import OpenAI

FULL_AUDIO_LIMIT_SECONDS = 120.0
WINDOW_SECONDS = 55.0
WINDOW_OVERLAP_SECONDS = 2.5


def _client() -> OpenAI:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Missing required environment variable: OPENAI_API_KEY")
    return OpenAI(api_key=key)


def _as_dict(value):
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return value.__dict__ if hasattr(value, "__dict__") else {}


def _tokens(text: str) -> list[str]:
    return re.findall(r"[\w\u0900-\u097f]+", text.lower(), re.UNICODE)


def _token_key(text: str) -> str:
    parts = _tokens(text)
    return "".join(parts)


def _repetition_metrics(tokens: list[str]) -> dict:
    if not tokens:
        return {"unique_ratio": 0.0, "bigram_ratio": 1.0, "ngram_repeat": 99, "penalty": 4.0}
    unique_ratio = len(set(tokens)) / len(tokens)
    bigrams = list(zip(tokens, tokens[1:]))
    common_bigram = Counter(bigrams).most_common(1)[0][1] if bigrams else 0
    fourgrams = list(zip(tokens, tokens[1:], tokens[2:], tokens[3:]))
    repeat4 = Counter(fourgrams).most_common(1)[0][1] if fourgrams else 0
    penalty = (max(0.0, .35 - unique_ratio) * 5 if len(tokens) >= 12 else 0.0)
    penalty += common_bigram / max(1, len(bigrams)) * 3 if common_bigram >= 4 else 0.0
    penalty += 2.5 if repeat4 >= 3 else 0.0
    return {"unique_ratio": unique_ratio, "bigram_ratio": common_bigram / max(1, len(bigrams)),
            "ngram_repeat": repeat4, "penalty": penalty}


def _wav_duration(path: str) -> float:
    with wave.open(path, "rb") as source:
        return source.getnframes() / float(source.getframerate())


def _speech_intervals(path: str, frame_seconds: float = .25, threshold_ratio: float = .08) -> list[tuple[float, float]]:
    """Estimate voiced intervals from PCM energy without adding another runtime dependency."""
    with wave.open(path, "rb") as source:
        rate = source.getframerate()
        width = source.getsampwidth()
        channels = source.getnchannels()
        frame_count = max(1, round(frame_seconds * rate))
        values = []
        index = 0
        while True:
            raw = source.readframes(frame_count)
            if not raw:
                break
            if channels > 1:
                raw = audioop.tomono(raw, width, .5, .5)
            values.append((index * frame_seconds, audioop.rms(raw, width)))
            index += 1
    if not values:
        return []
    peak = max(value for _, value in values) or 1
    threshold = max(120, peak * threshold_ratio)
    voiced = [time for time, value in values if value >= threshold]
    if not voiced:
        return []
    intervals = []
    start = previous = voiced[0]
    for current in voiced[1:]:
        if current - previous > frame_seconds * 2.1:
            intervals.append((max(0.0, start - .25), previous + frame_seconds + .25))
            start = current
        previous = current
    intervals.append((max(0.0, start - .25), previous + frame_seconds + .25))
    return intervals


def _uncovered_speech(words: list[dict], intervals: list[tuple[float, float]],
                      min_seconds: float = 1.0) -> list[tuple[float, float]]:
    missing = []
    for start, end in intervals:
        if end - start < min_seconds:
            continue
        covered = sum(max(0.0, min(end, float(word["end"])) - max(start, float(word["start"])))
                      for word in words)
        if covered < min(.55, (end - start) * .12):
            missing.append((start, end))
    return missing


def _split_overlapping_wav(path: str, output_dir: str, window: float = WINDOW_SECONDS,
                           overlap: float = WINDOW_OVERLAP_SECONDS) -> list[tuple[str, float]]:
    """Create speech-friendly windows with context on both sides of boundaries."""
    chunks = []
    with wave.open(path, "rb") as source:
        params = source.getparams()
        total = source.getnframes()
        window_frames = max(1, round(window * params.framerate))
        stride_frames = max(1, round((window - overlap) * params.framerate))
        start = 0
        index = 0
        while start < total:
            source.setpos(start)
            frames = source.readframes(min(window_frames, total - start))
            target_path = Path(output_dir) / f"speech-{index}.wav"
            with wave.open(str(target_path), "wb") as target:
                target.setparams(params)
                target.writeframes(frames)
            chunks.append((str(target_path), start / params.framerate))
            if start + window_frames >= total:
                break
            start += stride_frames
            index += 1
    return chunks


def _transcription_pass_sync(audio_path: str, language: str | None):
    with open(audio_path, "rb") as audio:
        return _client().audio.transcriptions.create(
            file=audio, model=os.environ.get("OPENAI_TRANSCRIPTION_MODEL", "whisper-1"),
            response_format="verbose_json", language=language, temperature=0.0,
            timestamp_granularities=["word", "segment"],
        )


async def _transcription_pass(audio_path: str, language: str | None):
    return await asyncio.to_thread(_transcription_pass_sync, audio_path, language)


def _build_candidate(response, mode: str, preferred_mode: str) -> dict:
    data = _as_dict(response)
    raw_segments = getattr(response, "segments", None) or data.get("segments") or []
    all_segments = [_as_dict(raw) for raw in raw_segments]
    segments = []
    for item in all_segments:
        if str(item.get("text", "")).strip() and float(item.get("no_speech_prob", 0) or 0) < .65:
            segments.append(item)
    ranges = [(float(s.get("start", 0)), float(s.get("end", 0))) for s in segments]
    raw_words = getattr(response, "words", None) or data.get("words") or []
    words = []
    for raw in raw_words:
        item = _as_dict(raw)
        text = str(item.get("word") or item.get("text") or "").strip()
        start = float(item.get("start", 0) or 0)
        if text and (not ranges or any(a - .1 <= start <= b + .1 for a, b in ranges)):
            words.append({"index": len(words), "original": text, "text": text,
                          "start": start, "end": float(item.get("end", start + .35) or start + .35)})
    tokens = _tokens(" ".join(w["original"] for w in words))
    repetition = _repetition_metrics(tokens)
    logprobs = [float(s.get("avg_logprob", -2) or -2) for s in segments]
    avg_logprob = sum(logprobs) / len(logprobs) if logprobs else (-.55 if words else -2)
    duration = float(getattr(response, "duration", 0) or data.get("duration", 0) or 0)
    last_end = max([float(w["end"]) for w in words] + [0.0])
    coverage = min(1.0, last_end / max(1.0, duration or last_end))
    first_start = min([float(w["start"]) for w in words] + [duration or 0.0])
    leading_gap_penalty = min(2.5, max(0.0, first_start - 1.5) * .16)
    score = (avg_logprob + min(.8, coverage * 1.2) + min(.5, len(words) * .008)
             - repetition["penalty"] - leading_gap_penalty)
    score += .04 if mode == preferred_mode else 0
    trustworthy = bool(words) and avg_logprob > -1.45
    if len(tokens) >= 12 and (repetition["unique_ratio"] < .24 or repetition["bigram_ratio"] > .30):
        trustworthy = False
    if repetition["ngram_repeat"] >= 3:
        trustworthy = False
    segment_metadata = [{"start": float(s.get("start", 0) or 0),
                         "end": float(s.get("end", 0) or 0),
                         "text": str(s.get("text", "")).strip(),
                         "no_speech_prob": float(s.get("no_speech_prob", 0) or 0)}
                        for s in all_segments]
    return {"mode": mode, "words": words, "score": score, "trustworthy": trustworthy,
            "average_logprob": avg_logprob, "coverage": coverage, "first_start": first_start,
            "duration": duration, "segments": segment_metadata}


async def _best_candidate(path: str, speech_language: str) -> tuple[dict | None, bool]:
    primary_language = "hi" if speech_language == "hi" else None
    primary_mode = "hi" if speech_language == "hi" else "auto"
    fallback_language = None if primary_language == "hi" else "hi"
    fallback_mode = "auto" if primary_mode == "hi" else "hi"
    candidates = []
    try:
        candidates.append(_build_candidate(await _transcription_pass(path, primary_language),
                                           primary_mode, primary_mode))
    except Exception:
        pass
    primary = candidates[0] if candidates else None
    used_fallback = not primary or not primary["trustworthy"] or primary["score"] < -.15
    if used_fallback:
        try:
            candidates.append(_build_candidate(await _transcription_pass(path, fallback_language),
                                               fallback_mode, primary_mode))
        except Exception:
            pass
    good = [candidate for candidate in candidates if candidate["trustworthy"]]
    return (max(good, key=lambda candidate: candidate["score"]) if good else None), used_fallback


def _overlap_size(left: list[dict], right: list[dict], limit: int = 12) -> int:
    """Find the longest identical suffix/prefix produced by overlapping ASR calls."""
    maximum = min(limit, len(left), len(right))
    for size in range(maximum, 0, -1):
        if [_token_key(w["original"]) for w in left[-size:]] == [
                _token_key(w["original"]) for w in right[:size]]:
            return size
    return 0


def _merge_window_words(accumulated: list[dict], incoming: list[dict], offset: float) -> list[dict]:
    shifted = [dict(w, start=float(w["start"]) + offset, end=float(w["end"]) + offset) for w in incoming]
    if not accumulated:
        return shifted
    overlap_start = offset
    contextual = [w for w in shifted if w["start"] <= accumulated[-1]["end"] + 1.0]
    size = _overlap_size(accumulated, contextual)
    if size:
        shifted = shifted[size:]
    else:
        # If wording differs, use timestamp ownership at the midpoint of overlap;
        # this avoids duplicate speech without fuzzy-deleting legitimate repeats.
        cutoff = overlap_start + WINDOW_OVERLAP_SECONDS / 2
        accumulated = [w for w in accumulated if w["start"] < cutoff]
        shifted = [w for w in shifted if w["start"] >= cutoff]
    return accumulated + shifted


def _normalize_word_timings(words: list[dict]) -> list[dict]:
    previous_start = 0.0
    for index, word in enumerate(words):
        start = max(float(word["start"]), previous_start)
        end = max(float(word["end"]), start + .06)
        if index + 1 < len(words):
            next_start = float(words[index + 1]["start"])
            if next_start >= start + .06:
                end = min(end, next_start)
        word.update(index=index, start=round(start, 3), end=round(end, 3))
        previous_start = start
    return words


async def transcribe_words(audio_path: str, speech_language: str = "auto"):
    duration = _wav_duration(audio_path)
    windows = [(audio_path, 0.0)]
    strategy = "full-bounded"
    temp = None
    if duration > FULL_AUDIO_LIMIT_SECONDS:
        temp = tempfile.TemporaryDirectory()
        windows = _split_overlapping_wav(audio_path, temp.name)
        strategy = "overlapping-windows"
    words: list[dict] = []
    fallbacks = 0
    selected_count = 0
    try:
        for path, offset in windows:
            selected, used_fallback = await _best_candidate(path, speech_language)
            fallbacks += int(used_fallback)
            if selected is None:
                continue
            selected_count += 1
            words = _merge_window_words(words, selected["words"], offset)
        # Compare transcript timestamps with actual PCM speech energy. This catches
        # omitted opening, middle, and trailing dialogue while allowing real silence.
        speech_intervals = _speech_intervals(audio_path)
        missing_speech = _uncovered_speech(words, speech_intervals)
        if duration <= FULL_AUDIO_LIMIT_SECONDS and (not words or missing_speech):
            recovery = tempfile.TemporaryDirectory()
            try:
                recovered: list[dict] = []
                for path, offset in _split_overlapping_wav(
                        audio_path, recovery.name, window=18.0, overlap=3.0):
                    selected, used_fallback = await _best_candidate(path, speech_language)
                    fallbacks += int(used_fallback)
                    if selected is None:
                        continue
                    selected_count += 1
                    recovered = _merge_window_words(recovered, selected["words"], offset)
                recovered_missing = _uncovered_speech(recovered, speech_intervals)
                if recovered and (not words or len(recovered_missing) < len(missing_speech) or
                                  (len(recovered_missing) == len(missing_speech) and
                                   len(recovered) > len(words) * 1.08)):
                    words = recovered
                    missing_speech = recovered_missing
                    strategy = "speech-gap-recovery"
            finally:
                recovery.cleanup()
    finally:
        if temp:
            temp.cleanup()
    words = _normalize_word_timings(words)
    overall = _repetition_metrics(_tokens(" ".join(w["original"] for w in words)))
    if not words or (len(words) >= 12 and (overall["unique_ratio"] < .24 or
        overall["bigram_ratio"] > .30 or overall["ngram_repeat"] >= 3)):
        raise ValueError("No trustworthy transcript was found. The audio may be unclear, music-heavy, or repetitive.")
    return words, {"mode": strategy, "windows_used": selected_count, "fallbacks": fallbacks,
                   "duration": round(duration, 3), "unique_ratio": round(overall["unique_ratio"], 3),
                   "bigram_ratio": round(overall["bigram_ratio"], 3),
                   "ngram_repeat": overall["ngram_repeat"]}


def _convert_sync(words: list[dict], context: str):
    numbered = "\n".join(f"{w['index']}: {w['original']}" for w in words)
    instructions = (
        "Convert Hindi or mixed Hindi-English speech to exact Roman Hinglish captions. "
        "Correct only obvious phonetic ASR errors. Never paraphrase, omit, merge, split, reorder, or add words. "
        "Return exactly one item per input index with index, text, important, uncertain. "
        "Keep English unchanged. Mark at most 20 percent important and prefer no emphasis when unsure."
    )
    response = _client().responses.create(
        model=os.environ.get("OPENAI_TEXT_MODEL", "gpt-5.6-terra"), instructions=instructions,
        input=f"Video context: {context or 'none'}\nConvert these indexed words:\n{numbered}",
        text={"format": {"type": "json_schema", "name": "hinglish_words", "strict": True,
          "schema": {"type": "object", "properties": {"items": {"type": "array", "items": {
            "type": "object", "properties": {"index": {"type": "integer"}, "text": {"type": "string"},
            "important": {"type": "boolean"}, "uncertain": {"type": "boolean"}},
            "required": ["index", "text", "important", "uncertain"], "additionalProperties": False}}},
            "required": ["items"], "additionalProperties": False}}},
    )
    return json.loads(response.output_text)["items"]


async def convert_to_hinglish(words: list[dict], context: str = ""):
    items = await asyncio.to_thread(_convert_sync, words, context)
    converted = {int(item["index"]): item for item in items}
    expected = {int(word["index"]) for word in words}
    if set(converted) != expected or len(items) != len(words):
        raise ValueError("Hinglish conversion did not preserve every timed word")
    for word in words:
        item = converted[int(word["index"])]
        text = str(item["text"]).strip()
        # One input timed word must remain one output timed word. Reject additions
        # rather than silently accepting hallucinated phrase content.
        if not text or len(text.split()) != 1:
            raise ValueError(f"Hinglish conversion changed word cardinality at index {word['index']}")
        word["text"] = text
        word["important"] = bool(item["important"])
        word["uncertain"] = bool(item["uncertain"])
    return words
