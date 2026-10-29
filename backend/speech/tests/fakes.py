from speech.audio import _wav_duration
from speech.errors import ProviderAuthError, ProviderTransientError
from speech.types import ProviderCapabilities, ProviderPhrase, ProviderResult, ProviderWord

VOCAB = ("aaj hum ek naya product dekhenge jo aapke pairon ko aaram dega bilkul "
         "sasta aur tikau hai isse zaroor try kijiye fir batana kaisa laga").split()


def fake_caps(**overrides):
    values = dict(id="fake", label="Fake", role="text", languages=["hi"], auto_detect=True,
                  code_switching=True, timestamps="phrase", max_request_seconds=30, keyterms=True,
                  native_script_output=True)
    values.update(overrides)
    return ProviderCapabilities(**values)


class FakeProvider:
    """Returns distinct, non-repetitive words covering each chunk, in the
    requested timestamp style; can be told to fail."""

    def __init__(self, timestamps="phrase", fail=None, fail_times=0, **caps):
        self.capabilities = fake_caps(timestamps=timestamps, **caps)
        self.fail, self.fail_times, self.calls, self.requests = fail, fail_times, 0, []
        self._next = 0

    def available(self):
        return True

    def _words(self, count):
        out = []
        for _ in range(count):
            out.append(f"{VOCAB[self._next % len(VOCAB)]}{self._next // len(VOCAB) or ''}")
            self._next += 1
        return out

    async def transcribe(self, audio_path, request):
        self.calls += 1
        self.requests.append(request)
        if self.fail == "auth":
            raise ProviderAuthError("bad key", "fake")
        if self.fail == "transient" and self.calls <= self.fail_times:
            raise ProviderTransientError("503", "fake")
        duration = _wav_duration(audio_path)
        start = request.content_offset
        words = self._words(max(1, int((duration - start) * 2)))
        if self.capabilities.timestamps == "word":
            step = (duration - start) / len(words)
            return ProviderResult(words=[ProviderWord(text=w, start=start + i * step, end=start + (i + 1) * step)
                                         for i, w in enumerate(words)], text=" ".join(words), language="hi")
        if self.capabilities.timestamps == "phrase":
            half = len(words) // 2 or 1
            mid = start + (duration - start) / 2
            phrases = [ProviderPhrase(text=" ".join(words[:half]), start=start, end=mid)]
            if words[half:]:
                phrases.append(ProviderPhrase(text=" ".join(words[half:]), start=mid, end=duration))
            return ProviderResult(phrases=phrases, text=" ".join(words), language="hi")
        return ProviderResult(text=" ".join(words), language="hi")
