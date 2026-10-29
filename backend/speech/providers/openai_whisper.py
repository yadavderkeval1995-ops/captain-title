"""OpenAI Whisper (whisper-1): a TIMING source only. Tadaaam never uses
Whisper's words for Hindi/Hinglish - Sarvam decides what was said. Whisper
supplies per-word timecodes, which the hybrid provider maps Sarvam's text
onto. Registered on its own so the timing skeleton can be inspected/tested."""
import os
import re

from openai import (APIConnectionError, APITimeoutError, AsyncOpenAI, AuthenticationError,
                    InternalServerError, PermissionDeniedError, RateLimitError)

from speech.errors import (ProviderAuthError, ProviderBadOutputError, ProviderQuotaError,
                           ProviderTransientError)
from speech.quality import _repetition_metrics, _tokens
from speech.types import ProviderCapabilities, ProviderResult, ProviderWord, TranscribeRequest


def _as_dict(value):
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return value.__dict__ if hasattr(value, "__dict__") else {}


def _build_whisper_candidate(response, skip_before: float = 0.0):
    """Extract a word-level timing skeleton from Whisper. The recognized
    text itself is discarded later in favor of Sarvam's - this only needs to
    be right about *when* speech happens, not *what* was said."""
    data = _as_dict(response)
    response_segments = getattr(response, "segments", None) or data.get("segments") or []
    accepted_segments = []
    for raw_segment in response_segments:
        segment = _as_dict(raw_segment)
        text = str(segment.get("text", "")).strip()
        if not text:
            continue
        # Whisper's very first stretch of ANY audio buffer it's handed often
        # gets an inflated no_speech_prob (no preceding context to calibrate
        # against yet) - so don't let that false-positive drop real opening
        # speech. This used to only exempt literal segment index 0, which
        # broke for the first chunk specifically: that chunk gets a 0.5s
        # silence lead-in prepended (see _split_wav) so Whisper has
        # something to "warm up" on before the real content starts, which
        # can push the genuine opening-speech segment to index 1 instead of
        # 0 - leaving it unprotected and liable to get dropped, which took
        # most/all of that chunk's real words with it (the first ~20-23s of
        # the video). Keying the exemption off actual elapsed time relative
        # to skip_before (how far into the buffer real content starts for
        # THIS chunk - the lead-in for chunk 0, the overlap priming audio
        # for every chunk after it) protects whichever segment that
        # actually is, not just whichever index it happens to land on.
        if float(segment.get("start", 0)) >= skip_before + 1.0 and float(segment.get("no_speech_prob", 0)) >= 0.65:
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


class OpenAIWhisperProvider:
    capabilities = ProviderCapabilities(
        id="openai-whisper", label="Whisper (timing only)", role="timing",
        languages="*", auto_detect=True, code_switching=False,
        timestamps="word", max_request_seconds=None, keyterms=False, native_script_output=True,
        cost_per_minute_inr=0.53, requires_env=["OPENAI_API_KEY"],
    )

    def available(self) -> bool:
        return bool(os.environ.get("OPENAI_API_KEY"))

    async def _call(self, audio_path: str, request: TranscribeRequest):
        client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        kwargs = {"model": "whisper-1", "response_format": "verbose_json",
                  "temperature": 0.0, "timestamp_granularities": ["word"]}
        if request.language and len(request.language) == 2:
            kwargs["language"] = request.language
        if request.prompt:
            kwargs["prompt"] = request.prompt
        with open(audio_path, "rb") as audio:
            try:
                return await client.audio.transcriptions.create(file=audio, **kwargs)
            except (AuthenticationError, PermissionDeniedError) as exc:
                # A bad/revoked key fails every chunk the same way - stop
                # here instead of reporting it as "unclear audio" at the end.
                raise ProviderAuthError(
                    "OpenAI rejected the API key. Update OPENAI_API_KEY in backend/.env and restart "
                    "the backend, or switch the engine to Sarvam.", "openai-whisper") from exc
            except RateLimitError as exc:
                raise ProviderQuotaError("OpenAI rate limit or quota reached.", "openai-whisper") from exc
            except (APIConnectionError, APITimeoutError, InternalServerError) as exc:
                raise ProviderTransientError(f"OpenAI request failed: {exc}", "openai-whisper") from exc

    async def timing_skeleton(self, audio_path: str, request: TranscribeRequest) -> dict:
        """Whisper's words with timing, after its own trust checks. Raises
        ProviderBadOutputError when the chunk has no usable skeleton."""
        response = await self._call(audio_path, request)
        candidate = _build_whisper_candidate(response, request.content_offset)
        if not candidate["trustworthy"] or not candidate["words"]:
            raise ProviderBadOutputError(
                f"no usable timing skeleton: avg_logprob={candidate['average_logprob']:.3f} "
                f"words={len(candidate['words'])}", "openai-whisper")
        return candidate

    async def transcribe(self, audio_path: str, request: TranscribeRequest) -> ProviderResult:
        candidate = await self.timing_skeleton(audio_path, request)
        words = [ProviderWord(text=w["original"], start=w["start"], end=w["end"]) for w in candidate["words"]]
        return ProviderResult(words=words, text=" ".join(w.text for w in words),
                              raw={"average_logprob": candidate["average_logprob"]})
