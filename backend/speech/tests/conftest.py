import math
import struct
import wave

import pytest


def write_speechlike_wav(path, seconds: float, pause_every: float = 7.0, rate: int = 16000):
    """A tone with a 0.6s silent gap every `pause_every` seconds, so the
    chunker's silence detection has real pauses to snap to."""
    frames = bytearray()
    for n in range(int(seconds * rate)):
        t = n / rate
        silent = (t % pause_every) > pause_every - 0.6
        value = 0 if silent else int(8000 * math.sin(2 * math.pi * 220 * t))
        frames += struct.pack("<h", value)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(bytes(frames))
    return str(path)


@pytest.fixture
def wav_45s(tmp_path):
    return write_speechlike_wav(tmp_path / "speech.wav", 45)


@pytest.fixture(autouse=True)
def no_backoff(monkeypatch):
    import speech.pipeline

    async def instant(_seconds):
        return None
    monkeypatch.setattr(speech.pipeline.asyncio, "sleep", instant)
