import asyncio
import json
import os
import re
import tempfile
import wave
from collections import Counter
from pathlib import Path

from openai import OpenAI


def _client() -> OpenAI:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Missing required environment variable: OPENAI_API_KEY")
    return OpenAI(api_key=api_key)


def _tokens(text: str):
    return re.findall(r"[\w\u0900-\u097f]+", text.lower(), flags=re.UNICODE)


def _repetition_metrics(tokens: list[str]):
    if not tokens:
        return {"unique_ratio": 0.0, "bigram_ratio": 1.0, "ngram_repeat": 99, "penalty": 4.0}
    unique_ratio = len(set(tokens)) / len(tokens)
    bigrams = list(zip(tokens, tokens[1:]))
    most_common_bigram = Counter(bigrams).most_common(1)[0][1] if bigrams else 0
    bigram_ratio = most_common_bigram / max(1, len(bigrams))
    fourgrams = list(zip(tokens, tokens[1:], tokens[2:], tokens[3:]))
    ngram_repeat = Counter(fourgrams).most_common(1)[0][1] if fourgrams else 0
    penalty = 0.0
    if len(tokens) >= 12 and unique_ratio < 0.35:
        penalty += (0.35 - unique_ratio) * 5
    if most_common_bigram >= 4:
        penalty += bigram_ratio * 3
    if ngram_repeat >= 3:
        penalty += 2.5
    return {"unique_ratio": unique_ratio, "bigram_ratio": bigram_ratio,
            "ngram_repeat": ngram_repeat, "penalty": penalty}


def _transcription_pass_sync(audio_path: str, language: str | None):
    with open(audio_path, "rb") as audio:
        return _client().audio.transcriptions.create(
            file=audio,
            model=os.environ.get("OPENAI_TRANSCRIPTION_MODEL", "whisper-1"),
            response_format="verbose_json",
            language=language,
            temperature=0.0,
            timestamp_granularities=["word", "segment"],
        )


async def _transcription_pass(audio_path: str, language: str | None):
    return await asyncio.to_thread(_transcription_pass_sync, audio_path, language)


def _as_dict(value):
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return value.__dict__ if hasattr(value, "__dict__") else {}


def _split_wav(audio_path: str, output_dir: str, seconds: int = 10):
    chunks = []
    with wave.open(audio_path, "rb") as source:
        params = source.getparams()
        frames_per_chunk = params.framerate * seconds
        offset = 0.0
        index = 0
        while True:
            frames = source.readframes(frames_per_chunk)
            if not frames:
                break
            path = Path(output_dir) / f"speech-{index}.wav"
            with wave.open(str(path), "wb") as target:
                target.setparams(params)
                target.writeframes(frames)
            chunks.append((str(path), offset))
            bytes_per_frame = params.sampwidth * params.nchannels
            frames_read = len(frames) // bytes_per_frame
            offset += frames_read / params.framerate
            index += 1
    return chunks


def _normalize_word_timings(words: list[dict]):
    previous_start = 0.0
    for index, word in enumerate(words):
        start = max(float(word["start"]), previous_start)
        end = max(float(word["end"]), start + 0.06)
        if index + 1 < len(words):
            next_start = float(words[index + 1]["start"])
            if next_start >= start + 0.06:
                end = min(end, next_start)
        word["start"] = round(start, 3)
        word["end"] = round(end, 3)
        previous_start = start
    return words


def _build_candidate(response, mode: str, preferred_mode: str):
    data = _as_dict(response)
    response_segments = getattr(response, "segments", None) or data.get("segments") or []
    accepted_segments = []
    for raw_segment in response_segments:
        segment = _as_dict(raw_segment)
        text = str(segment.get("text", "")).strip()
        if not text or float(segment.get("no_speech_prob", 0) or 0) >= 0.65:
            continue
        accepted_segments.append(segment)
    accepted_ranges = [(float(item.get("start", 0)), float(item.get("end", 0))) for item in accepted_segments]
    source_words = getattr(response, "words", None) or data.get("words") or []
    words = []
    for item in source_words:
        item = _as_dict(item)
        text = (item.get("word") or item.get("text") or "").strip()
        start = float(item.get("start", 0))
        if text and (not accepted_ranges or any(left - .1 <= start <= right + .1 for left, right in accepted_ranges)):
            words.append({"index": len(words), "original": text, "text": text,
                          "start": start, "end": float(item.get("end", start + .35))})
    if not words:
        for segment in accepted_segments:
            tokens = re.findall(r"[^\s]+", str(segment.get("text", "")).strip())
            if not tokens:
                continue
            start = float(segment.get("start", 0)); end = float(segment.get("end", start + .5))
            step = max(.08, (end - start) / len(tokens))
            for offset, text in enumerate(tokens):
                words.append({"index": len(words), "original": text, "text": text,
                              "start": round(start + offset * step, 3),
                              "end": round(min(end, start + (offset + 1) * step), 3)})
    token_list = _tokens(" ".join(word["original"] for word in words))
    repetition = _repetition_metrics(token_list)
    avg_logs = [float(item.get("avg_logprob", -2) or -2) for item in accepted_segments]
    average_logprob = sum(avg_logs) / len(avg_logs) if avg_logs else (-0.55 if words else -2.0)
    response_duration = float(getattr(response, "duration", 0) or data.get("duration", 0) or 0)
    total_end = max([float(_as_dict(item).get("end", 0)) for item in response_segments] +
                    [float(word["end"]) for word in words] + [response_duration, 0.0])
    coverage = min(1.0, max([word["end"] for word in words] or [0.0]) / max(1.0, total_end))
    score = average_logprob + min(.8, coverage * 1.2) + min(.5, len(words) * .008) - repetition["penalty"]
    if mode == preferred_mode:
        score += .04
    trustworthy = bool(words) and average_logprob > -1.45
    if len(token_list) >= 12 and (repetition["unique_ratio"] < .24 or repetition["bigram_ratio"] > .30):
        trustworthy = False
    if repetition["ngram_repeat"] >= 3:
        trustworthy = False
    return {"mode": mode, "words": words, "score": score, "trustworthy": trustworthy}


async def transcribe_words(audio_path: str, speech_language: str = "auto"):
    primary_language = "hi" if speech_language == "hi" else None
    primary_mode = "hi" if speech_language == "hi" else "auto"
    fallback_language = None if primary_language == "hi" else "hi"
    fallback_mode = "auto" if primary_mode == "hi" else "hi"
    selected_chunks = []
    with tempfile.TemporaryDirectory() as temp:
        for chunk_path, offset in _split_wav(audio_path, temp):
            candidates = []
            try:
                candidates.append(_build_candidate(
                    await _transcription_pass(chunk_path, primary_language), primary_mode, primary_mode))
            except Exception:
                pass
            primary = candidates[0] if candidates else None
            if not primary or not primary["trustworthy"] or primary["score"] < -0.15:
                try:
                    candidates.append(_build_candidate(
                        await _transcription_pass(chunk_path, fallback_language), fallback_mode, primary_mode))
                except Exception:
                    pass
            trustworthy = [candidate for candidate in candidates if candidate["trustworthy"]]
            if not trustworthy:
                continue
            selected = max(trustworthy, key=lambda candidate: candidate["score"])
            for word in selected["words"]:
                word["start"] = round(word["start"] + offset, 3)
                word["end"] = round(word["end"] + offset, 3)
            selected_chunks.append(selected)
    words = []
    for selected in selected_chunks:
        for word in selected["words"]:
            word["index"] = len(words)
            words.append(word)
    words = _normalize_word_timings(words)
    overall = _repetition_metrics(_tokens(" ".join(word["original"] for word in words)))
    if not words or (len(words) >= 12 and (
            overall["unique_ratio"] < .24 or overall["bigram_ratio"] > .30 or overall["ngram_repeat"] >= 3)):
        raise ValueError("No trustworthy transcript was found. The audio may be unclear, music-heavy, or repetitive.")
    return words, {"mode": "adaptive-chunked", "chunks_used": len(selected_chunks),
                   "unique_ratio": round(overall["unique_ratio"], 3),
                   "bigram_ratio": round(overall["bigram_ratio"], 3),
                   "ngram_repeat": overall["ngram_repeat"]}


def _convert_sync(words: list[dict], context: str):
    numbered = "\n".join(f"{word['index']}: {word['original']}" for word in words)
    system = (
        "Convert Hindi or mixed Hindi-English speech to exact Roman Hinglish captions. "
        "Correct only obvious phonetic ASR errors. Never paraphrase, omit, merge, reorder, or add words. "
        "Return JSON with a single key named items containing one object per input index. "
        "Each item must contain index, text, important, and uncertain. Keep English words unchanged and "
        "mark at most 20 percent as important."
    )
    response = _client().responses.create(
        model=os.environ.get("OPENAI_TEXT_MODEL", "gpt-5.6-terra"),
        instructions=system,
        input=f"Video context: {context or 'none'}\nConvert these indexed words:\n{numbered}",
        text={"format": {"type": "json_schema", "name": "hinglish_words", "strict": True,
                         "schema": {"type": "object", "properties": {"items": {"type": "array",
                             "items": {"type": "object", "properties": {
                                 "index": {"type": "integer"}, "text": {"type": "string"},
                                 "important": {"type": "boolean"}, "uncertain": {"type": "boolean"}},
                                 "required": ["index", "text", "important", "uncertain"],
                                 "additionalProperties": False}}}, "required": ["items"],
                             "additionalProperties": False}}},
    )
    return json.loads(response.output_text)["items"]


async def convert_to_hinglish(words: list[dict], context: str = ""):
    items = await asyncio.to_thread(_convert_sync, words, context)
    converted = {int(item["index"]): item for item in items}
    if set(converted) != set(range(len(words))):
        raise ValueError("Hinglish conversion did not preserve every timed word")
    for word in words:
        item = converted[word["index"]]
        word["text"] = str(item["text"]).strip()
        word["important"] = bool(item["important"])
        word["uncertain"] = bool(item["uncertain"])
    return words
