"""Sarvam saaras: Tadaaam's speech-recognition engine. Decides WHAT was said
for Hindi, Hinglish and the other Indian languages. Its REST API returns
phrase-level timestamps (not per-word), which the pipeline spreads to words."""
import os

from sarvamai import AsyncSarvamAI
from sarvamai.errors import (BadGatewayError, ForbiddenError, GatewayTimeoutError, InternalServerError,
                             PaymentRequiredError, ServiceUnavailableError, TooManyRequestsError,
                             UnauthorizedError)

from speech.errors import ProviderAuthError, ProviderQuotaError, ProviderTransientError
from speech.types import ProviderCapabilities, ProviderPhrase, ProviderResult, TranscribeRequest

# Our ISO codes -> Sarvam's BCP-47 codes (the SDK's SpeechToTextLanguage enum).
SARVAM_LANGUAGE_CODES = {
    "hi": "hi-IN", "bn": "bn-IN", "kn": "kn-IN", "ml": "ml-IN", "mr": "mr-IN", "or": "od-IN",
    "pa": "pa-IN", "ta": "ta-IN", "te": "te-IN", "en": "en-IN", "gu": "gu-IN", "as": "as-IN",
    "ur": "ur-IN", "ne": "ne-IN", "kok": "kok-IN", "ks": "ks-IN", "sd": "sd-IN", "sa": "sa-IN",
    "sat": "sat-IN", "mni": "mni-IN", "brx": "brx-IN", "mai": "mai-IN", "doi": "doi-IN",
}
_FROM_SARVAM = {code: iso for iso, code in SARVAM_LANGUAGE_CODES.items()}


class SarvamProvider:
    capabilities = ProviderCapabilities(
        id="sarvam", label="Sarvam", role="text",
        languages=sorted(SARVAM_LANGUAGE_CODES), auto_detect=True, code_switching=True,
        timestamps="phrase", max_request_seconds=30, keyterms=True, native_script_output=True,
        cost_per_minute_inr=0.49, requires_env=["SARVAM_API_KEY"],
    )

    def available(self) -> bool:
        return bool(os.environ.get("SARVAM_API_KEY"))

    async def recognize(self, audio_path: str, request: TranscribeRequest, with_timestamps: bool = True):
        """Raw SDK call, also used by the hybrid provider for its text pass."""
        client = AsyncSarvamAI(api_subscription_key=os.environ.get("SARVAM_API_KEY", ""))
        kwargs = {"model": os.environ.get("SARVAM_STT_MODEL", "saaras:v4"),
                  "mode": "codemix" if request.code_mix else "transcribe",
                  "language_code": SARVAM_LANGUAGE_CODES.get(request.language or "", "unknown")}
        if request.keyterms:
            kwargs["keyterms"] = request.keyterms
        if with_timestamps:
            kwargs["with_timestamps"] = True
        with open(audio_path, "rb") as audio:
            try:
                return await client.speech_to_text.transcribe(file=audio, **kwargs)
            except (UnauthorizedError, ForbiddenError, PaymentRequiredError) as exc:
                raise ProviderAuthError(
                    "Sarvam rejected the API key or the account has no credit. "
                    "Check SARVAM_API_KEY in backend/.env and restart the backend.", "sarvam") from exc
            except TooManyRequestsError as exc:
                raise ProviderQuotaError("Sarvam rate limit reached.", "sarvam") from exc
            except (InternalServerError, BadGatewayError, ServiceUnavailableError, GatewayTimeoutError) as exc:
                raise ProviderTransientError(f"Sarvam server error: {exc}", "sarvam") from exc

    async def transcribe(self, audio_path: str, request: TranscribeRequest) -> ProviderResult:
        response = await self.recognize(audio_path, request)
        timestamps = getattr(response, "timestamps", None)
        phrases = None
        if timestamps and timestamps.words:
            phrases = [ProviderPhrase(text=text, start=start, end=max(end, start + 0.05))
                       for text, start, end in zip(timestamps.words, timestamps.start_time_seconds,
                                                   timestamps.end_time_seconds)]
        return ProviderResult(
            phrases=phrases, text=(getattr(response, "transcript", "") or "").strip(),
            language=_FROM_SARVAM.get(getattr(response, "language_code", None) or ""),
            raw=response.model_dump() if hasattr(response, "model_dump") else {})
