"""Every registered provider: capability sanity offline, and (with
TADAAAM_NETWORK_TESTS=1) a fake key must surface as ProviderAuthError."""
import asyncio
import os

import pytest

from speech.errors import ProviderAuthError
from speech.pipeline import chunk_seconds_for
from speech.registry import ProviderRegistry
from speech.types import TranscribeRequest

PROVIDERS = list(ProviderRegistry().providers.values())


@pytest.mark.parametrize("provider", PROVIDERS, ids=lambda p: p.capabilities.id)
def test_capabilities_are_consistent(provider):
    caps = provider.capabilities
    assert caps.requires_env, "cloud providers must declare their credentials"
    if caps.max_request_seconds:
        assert chunk_seconds_for(provider) + 2 + 1.5 <= caps.max_request_seconds
    assert caps.languages == "*" or "hi" in caps.languages


@pytest.mark.skipif(os.environ.get("TADAAAM_NETWORK_TESTS") != "1", reason="network test")
@pytest.mark.parametrize("provider", PROVIDERS, ids=lambda p: p.capabilities.id)
def test_bad_key_is_normalized(provider, monkeypatch, tmp_path):
    from speech.tests.conftest import write_speechlike_wav

    for name in provider.capabilities.requires_env:
        monkeypatch.setenv(name, "tadaaam-contract-test-invalid-key")
    wav = write_speechlike_wav(tmp_path / "short.wav", 3)
    with pytest.raises(ProviderAuthError):
        asyncio.run(provider.transcribe(wav, TranscribeRequest(language="hi")))
