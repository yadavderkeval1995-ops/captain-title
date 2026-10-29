"""Provider-independent transcription pipeline: split the audio at pauses into
chunks the provider accepts, carry context between chunks, turn whatever
timing the provider gives (word / phrase / none) into per-word timing, and
apply the safety rails against looping or hallucinated output."""
import asyncio
import logging
import re
import tempfile
from collections import Counter
from typing import Awaitable, Callable

from speech.audio import _split_wav, _wav_duration
from speech.errors import ProviderAuthError, ProviderQuotaError, ProviderTransientError
from speech.quality import _repetition_metrics, _tokens
from speech.registry import ProviderRegistry, default_registry
from speech.timing import _normalize_word_timings, _spread_words
from speech.types import ProviderResult, SpeechProvider, TranscribeRequest

logger = logging.getLogger("tadaaam.speech.pipeline")
# Kept identical to the values the old frontend's projects already report.
DIAGNOSTIC_MODES = {"sarvam": "sarvam-only", "hybrid": "whisper-timing+sarvam-text",
                    "openai-whisper": "whisper-only"}
TIMING_SOURCES = {"word": "word", "phrase": "phrase+spread", "none": "spread"}
ProgressCallback = Callable[[int, int], Awaitable[None]]


def chunk_seconds_for(provider: SpeechProvider) -> int:
    """Chunk length so that `seconds + snap window (2s) + priming (1.5s)`
    stays safely inside the provider's per-request cap (Sarvam: 30s)."""
    limit = provider.capabilities.max_request_seconds
    if not limit or limit >= 26.5:
        return 20
    return max(5, int(limit - 6.5))


def result_to_words(result: ProviderResult, chunk_duration: float) -> list[dict]:
    """Per-word timing for one chunk from whatever the provider returned:
    its word timestamps, its phrase timestamps spread to words, or the whole
    transcript spread across the chunk."""
    if result.words:
        return [{"original": word.text, "start": word.start, "end": word.end}
                for word in result.words if word.text.strip()]
    if result.phrases:
        words = []
        for phrase in result.phrases:
            words.extend(_spread_words(phrase.text, phrase.start, max(phrase.end, phrase.start + 0.05)))
        return words
    transcript = result.text.strip()
    return _spread_words(transcript, 0.0, chunk_duration) if transcript else []


async def _transcribe_with_retry(provider: SpeechProvider, chunk_path: str, request: TranscribeRequest,
                                 attempts: int = 3) -> ProviderResult:
    for attempt in range(attempts):
        try:
            return await provider.transcribe(chunk_path, request)
        except (ProviderQuotaError, ProviderTransientError):
            if attempt == attempts - 1:
                raise
            await asyncio.sleep(1.5 * (attempt + 1) ** 2)
    raise AssertionError("unreachable")


async def transcribe(audio_path: str, language: str | None = None, code_mix: bool = True,
                     provider_id: str | None = None, registry: ProviderRegistry | None = None,
                     on_progress: ProgressCallback | None = None):
    """Transcribe a 16 kHz mono WAV. Returns (words, diagnostics); each word is
    {"index", "original", "start", "end"} with times in seconds."""
    registry = registry or default_registry()
    provider = registry.resolve(language, provider_id)
    caps = provider.capabilities
    selected_chunks = []
    detected_languages: Counter = Counter()
    # Carrying recent words forward (as a prompt and as keyterms) gives the
    # provider continuity across chunk boundaries - consistent spelling of
    # names/terms instead of a cold start each time.
    running_prompt = ""
    running_keyterms: list[str] = []
    with tempfile.TemporaryDirectory() as temp:
        chunks = _split_wav(audio_path, temp, seconds=chunk_seconds_for(provider))
        for chunk_number, (chunk_path, offset, content_start) in enumerate(chunks):
            if on_progress:
                await on_progress(chunk_number, len(chunks))
            skip_before = content_start - offset
            request = TranscribeRequest(language=language, code_mix=code_mix,
                                        keyterms=running_keyterms if caps.keyterms else [],
                                        prompt=running_prompt, content_offset=skip_before)
            try:
                result = await _transcribe_with_retry(provider, chunk_path, request)
            except ProviderAuthError:
                raise
            except Exception:
                logger.exception("%s failed for chunk %s", caps.id, chunk_path)
                continue
            if result.language:
                detected_languages[result.language] += 1
            stitched = result_to_words(result, _wav_duration(chunk_path))
            if not stitched:
                logger.warning("Chunk %s: %s returned no speech", chunk_path, caps.id)
                continue

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
        total_duration = _wav_duration(audio_path)
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
        "mode": DIAGNOSTIC_MODES.get(caps.id, caps.id),
        "provider": caps.id,
        "timing": TIMING_SOURCES[caps.timestamps],
        "language_detected": detected_languages.most_common(1)[0][0] if detected_languages else language,
        "chunks_total": len(chunks),
        "chunks_used": len(selected_chunks),
        "duration": round(total_duration, 3),
        "cost_inr": round(total_duration / 60 * caps.cost_per_minute_inr, 2) if caps.cost_per_minute_inr else None,
        "unique_ratio": round(overall["unique_ratio"], 3),
        "bigram_ratio": round(overall["bigram_ratio"], 3),
        "ngram_repeat": overall["ngram_repeat"],
    }
    return words, diagnostics
