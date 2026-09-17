import asyncio
import json
import os
import re
import tempfile
import wave
from collections import Counter
from pathlib import Path

from openai import AsyncOpenAI


def _as_dict(value):
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return value.__dict__ if hasattr(value, "__dict__") else {}


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


async def _transcription_pass(audio_path: str, language: str | None):
    client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
    kwargs = {"model": "whisper-1", "response_format": "verbose_json",
              "temperature": 0.0, "timestamp_granularities": ["word"]}
    if language:
        kwargs["language"] = language
    with open(audio_path, "rb") as audio:
        return await client.audio.transcriptions.create(file=audio, **kwargs)


def _split_wav(audio_path: str, output_dir: str, seconds: int = 30):
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
    """Keep native alignment while making zero-length API timestamps visible."""
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
        if not text or float(segment.get("no_speech_prob", 0)) >= 0.65:
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
                          "start": float(item.get("start", 0)),
                          "end": float(item.get("end", item.get("start", 0) + .35))})
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
    avg_logs = [float(item.get("avg_logprob", -2)) for item in accepted_segments]
    average_logprob = sum(avg_logs) / len(avg_logs) if avg_logs else (-0.55 if words else -2.0)
    response_duration = float(getattr(response, "duration", 0) or data.get("duration", 0) or 0)
    total_end = max([float(_as_dict(item).get("end", 0)) for item in response_segments] +
                    [float(word["end"]) for word in words] + [response_duration, 0.0])
    speech_duration = (sum(max(0, right - left) for left, right in accepted_ranges)
                       if accepted_ranges else sum(max(0, word["end"] - word["start"]) for word in words))
    coverage = min(1.0, (max([word["end"] for word in words] or [0.0])) / max(1.0, total_end))
    preference_bonus = .04 if mode == preferred_mode else 0.0
    score = average_logprob + min(.8, coverage * 1.2) + min(.5, len(words) * .008) - repetition["penalty"] + preference_bonus
    trustworthy = bool(words) and average_logprob > -1.45
    if len(token_list) >= 12 and (repetition["unique_ratio"] < .24 or repetition["bigram_ratio"] > .30):
        trustworthy = False
    if repetition["ngram_repeat"] >= 3:
        trustworthy = False
    return {"mode": mode, "words": words, "score": score, "trustworthy": trustworthy,
            "average_logprob": round(average_logprob, 3), "speech_coverage": round(coverage, 3),
            "unique_ratio": round(repetition["unique_ratio"], 3),
            "bigram_ratio": round(repetition["bigram_ratio"], 3),
            "ngram_repeat": repetition["ngram_repeat"]}


async def transcribe_words(audio_path: str, speech_language: str = "auto"):
    primary_language = "hi" if speech_language == "hi" else None
    primary_mode = "hi" if speech_language == "hi" else "auto"
    fallback_language = None if primary_language == "hi" else "hi"
    fallback_mode = "auto" if primary_mode == "hi" else "hi"
    selected_chunks = []
    with tempfile.TemporaryDirectory() as temp:
        chunks = _split_wav(audio_path, temp)
        for chunk_path, offset in chunks:
            candidates = []
            try:
                response = await _transcription_pass(chunk_path, primary_language)
                candidates.append(_build_candidate(response, primary_mode, primary_mode))
            except Exception:
                pass
            primary = candidates[0] if candidates else None
            if not primary or not primary["trustworthy"] or primary["score"] < -0.15:
                try:
                    fallback = await _transcription_pass(chunk_path, fallback_language)
                    candidates.append(_build_candidate(fallback, fallback_mode, primary_mode))
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
    if not words or (len(words) >= 12 and (overall["unique_ratio"] < .24 or overall["bigram_ratio"] > .30 or overall["ngram_repeat"] >= 3)):
        raise ValueError("No trustworthy transcript was found. The audio may be unclear, music-heavy, or repetitive.")
    diagnostics = {
        "mode": "adaptive-chunked",
        "chunks_used": len(selected_chunks),
        "score": round(sum(item["score"] for item in selected_chunks) / max(1, len(selected_chunks)), 3),
        "unique_ratio": round(overall["unique_ratio"], 3),
        "bigram_ratio": round(overall["bigram_ratio"], 3),
        "ngram_repeat": overall["ngram_repeat"],
    }
    return words, diagnostics


async def convert_to_hinglish(words: list[dict], context: str = ""):
    numbered = "\n".join(f"{word['index']}: {word['original']}" for word in words)
    system = (
        "You convert Hindi or mixed Hindi-English speech to exact Roman Hinglish captions. "
        "Correct only obvious phonetic ASR spelling errors when the intended Hindi or English word is unambiguous from context. "
        "Never paraphrase, omit, merge, reorder, or add words, and keep one output token per input index. Return only a JSON array. Each item must be "
        "{\"index\": integer, \"text\": romanized_word, \"important\": boolean, \"uncertain\": boolean}. Keep existing English words unchanged. "
        "Set uncertain=true when the ASR source word or surrounding phrase is nonsensical and cannot be corrected confidently. "
        "Mark at most 20 percent as important, choosing emotionally strong or key meaning words."
    )
    client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
    context_line = f"Video context only for resolving product terms: {context}\n" if context else ""
    response = await client.chat.completions.create(
        model=os.environ.get("CAPTION_LLM_MODEL", "gpt-4o"), temperature=0,
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": f"{context_line}Convert these indexed words:\n{numbered}"}])
    raw = (response.choices[0].message.content or "").strip()
    match = re.search(r"\[[\s\S]*\]", raw)
    if not match:
        raise ValueError("Hinglish conversion did not return valid JSON")
    converted = {int(item["index"]): item for item in json.loads(match.group(0))}
    if set(converted) != set(range(len(words))):
        raise ValueError("Hinglish conversion did not preserve every timed word")
    for word in words:
        item = converted.get(word["index"], {})
        word["text"] = str(item.get("text") or word["original"]).strip()
        word["important"] = bool(item.get("important", False))
        word["uncertain"] = bool(item.get("uncertain", False))
    return words