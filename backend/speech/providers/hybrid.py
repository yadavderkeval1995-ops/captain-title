"""Hybrid: Sarvam decides the words, Whisper supplies the per-word timecodes.
The two transcripts are globally aligned (speech/alignment.py) and Sarvam's
text is placed on Whisper's timing slots."""
import logging

from speech.alignment import _stitch_chunk
from speech.errors import ProviderAuthError
from speech.providers.openai_whisper import OpenAIWhisperProvider
from speech.providers.sarvam import SarvamProvider
from speech.types import ProviderCapabilities, ProviderResult, ProviderWord, TranscribeRequest

logger = logging.getLogger("tadaaam.speech.hybrid")


class HybridProvider:
    capabilities = ProviderCapabilities(
        id="hybrid", label="Sarvam words + Whisper timing", role="text+timing",
        languages=SarvamProvider.capabilities.languages, auto_detect=True, code_switching=True,
        timestamps="word", max_request_seconds=30, keyterms=True, native_script_output=True,
        cost_per_minute_inr=1.02, requires_env=["SARVAM_API_KEY", "OPENAI_API_KEY"],
    )

    def __init__(self, text_provider: SarvamProvider | None = None,
                 timing_provider: OpenAIWhisperProvider | None = None):
        self.text_provider = text_provider or SarvamProvider()
        self.timing_provider = timing_provider or OpenAIWhisperProvider()

    def available(self) -> bool:
        return self.text_provider.available() and self.timing_provider.available()

    async def transcribe(self, audio_path: str, request: TranscribeRequest) -> ProviderResult:
        # No usable Whisper skeleton -> the error propagates and the chunk is skipped.
        candidate = await self.timing_provider.timing_skeleton(audio_path, request)
        sarvam_text = ""
        try:
            response = await self.text_provider.recognize(audio_path, request, with_timestamps=False)
            sarvam_text = (getattr(response, "transcript", "") or "").strip()
        except ProviderAuthError:
            raise
        except Exception:
            logger.exception("Sarvam text pass failed for chunk %s", audio_path)
        # If Sarvam fails for this one chunk, fall back to Whisper's own
        # words rather than losing the chunk entirely.
        stitched = _stitch_chunk(candidate["words"], sarvam_text) if sarvam_text else []
        if not stitched:
            stitched = candidate["words"]
        words = [ProviderWord(text=w["original"], start=w["start"], end=w["end"]) for w in stitched]
        return ProviderResult(words=words, text=" ".join(w.text for w in words),
                              raw={"sarvam_text": sarvam_text, "average_logprob": candidate["average_logprob"]})
