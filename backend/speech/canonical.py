"""The Canonical Transcript (tadaaam.transcript/v1): the one JSON shape every
provider's output is normalized into, consumed by the editor/studio. The
JSON Schema in /schemas is generated from these models
(`python -m speech.export_schema`)."""
import re
from typing import Literal

from indic_transliteration import sanscript
from pydantic import BaseModel, Field

from speech.romanize import _common_hindi_spelling, _romanize_fallback

SCHEMA_ID = "tadaaam.transcript/v1"
OutputScript = Literal["roman", "native"]

# Unicode blocks -> ISO 15924 script code, and the indic_transliteration
# scheme used for a generic romanization of that script.
_SCRIPTS = [
    ("Deva", re.compile(r"[ऀ-ॿ]"), sanscript.DEVANAGARI),
    ("Beng", re.compile(r"[ঀ-৿]"), sanscript.BENGALI),
    ("Guru", re.compile(r"[਀-੿]"), sanscript.GURMUKHI),
    ("Gujr", re.compile(r"[઀-૿]"), sanscript.GUJARATI),
    ("Orya", re.compile(r"[଀-୿]"), sanscript.ORIYA),
    ("Taml", re.compile(r"[஀-௿]"), sanscript.TAMIL),
    ("Telu", re.compile(r"[ఀ-౿]"), sanscript.TELUGU),
    ("Knda", re.compile(r"[ಀ-೿]"), sanscript.KANNADA),
    ("Mlym", re.compile(r"[ഀ-ൿ]"), sanscript.MALAYALAM),
    ("Arab", re.compile(r"[؀-ۿ]"), None),
    ("Latn", re.compile(r"[A-Za-z]"), None),
]


class AudioInfo(BaseModel):
    duration: float
    sample_rate: int = 16000


class LanguageInfo(BaseModel):
    requested: str = "auto"
    detected: str | None = None
    code_mix: bool = True


class ProviderInfo(BaseModel):
    id: str
    model: str | None = None
    timing: str                              # "word" | "phrase+spread" | "spread"
    fallbacks_used: list[str] = Field(default_factory=list)


class TranscriptWord(BaseModel):
    i: int
    start: float
    end: float
    native: str                              # what the provider recognized, in its own script
    roman: str                               # romanized (Hinglish for Hindi)
    display: str                             # what captions show (per output_script)
    script: str | None = None                # ISO 15924 of `native`
    confidence: float | None = None
    timing_confidence: Literal["measured", "estimated"] = "estimated"
    uncertain: bool = False
    tags: list[str] = Field(default_factory=list)
    emphasis: Literal["support", "feature", "key"] | None = None
    speaker: str | None = None


class Diagnostics(BaseModel):
    chunks_total: int = 0
    chunks_used: int = 0
    unique_ratio: float | None = None
    bigram_ratio: float | None = None
    ngram_repeat: int | None = None
    cost_inr: float | None = None


class CanonicalTranscript(BaseModel):
    schema_id: str = Field(SCHEMA_ID, alias="schema")
    job_id: str | None = None
    audio: AudioInfo
    language: LanguageInfo
    provider: ProviderInfo
    output_script: OutputScript = "roman"
    words: list[TranscriptWord]
    diagnostics: Diagnostics = Field(default_factory=Diagnostics)

    model_config = {"populate_by_name": True}


def detect_script(text: str) -> str | None:
    for code, pattern, _scheme in _SCRIPTS:
        if pattern.search(text):
            return code
    return None


def romanize(text: str) -> str:
    """Offline romanization of one word: the Hinglish romanizer for
    Devanagari, a generic transliteration for other Indic scripts (refined
    per language in Phase 3), unchanged for Latin and unknown scripts."""
    script = detect_script(text)
    if script == "Deva":
        return _common_hindi_spelling(text) or _romanize_fallback(text)
    scheme = next((s for code, _p, s in _SCRIPTS if code == script), None)
    if scheme:
        return sanscript.transliterate(text, scheme, sanscript.OPTITRANS).lower()
    return text


def build_canonical(words: list[dict], diagnostics: dict, *, requested_language: str | None,
                    code_mix: bool, output_script: OutputScript, job_id: str | None = None,
                    model: str | None = None) -> CanonicalTranscript:
    """`words` are pipeline words, optionally already through
    convert_to_hinglish (which sets `text`, `emphasis`, `uncertain`)."""
    measured = diagnostics.get("timing") == "word"
    out = []
    for word in words:
        native = word["original"]
        roman = word.get("text") or romanize(native)
        out.append(TranscriptWord(
            i=word["index"], start=word["start"], end=word["end"], native=native, roman=roman,
            display=roman if output_script == "roman" else native, script=detect_script(native),
            timing_confidence="measured" if measured else "estimated",
            uncertain=bool(word.get("uncertain", False)), emphasis=word.get("emphasis")))
    return CanonicalTranscript(
        job_id=job_id,
        audio=AudioInfo(duration=diagnostics.get("duration") or (out[-1].end if out else 0.0)),
        language=LanguageInfo(requested=requested_language or "auto",
                              detected=diagnostics.get("language_detected"), code_mix=code_mix),
        provider=ProviderInfo(id=diagnostics.get("provider", "unknown"), model=model,
                              timing=diagnostics.get("timing", "spread")),
        output_script=output_script, words=out,
        diagnostics=Diagnostics(**{key: diagnostics.get(key) for key in Diagnostics.model_fields
                                   if diagnostics.get(key) is not None}))
