"""Known providers plus the routing table (routing.json) that picks one for a
request. Precedence: explicit request provider -> routing table -> default."""
import json
from pathlib import Path

from speech.errors import ProviderUnsupportedError
from speech.providers import HybridProvider, OpenAIWhisperProvider, SarvamProvider
from speech.types import SpeechProvider

ROUTING_FILE = Path(__file__).resolve().parent / "routing.json"


class ProviderRegistry:
    def __init__(self, providers: list[SpeechProvider] | None = None, routing: dict | None = None):
        providers = providers if providers is not None else [SarvamProvider(), OpenAIWhisperProvider(),
                                                              HybridProvider()]
        self.providers = {provider.capabilities.id: provider for provider in providers}
        self.routing = routing if routing is not None else json.loads(ROUTING_FILE.read_text(encoding="utf-8"))

    def get(self, provider_id: str) -> SpeechProvider:
        if provider_id not in self.providers:
            raise ProviderUnsupportedError(f"Unknown speech provider '{provider_id}'", provider_id)
        return self.providers[provider_id]

    def describe(self) -> list[dict]:
        return [{**provider.capabilities.model_dump(), "available": provider.available()}
                for provider in self.providers.values()]

    @staticmethod
    def supports(provider: SpeechProvider, language: str | None) -> bool:
        languages = provider.capabilities.languages
        if language is None:
            return provider.capabilities.auto_detect
        return languages == "*" or language in languages

    def resolve(self, language: str | None, provider_id: str | None = None) -> SpeechProvider:
        """The provider that will transcribe this request."""
        if provider_id:
            provider = self.get(provider_id)
            if not provider.available():
                missing = ", ".join(provider.capabilities.requires_env)
                raise ProviderUnsupportedError(
                    f"{provider.capabilities.label} is not configured (needs {missing} in backend/.env).",
                    provider_id)
            if not self.supports(provider, language):
                raise ProviderUnsupportedError(
                    f"{provider.capabilities.label} does not support language '{language}'.", provider_id)
            return provider
        candidates = []
        for route in self.routing.get("routes", []):
            langs = route.get("languages", [])
            if "*" in langs or (language or "auto") in langs or (language is None and "auto" in langs):
                candidates = [route["provider"], *route.get("fallback", [])]
                break
        candidates.append(self.routing.get("default", "sarvam"))
        for candidate in candidates:
            provider = self.providers.get(candidate)
            if provider and provider.capabilities.role != "timing" and provider.available() \
                    and self.supports(provider, language):
                return provider
        raise ProviderUnsupportedError(
            f"No configured speech provider supports language '{language or 'auto'}'. "
            "Add SARVAM_API_KEY to backend/.env.")


_default_registry: ProviderRegistry | None = None


def default_registry() -> ProviderRegistry:
    global _default_registry
    if _default_registry is None:
        _default_registry = ProviderRegistry()
    return _default_registry
