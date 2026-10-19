import asyncio
import json
import logging
import os
import re
import subprocess
import tempfile
import wave
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path

import imageio_ffmpeg
from openai import AsyncOpenAI
from sarvamai import AsyncSarvamAI

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
logger = logging.getLogger("captain-title.caption_ai")


def _as_dict(value):
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return value.__dict__ if hasattr(value, "__dict__") else {}


def _tokens(text: str):
    return re.findall(r"[\wऀ-ॿ]+", text.lower(), flags=re.UNICODE)


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


async def _whisper_pass(audio_path: str, language: str | None, prompt: str = ""):
    """Whisper is used only for its word-level timing, not its text - Sarvam's
    Hindi/Hinglish recognition is far more accurate, but its REST API doesn't
    return per-word timestamps (confirmed in the sarvamai SDK's own docs)."""
    client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
    kwargs = {"model": "whisper-1", "response_format": "verbose_json",
              "temperature": 0.0, "timestamp_granularities": ["word"]}
    if language:
        kwargs["language"] = language
    if prompt:
        kwargs["prompt"] = prompt
    with open(audio_path, "rb") as audio:
        return await client.audio.transcriptions.create(file=audio, **kwargs)


async def _sarvam_pass(audio_path: str, language_code: str, keyterms: list[str] | None = None):
    client = AsyncSarvamAI(api_subscription_key=os.environ["SARVAM_API_KEY"])
    kwargs = {"model": os.environ.get("SARVAM_STT_MODEL", "saaras:v4"), "mode": "codemix",
              "language_code": language_code}
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
        # mid-sentence, which both loses that word and resets the timing
        # reference badly. Snap to the nearest real pause instead.
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
    # not just silence — and any words re-recognized from that overlap get
    # dropped by the caller since the previous chunk already produced them.
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


def _build_whisper_candidate(response, skip_before: float = 0.0):
    """Extract a word-level timing skeleton from Whisper. The recognized
    text itself is discarded later in favor of Sarvam's - this only needs to
    be right about *when* speech happens, not *what* was said."""
    data = _as_dict(response)
    response_segments = getattr(response, "segments", None) or data.get("segments") or []
    accepted_segments = []
    for index, raw_segment in enumerate(response_segments):
        segment = _as_dict(raw_segment)
        text = str(segment.get("text", "")).strip()
        if not text:
            continue
        # Whisper's very first segment of a request often gets an inflated
        # no_speech_prob (it has no preceding audio to calibrate against),
        # so don't let that one false-positive drop real opening speech.
        if index > 0 and float(segment.get("no_speech_prob", 0)) >= 0.65:
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
    scoring_words = [word for word in words if word["start"] >= skip_before] if skip_before else words
    token_list = _tokens(" ".join(word["original"] for word in scoring_words))
    repetition = _repetition_metrics(token_list)
    avg_logs = [float(item.get("avg_logprob", -2)) for item in accepted_segments]
    average_logprob = sum(avg_logs) / len(avg_logs) if avg_logs else (-0.55 if words else -2.0)
    trustworthy = bool(words) and average_logprob > -1.45
    if len(token_list) >= 12 and (repetition["unique_ratio"] < .24 or repetition["bigram_ratio"] > .30):
        trustworthy = False
    if repetition["ngram_repeat"] >= 3:
        trustworthy = False
    return {"words": words, "trustworthy": trustworthy, "average_logprob": round(average_logprob, 3)}


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _align_words(whisper_tokens: list[str], sarvam_tokens: list[str]):
    """Needleman-Wunsch style global alignment between Whisper's and Sarvam's
    word sequences for one chunk, using fuzzy string similarity as the match
    score. Both engines hear the same audio in the same order, so the two
    sequences are usually close to the same length - this lines them up
    positionally and only introduces a skip where they genuinely disagree on
    word count (a word one engine missed or merged), rather than trusting
    either engine's exact spelling to decide the alignment."""
    n, m = len(whisper_tokens), len(sarvam_tokens)
    gap = -0.6
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    choice = [[""] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = dp[i - 1][0] + gap
        choice[i][0] = "skip_whisper"
    for j in range(1, m + 1):
        dp[0][j] = dp[0][j - 1] + gap
        choice[0][j] = "skip_sarvam"
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            match_score = _similarity(whisper_tokens[i - 1], sarvam_tokens[j - 1]) - 0.4
            best_score, best_choice = dp[i - 1][j - 1] + match_score, "match"
            if dp[i - 1][j] + gap > best_score:
                best_score, best_choice = dp[i - 1][j] + gap, "skip_whisper"
            if dp[i][j - 1] + gap > best_score:
                best_score, best_choice = dp[i][j - 1] + gap, "skip_sarvam"
            dp[i][j] = best_score
            choice[i][j] = best_choice
    ops = []
    i, j = n, m
    while i > 0 or j > 0:
        kind = choice[i][j]
        if kind == "match":
            ops.append(("match", i - 1, j - 1)); i -= 1; j -= 1
        elif kind == "skip_whisper":
            ops.append(("skip_whisper", i - 1)); i -= 1
        else:
            ops.append(("skip_sarvam", j - 1)); j -= 1
    ops.reverse()
    return ops


def _emit_interpolated(result: list[dict], texts: list[str], start: float, end: float):
    """Give a run of Sarvam words that Whisper never produced a timing slot
    of its own, by evenly spacing them across the gap between their
    neighboring matched words."""
    end = max(end, start + 0.1)
    step = max(0.08, (end - start) / len(texts))
    for offset, text in enumerate(texts):
        word_start = start + offset * step
        result.append({"original": text, "start": round(word_start, 3), "end": round(min(end, word_start + step), 3)})


def _stitch_chunk(whisper_words: list[dict], sarvam_text: str):
    """Replace Whisper's (less accurate) words with Sarvam's recognized
    words, while keeping Whisper's per-word timing."""
    sarvam_tokens = sarvam_text.split()
    if not whisper_words or not sarvam_tokens:
        return []
    whisper_tokens = [word["original"] for word in whisper_words]
    ops = _align_words(whisper_tokens, sarvam_tokens)
    result = []
    pending: list[str] = []
    last_end = whisper_words[0]["start"]
    for op in ops:
        kind = op[0]
        if kind == "match":
            i, j = op[1], op[2]
            if pending:
                _emit_interpolated(result, pending, last_end, whisper_words[i]["start"])
                pending = []
            result.append({"original": sarvam_tokens[j], "start": whisper_words[i]["start"], "end": whisper_words[i]["end"]})
            last_end = whisper_words[i]["end"]
        elif kind == "skip_whisper":
            # A Whisper word with no Sarvam counterpart - likely a Whisper
            # mis-hearing or hallucination Sarvam didn't reproduce. Drop the
            # word but keep its timing as a continuity anchor.
            last_end = max(last_end, whisper_words[op[1]]["end"])
        else:
            pending.append(sarvam_tokens[op[1]])
    if pending:
        end_anchor = max(whisper_words[-1]["end"], last_end + 0.1 * len(pending))
        _emit_interpolated(result, pending, last_end, end_anchor)
    return result


async def transcribe_words(audio_path: str, speech_language: str = "auto"):
    whisper_language = "hi" if speech_language == "hi" else None
    sarvam_language_code = "hi-IN" if speech_language == "hi" else "unknown"
    selected_chunks = []
    # Carrying recent words forward (as a Whisper prompt and as Sarvam
    # keyterms) gives both engines continuity across chunk boundaries -
    # consistent spelling of names/terms instead of a cold start each time.
    running_prompt = ""
    running_keyterms: list[str] = []
    with tempfile.TemporaryDirectory() as temp:
        chunks = _split_wav(audio_path, temp)
        for chunk_path, offset, content_start in chunks:
            skip_before = content_start - offset
            whisper_candidate = None
            try:
                whisper_response = await _whisper_pass(chunk_path, whisper_language, running_prompt)
                whisper_candidate = _build_whisper_candidate(whisper_response, skip_before)
            except Exception:
                logger.exception("Whisper timing pass failed for chunk %s", chunk_path)
            if not whisper_candidate or not whisper_candidate["trustworthy"] or not whisper_candidate["words"]:
                if whisper_candidate:
                    logger.warning("Chunk %s has no usable timing skeleton: avg_logprob=%.3f words=%d",
                                    chunk_path, whisper_candidate["average_logprob"], len(whisper_candidate["words"]))
                else:
                    logger.warning("Chunk %s produced no Whisper timing candidate (pass threw)", chunk_path)
                continue

            sarvam_text = ""
            try:
                sarvam_response = await _sarvam_pass(chunk_path, sarvam_language_code, running_keyterms)
                sarvam_text = (getattr(sarvam_response, "transcript", "") or "").strip()
            except Exception:
                logger.exception("Sarvam text pass failed for chunk %s", chunk_path)

            # If Sarvam fails for this one chunk, fall back to Whisper's own
            # words rather than losing the chunk entirely.
            stitched = _stitch_chunk(whisper_candidate["words"], sarvam_text) if sarvam_text else []
            if not stitched:
                stitched = whisper_candidate["words"]

            scoring_words = [word for word in stitched if word["start"] >= skip_before]
            token_list = _tokens(" ".join(word["original"] for word in scoring_words))
            repetition = _repetition_metrics(token_list)
            trustworthy = bool(stitched)
            if len(token_list) >= 12 and (repetition["unique_ratio"] < .24 or repetition["bigram_ratio"] > .30):
                trustworthy = False
            if repetition["ngram_repeat"] >= 3:
                trustworthy = False
            if not trustworthy:
                logger.warning("Chunk %s rejected after stitching: unique_ratio=%.3f bigram_ratio=%.3f "
                                "ngram_repeat=%d words=%d", chunk_path, repetition["unique_ratio"],
                                repetition["bigram_ratio"], repetition["ngram_repeat"], len(stitched))
                continue

            for word in stitched:
                word["start"] = round(word["start"] + offset, 3)
                word["end"] = round(word["end"] + offset, 3)
            # Chunks after the first are primed with real overlapping audio
            # from the previous chunk's tail - drop whatever gets
            # re-recognized from that overlap, since the previous chunk
            # already produced those words.
            stitched = [word for word in stitched if word["start"] >= content_start - 0.05]
            selected_chunks.append({"words": stitched})
            if stitched:
                tail_words = [word["original"] for word in stitched[-40:]]
                running_prompt = " ".join(tail_words)[-800:]
                # Sarvam rejects any keyterm containing a comma or semicolon
                # outright ("Send each keyterm as a separate array item"),
                # since those characters are its own delimiter convention -
                # transcript words often carry one as trailing punctuation.
                cleaned_words = [re.sub(r"[,;]", "", word).strip() for word in tail_words]
                seen = set()
                running_keyterms = [word for word in cleaned_words
                                    if word and not (word in seen or seen.add(word))]
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
        "mode": "whisper-timing+sarvam-text",
        "chunks_used": len(selected_chunks),
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
        # back to the original source text for just those words (handled
        # below) beats failing the whole video over a partial response.
        logger.warning("Hinglish conversion dropped %d/%d word indices", len(missing), len(words))
    for word in words:
        item = converted.get(word["index"], {})
        word["text"] = str(item.get("text") or word["original"]).strip()
        word["important"] = bool(item.get("important", False))
        word["uncertain"] = bool(item.get("uncertain", False))
    return words
