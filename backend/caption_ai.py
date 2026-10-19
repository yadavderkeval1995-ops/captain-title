import asyncio
import json
import logging
import os
import re
import subprocess
import tempfile
import wave
from collections import Counter
from pathlib import Path

import imageio_ffmpeg
from openai import AsyncOpenAI
from sarvamai import AsyncSarvamAI

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
logger = logging.getLogger("captain-title.caption_ai")


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


async def _transcription_pass(audio_path: str, language_code: str, keyterms: list[str] | None = None):
    client = AsyncSarvamAI(api_subscription_key=os.environ["SARVAM_API_KEY"])
    kwargs = {"model": os.environ.get("SARVAM_STT_MODEL", "saaras:v4"), "mode": "codemix",
              "language_code": language_code, "with_timestamps": True}
    if keyterms:
        kwargs["keyterms"] = keyterms
    with open(audio_path, "rb") as audio:
        return await client.speech_to_text.transcribe(file=audio, **kwargs)


def _silence_midpoints(audio_path: str, noise_db: int = -35, min_gap: float = 0.3):
    """Timestamps of natural pauses in the audio, for cutting chunks without slicing through a word."""
    result = subprocess.run([FFMPEG, "-i", audio_path, "-af", f"silencedetect=noise={noise_db}dB:d={min_gap}",
                             "-f", "null", "-"], capture_output=True, text=True)
    starts = [float(value) for value in re.findall(r"silence_start:\s*([\d.]+)", result.stderr)]
    ends = [float(value) for value in re.findall(r"silence_end:\s*([\d.]+)", result.stderr)]
    return [(start + end) / 2 for start, end in zip(starts, ends)]


def _chunk_boundaries(total_duration: float, silence_points: list[float], seconds: int, snap_window: float):
    boundaries = [0.0]
    cursor = 0.0
    while cursor < total_duration:
        target = cursor + seconds
        # Cutting exactly at a fixed interval risks slicing through a word
        # mid-sentence, which both loses that word and resets Whisper's
        # timing reference badly. Snap to the nearest real pause instead.
        nearby = [point for point in silence_points
                 if cursor < point <= min(target + snap_window, total_duration)
                 and point >= target - snap_window]
        boundary = min(nearby, key=lambda point: abs(point - target)) if nearby else min(target, total_duration)
        if boundary <= cursor:
            break
        boundaries.append(boundary)
        cursor = boundary
    return boundaries


def _split_wav(audio_path: str, output_dir: str, seconds: int = 20, snap_window: float = 2.0,
               overlap_seconds: float = 1.5):
    # Sarvam's real-time speech-to-text API hard-caps each request at 30
    # seconds of audio. A chunk's worst case is `seconds + snap_window` of
    # content plus up to `overlap_seconds` of priming audio prepended, so
    # these defaults (20 + 2 + 1.5 = 23.5s) leave a solid safety margin.
    # Whisper is prone to fumbling the opening moment of whatever audio
    # buffer it's handed (a known quirk, not specific to this app). The very
    # first chunk gets a silence lead-in to "warm up" before real content
    # starts. Every later chunk instead gets primed with real overlapping
    # audio from the tail of the previous chunk — genuine acoustic context,
    # not just silence — and any words Whisper re-recognizes from that
    # overlap get dropped by the caller since the previous chunk already
    # produced them.
    lead_in_seconds = 0.5
    silence_points = _silence_midpoints(audio_path)
    with wave.open(audio_path, "rb") as source:
        params = source.getparams()
        total_duration = source.getnframes() / params.framerate
        full_frames = source.readframes(source.getnframes())
    bytes_per_frame = params.sampwidth * params.nchannels

    def frame_slice(start_s, end_s):
        start_frame = max(0, int(round(start_s * params.framerate)))
        end_frame = max(start_frame, int(round(end_s * params.framerate)))
        return full_frames[start_frame * bytes_per_frame:end_frame * bytes_per_frame]

    boundaries = _chunk_boundaries(total_duration, silence_points, seconds, snap_window)
    silence_prefix = b"\x00" * (int(params.framerate * lead_in_seconds) * bytes_per_frame)
    chunks = []
    for index in range(len(boundaries) - 1):
        start, end = boundaries[index], boundaries[index + 1]
        if index == 0:
            prefix, prefix_duration = silence_prefix, lead_in_seconds
        else:
            prefix_start = max(0.0, start - overlap_seconds)
            prefix, prefix_duration = frame_slice(prefix_start, start), start - prefix_start
        path = Path(output_dir) / f"speech-{index}.wav"
        with wave.open(str(path), "wb") as chunk_file:
            chunk_file.setparams(params)
            chunk_file.writeframes(prefix)
            chunk_file.writeframes(frame_slice(start, end))
        chunks.append((str(path), start - prefix_duration, start))
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


def _build_candidate(response, skip_before: float = 0.0):
    timestamps = getattr(response, "timestamps", None)
    words_text = list(timestamps.words) if timestamps else []
    starts = list(timestamps.start_time_seconds) if timestamps else []
    ends = list(timestamps.end_time_seconds) if timestamps else []
    logger.info("Sarvam raw response: transcript=%r words=%r starts=%r ends=%r",
                getattr(response, "transcript", None), words_text, starts, ends)
    words = []
    for text, start, end in zip(words_text, starts, ends):
        text = str(text).strip()
        if not text:
            continue
        words.append({"index": len(words), "original": text, "text": text,
                      "start": float(start), "end": float(end)})
    # Chunks after the first are primed with real overlapping audio from the
    # previous chunk (see _split_wav), so the start of this response is
    # expected to repeat recent words verbatim — that's intentional priming,
    # not a mis-recognition, and must not count against the repetition
    # heuristics below. Score only the genuinely new content.
    scoring_words = [word for word in words if word["start"] >= skip_before] if skip_before else words
    token_list = _tokens(" ".join(word["original"] for word in scoring_words))
    repetition = _repetition_metrics(token_list)
    score = min(.5, len(words) * .01) - repetition["penalty"]
    trustworthy = bool(words)
    if len(token_list) >= 12 and (repetition["unique_ratio"] < .24 or repetition["bigram_ratio"] > .30):
        trustworthy = False
    if repetition["ngram_repeat"] >= 3:
        trustworthy = False
    return {"words": words, "score": score, "trustworthy": trustworthy,
            "unique_ratio": round(repetition["unique_ratio"], 3),
            "bigram_ratio": round(repetition["bigram_ratio"], 3),
            "ngram_repeat": repetition["ngram_repeat"]}


async def transcribe_words(audio_path: str, speech_language: str = "auto"):
    language_code = "hi-IN" if speech_language == "hi" else "unknown"
    selected_chunks = []
    # Carrying a handful of recent words forward as keyterms gives Sarvam
    # continuity across chunk boundaries (consistent spelling of names/terms)
    # instead of transcribing each chunk from a cold start.
    running_keyterms: list[str] = []
    with tempfile.TemporaryDirectory() as temp:
        chunks = _split_wav(audio_path, temp)
        for chunk_path, offset, content_start in chunks:
            skip_before = content_start - offset
            candidate = None
            try:
                response = await _transcription_pass(chunk_path, language_code, running_keyterms)
                candidate = _build_candidate(response, skip_before)
            except Exception:
                logger.exception("Transcription pass failed for chunk %s", chunk_path)
            if not candidate or not candidate["trustworthy"]:
                if candidate:
                    logger.warning(
                        "Chunk %s rejected: score=%.3f unique_ratio=%.3f bigram_ratio=%.3f "
                        "ngram_repeat=%d words=%d",
                        chunk_path, candidate["score"], candidate["unique_ratio"],
                        candidate["bigram_ratio"], candidate["ngram_repeat"], len(candidate["words"]))
                else:
                    logger.warning("Chunk %s produced no candidate at all (pass threw)", chunk_path)
                continue
            for word in candidate["words"]:
                word["start"] = round(word["start"] + offset, 3)
                word["end"] = round(word["end"] + offset, 3)
            # Chunks after the first are primed with real overlapping audio
            # from the previous chunk's tail (for acoustic continuity, not
            # just silence) — drop whatever gets re-recognized from that
            # overlap, since the previous chunk already produced those words.
            candidate["words"] = [word for word in candidate["words"] if word["start"] >= content_start - 0.05]
            selected_chunks.append(candidate)
            if candidate["words"]:
                tail_words = [word["original"] for word in candidate["words"][-40:]]
                seen = set()
                running_keyterms = [word for word in tail_words if not (word in seen or seen.add(word))]
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
        "mode": "sarvam-codemix",
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
    missing = set(range(len(words))) - set(converted)
    if missing:
        # GPT occasionally drops a handful of indices from a long JSON
        # response instead of returning every one as instructed. Falling
        # back to the original Whisper text for just those words (handled
        # below) beats failing the whole video over a partial response.
        logger.warning("Hinglish conversion dropped %d/%d word indices", len(missing), len(words))
    for word in words:
        item = converted.get(word["index"], {})
        word["text"] = str(item.get("text") or word["original"]).strip()
        word["important"] = bool(item.get("important", False))
        word["uncertain"] = bool(item.get("uncertain", False))
    return words