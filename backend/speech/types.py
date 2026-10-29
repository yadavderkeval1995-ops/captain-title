"""The contract every speech provider implements. A provider transcribes ONE
audio chunk (already sized to its `max_request_seconds`); chunking, carried
context, safety rails and timing normalization live in pipeline.py."""
from typing import Literal, Protocol

from pydantic import BaseModel, Field


class ProviderCapabilities(BaseModel):
    id: str
    label: str
    # "text": decides what was said. "timing": only trusted for when words
    # were said (Whisper - its Hindi text is discarded). "text+timing": both.
    role: Literal["text", "timing", "text+timing"]
    languages: list[str] | Literal["*"]      # ISO 639-1/3 codes, e.g. "hi", "ta"
    auto_detect: bool
    code_switching: bool                     # handles mixed speech such as Hinglish
    timestamps: Literal["word", "phrase", "none"]
    max_request_seconds: float | None
    keyterms: bool
    native_script_output: bool
    cost_per_minute_inr: float | None = None
    runs_locally: bool = False
    requires_env: list[str] = Field(default_factory=list)


class TranscribeRequest(BaseModel):
    language: str | None = None              # None = auto-detect
    code_mix: bool = True
    keyterms: list[str] = Field(default_factory=list)
    prompt: str = ""                         # recent words, for continuity across chunks
    # Seconds of priming audio at the start of the chunk (silence lead-in or
    # overlap from the previous chunk) before the real content starts.
    content_offset: float = 0.0


class ProviderWord(BaseModel):
    text: str
    start: float
    end: float
    confidence: float | None = None


class ProviderPhrase(BaseModel):
    text: str
    start: float
    end: float


class ProviderResult(BaseModel):
    words: list[ProviderWord] | None = None    # when timestamps == "word"
    phrases: list[ProviderPhrase] | None = None  # when timestamps == "phrase"
    text: str = ""
    language: str | None = None              # detected ISO code, when the provider reports one
    raw: dict = Field(default_factory=dict)


class SpeechProvider(Protocol):
    capabilities: ProviderCapabilities

    def available(self) -> bool:
        """True when credentials / local models are present."""

    async def transcribe(self, audio_path: str, request: TranscribeRequest) -> ProviderResult:
        ...
