import asyncio

import pytest

import caption_ai_openai as caption


def _response(text):
    return {"text": text}


def _whisper_words():
    return [
        {"index": 0, "original": "aap", "text": "aap", "start": 1.0, "end": 1.4},
        {"index": 1, "original": "kaise", "text": "kaise", "start": 2.0, "end": 2.5},
        {"index": 2, "original": "hain", "text": "hain", "start": 3.0, "end": 3.4},
    ]


def test_inserted_opening_words_are_kept_and_interpolated():
    words = caption._align_coverage_words(
        _response("namaste dosto aap kaise hain"), _whisper_words(), 5.0)

    assert [word["original"] for word in words] == ["namaste", "dosto", "aap", "kaise", "hain"]
    assert words[0]["start"] == 0.0
    assert words[1]["end"] == 1.0
    assert words[0]["uncertain"] is True
    assert words[1]["uncertain"] is True


def test_inserted_middle_words_are_kept_and_interpolated():
    words = caption._align_coverage_words(
        _response("aap sab log kaise hain"), _whisper_words(), 5.0)

    assert [word["original"] for word in words] == ["aap", "sab", "log", "kaise", "hain"]
    assert [(words[i]["start"], words[i]["end"]) for i in (1, 2)] == [
        (1.4, 1.7), (1.7, 2.0)
    ]
    assert words[1]["uncertain"] is True
    assert words[2]["uncertain"] is True


def test_matched_tokens_preserve_exact_whisper_timestamps():
    source = _whisper_words()
    words = caption._align_coverage_words(_response("aap kaise hain ji"), source, 5.0)

    for index in range(3):
        assert words[index]["start"] == source[index]["start"]
        assert words[index]["end"] == source[index]["end"]
        assert words[index]["uncertain"] is False


def test_coverage_failure_falls_back_to_whisper_unchanged(monkeypatch):
    whisper_response = {
        "duration": 4.0,
        "segments": [{"text": "aap kaise hain", "start": 1.0, "end": 3.4,
                      "avg_logprob": -0.2, "no_speech_prob": 0.0}],
        "words": [
            {"word": "aap", "start": 1.0, "end": 1.4},
            {"word": "kaise", "start": 2.0, "end": 2.5},
            {"word": "hain", "start": 3.0, "end": 3.4},
        ],
    }

    async def transcription(*_args):
        return whisper_response

    async def coverage(*_args):
        raise RuntimeError("coverage unavailable")

    monkeypatch.setattr(caption, "_split_wav", lambda *_args, **_kwargs: [("chunk.wav", 0.0)])
    monkeypatch.setattr(caption, "_transcription_pass", transcription)
    monkeypatch.setattr(caption, "_coverage_pass", coverage)

    words, _metadata = asyncio.run(caption.transcribe_words("input.wav"))
    assert [(word["original"], word["start"], word["end"]) for word in words] == [
        ("aap", 1.0, 1.4), ("kaise", 2.0, 2.5), ("hain", 3.0, 3.4)
    ]
    assert all("uncertain" not in word for word in words)


def test_pathological_repeated_canonical_text_is_rejected():
    repeated = " ".join(["haan ji"] * 8)
    assert caption._align_coverage_words(_response(repeated), _whisper_words(), 5.0) is None
