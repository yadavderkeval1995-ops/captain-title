"""One error taxonomy for every speech provider, so the pipeline decides what
to do (abort, retry, skip the chunk, fall back) without knowing which SDK
raised what."""


class ProviderError(Exception):
    """Base class. `provider` is the id of the provider that failed."""

    def __init__(self, message: str, provider: str | None = None):
        super().__init__(message)
        self.provider = provider


class ProviderAuthError(ProviderError):
    """Bad key, revoked key or no credit. Every chunk would fail the same way,
    so this aborts the job and its message is shown to the user verbatim."""


class ProviderQuotaError(ProviderError):
    """Rate limited. Retried with backoff by the pipeline."""


class ProviderUnsupportedError(ProviderError):
    """The provider can't handle this request (language, duration, missing
    credentials). Triggers the next provider in the route's fallback list."""


class ProviderTransientError(ProviderError):
    """Network or 5xx. Retried, then the chunk is skipped."""


class ProviderBadOutputError(ProviderError):
    """The provider answered but the result is empty or untrustworthy for this
    chunk. The chunk is skipped."""
