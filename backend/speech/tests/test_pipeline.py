import asyncio

import pytest

from speech.errors import ProviderAuthError, ProviderUnsupportedError
from speech.pipeline import chunk_seconds_for, result_to_words, transcribe
from speech.registry import ProviderRegistry
from speech.types import ProviderPhrase, ProviderResult, ProviderWord
from speech.tests.fakes import FakeProvider

ROUTING = {"default": "fake", "routes": [{"languages": ["*"], "provider": "fake", "fallback": []}]}


def run(provider, wav, **kwargs):
    registry = ProviderRegistry([provider], ROUTING)
    return asyncio.run(transcribe(wav, "hi", registry=registry, **kwargs))


@pytest.mark.parametrize("style", ["word", "phrase", "none"])
def test_every_timing_style_gives_monotonic_indexed_words(wav_45s, style):
    provider = FakeProvider(timestamps=style)
    words, diagnostics = run(provider, wav_45s)
    assert provider.calls >= 2                       # 45s must be split for a 30s-cap provider
    assert [w["index"] for w in words] == list(range(len(words)))
    for a, b in zip(words, words[1:]):
        assert a["start"] <= b["start"]
    for w in words:
        assert 0 <= w["start"] < w["end"] <= 45.5
    assert diagnostics["provider"] == "fake"
    assert diagnostics["chunks_used"] == diagnostics["chunks_total"] == provider.calls
    assert diagnostics["language_detected"] == "hi"


def test_chunks_respect_provider_request_cap():
    assert chunk_seconds_for(FakeProvider(max_request_seconds=30)) == 20
    assert chunk_seconds_for(FakeProvider(max_request_seconds=None)) == 20
    assert chunk_seconds_for(FakeProvider(max_request_seconds=15)) + 2 + 1.5 <= 15


def test_context_is_carried_between_chunks(wav_45s):
    provider = FakeProvider()
    run(provider, wav_45s)
    assert provider.requests[0].keyterms == [] and provider.requests[0].prompt == ""
    assert provider.requests[1].keyterms and provider.requests[1].prompt
    assert provider.requests[1].content_offset > 0


def test_auth_error_aborts_the_job(wav_45s):
    with pytest.raises(ProviderAuthError):
        run(FakeProvider(fail="auth"), wav_45s)


def test_transient_error_is_retried(wav_45s):
    provider = FakeProvider(fail="transient", fail_times=2)
    words, diagnostics = run(provider, wav_45s)
    assert words and diagnostics["chunks_used"] == diagnostics["chunks_total"]


class Looping(FakeProvider):
    def _words(self, count):
        return ["haan", "ji"] * max(1, count // 2)


def test_looping_chunks_are_dropped(wav_45s):
    # Long looping chunks are rejected; a short tail chunk is too small to judge.
    _words, diagnostics = run(Looping(), wav_45s)
    assert diagnostics["chunks_used"] < diagnostics["chunks_total"]


def test_all_looping_output_fails_the_job(tmp_path):
    from speech.tests.conftest import write_speechlike_wav
    with pytest.raises(ValueError, match="trustworthy"):
        run(Looping(), write_speechlike_wav(tmp_path / "loop.wav", 18))


def test_result_to_words_spreads_phrases_by_length():
    result = ProviderResult(phrases=[ProviderPhrase(text="hai bilkul", start=1.0, end=2.0)])
    words = result_to_words(result, 5.0)
    assert [w["original"] for w in words] == ["hai", "bilkul"]
    assert words[0]["start"] == 1.0 and words[-1]["end"] == 2.0
    assert (words[0]["end"] - words[0]["start"]) < (words[1]["end"] - words[1]["start"])


def test_result_to_words_prefers_word_timestamps():
    result = ProviderResult(words=[ProviderWord(text="aaj", start=0.2, end=0.5),
                                   ProviderWord(text=" ", start=0.5, end=0.6)],
                            phrases=[ProviderPhrase(text="ignored", start=0, end=1)])
    assert result_to_words(result, 1.0) == [{"original": "aaj", "start": 0.2, "end": 0.5}]


def test_registry_never_routes_text_to_a_timing_provider():
    registry = ProviderRegistry([FakeProvider(role="timing")], ROUTING)
    with pytest.raises(ProviderUnsupportedError):
        registry.resolve("hi")


def test_registry_explicit_provider_must_be_configured(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ProviderUnsupportedError, match="OPENAI_API_KEY"):
        ProviderRegistry().resolve("hi", "hybrid")


def test_registry_routes_indian_languages_to_sarvam(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "x")
    with pytest.raises(ProviderUnsupportedError):
        ProviderRegistry().resolve("xx", "sarvam")
    assert ProviderRegistry().resolve("ta").capabilities.id == "sarvam"
    assert ProviderRegistry().resolve(None).capabilities.id == "sarvam"
