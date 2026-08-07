import asyncio
import sys
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import caption_ai
from caption_groups import create_caption_groups


def _wav(path, seconds, rate=100):
    with wave.open(str(path), "wb") as target:
        target.setnchannels(1); target.setsampwidth(2); target.setframerate(rate)
        target.writeframes(b"\0\0" * rate * seconds)


def _word(text, start, end, **extra):
    return {"original": text, "text": text, "start": start, "end": end,
            "important": False, "uncertain": False, **extra}


def test_short_audio_uses_one_full_bounded_request(tmp_path, monkeypatch):
    path = tmp_path / "clip.wav"
    _wav(path, 37)
    calls = []

    async def fake_best(candidate_path, language):
        calls.append((candidate_path, language))
        return {"words": [_word("Namaste", 0.1, 0.5), _word("dosto", 0.55, 1.0)],
                "trustworthy": True, "score": 1}, False

    monkeypatch.setattr(caption_ai, "_best_candidate", fake_best)
    words, metadata = asyncio.run(caption_ai.transcribe_words(str(path), "hi"))
    assert calls == [(str(path), "hi")]
    assert [word["original"] for word in words] == ["Namaste", "dosto"]
    assert metadata["mode"] == "full-bounded"


def test_leading_gap_triggers_short_window_recovery(tmp_path, monkeypatch):
    path = tmp_path / "clip.wav"
    _wav(path, 37)
    calls = []

    async def fake_best(candidate_path, language):
        calls.append(candidate_path)
        if candidate_path == str(path):
            return {"words": [_word("late", 18.0, 18.4)], "trustworthy": False,
                    "score": -2, "first_start": 18.0}, True
        chunk_index = int(Path(candidate_path).stem.split("-")[-1])
        text = ["opening", "middle", "ending"][min(chunk_index, 2)]
        return {"words": [_word(text, .2, .6)], "trustworthy": True,
                "score": 1, "first_start": .2}, False

    monkeypatch.setattr(caption_ai, "_best_candidate", fake_best)
    words, metadata = asyncio.run(caption_ai.transcribe_words(str(path), "auto"))
    assert words[0]["original"] == "opening"
    assert words[0]["start"] < 1.0
    assert metadata["mode"] == "full-with-gap-recovery"
    assert len(calls) >= 4


def test_candidate_with_18_second_leading_gap_is_not_trustworthy():
    response = SimpleNamespace(
        duration=37.0,
        segments=[{"text": " late words", "start": 18, "end": 22,
                   "avg_logprob": -.2, "no_speech_prob": .01}],
        words=[{"word": "late", "start": 18.0, "end": 18.4},
               {"word": "words", "start": 18.5, "end": 19.0}],
    )
    candidate = caption_ai._build_candidate(response, "auto", "auto")
    assert candidate["first_start"] == 18.0
    assert not candidate["trustworthy"]


def test_overlap_merge_removes_duplicate_boundary_words():
    left = [_word("hum", 51.5, 52), _word("kal", 52.1, 52.5), _word("jayenge", 52.6, 53)]
    incoming = [_word("kal", 0.1, .5), _word("jayenge", .6, 1), _word("saath", 1.1, 1.5)]
    merged = caption_ai._merge_window_words(left, incoming, 52.0)
    assert [w["original"] for w in merged] == ["hum", "kal", "jayenge", "saath"]
    assert merged[-1]["start"] == pytest.approx(53.1)


def test_caption_groups_preserve_order_and_use_pause_punctuation_limits():
    words = [
        _word("Aaj", 0, .3), _word("hum", .35, .6), _word("shuru.", .65, 1.0),
        _word("Phir", 1.9, 2.2), _word("important", 2.25, 2.8, important=True),
        _word("baat", 2.85, 3.2), _word("karenge", 3.25, 3.8),
    ]
    groups = create_caption_groups(words, max_words=4)
    flattened = [w["original"] for group in groups for w in group["words"]]
    assert flattened == [w["original"] for w in words]
    assert [g["text"] for g in groups] == ["Aaj hum shuru.", "Phir important baat karenge"]
    assert sum(w["important"] for g in groups for w in g["words"]) <= 1


def test_uncertain_word_is_never_emphasized():
    groups = create_caption_groups([_word("yeh", 0, .2),
                                    _word("important", .3, .7, important=True, uncertain=True)])
    assert not any(w["important"] for w in groups[0]["words"])


def test_convert_rejects_missing_or_multiword_ai_output(monkeypatch):
    words = [dict(_word("नमस्ते", 0, .4), index=0)]
    monkeypatch.setattr(caption_ai, "_convert_sync", lambda *_: [
        {"index": 0, "text": "hello there", "important": False, "uncertain": False}
    ])
    with pytest.raises(ValueError, match="cardinality"):
        asyncio.run(caption_ai.convert_to_hinglish(words, ""))


def test_candidate_keeps_word_timestamps_and_order():
    response = SimpleNamespace(
        duration=3.0,
        segments=[{"text": " ek do teen", "start": 0, "end": 3, "avg_logprob": -.2,
                   "no_speech_prob": .01}],
        words=[{"word": "ek", "start": .1, "end": .5},
               {"word": "do", "start": .8, "end": 1.1},
               {"word": "teen", "start": 1.5, "end": 2.0}],
    )
    candidate = caption_ai._build_candidate(response, "hi", "hi")
    assert [(w["original"], w["start"], w["end"]) for w in candidate["words"]] == [
        ("ek", .1, .5), ("do", .8, 1.1), ("teen", 1.5, 2.0)]
    assert candidate["trustworthy"]
