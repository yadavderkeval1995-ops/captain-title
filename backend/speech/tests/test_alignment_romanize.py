from speech.alignment import _stitch_chunk
from speech.romanize import _delete_schwas, _hinglish_transliterate
from speech.timing import _normalize_word_timings


def test_sarvam_text_lands_on_whisper_timing():
    whisper = [{"original": "aaj", "start": 0.0, "end": 0.3}, {"original": "ham", "start": 0.3, "end": 0.6},
               {"original": "dekhenge", "start": 0.6, "end": 1.2}]
    stitched = _stitch_chunk(whisper, "aaj hum dekhenge")
    assert [w["original"] for w in stitched] == ["aaj", "hum", "dekhenge"]
    assert [w["start"] for w in stitched] == [0.0, 0.3, 0.6]


def test_hindi_schwa_deletion():
    assert _hinglish_transliterate("आज") == "aaj"
    assert _hinglish_transliterate("करवाना") == "karvaana"
    assert _delete_schwas("क") == "क"


def test_zero_length_timings_become_visible():
    words = _normalize_word_timings([{"start": 1.0, "end": 1.0}, {"start": 1.5, "end": 1.6}])
    assert words[0]["end"] > words[0]["start"]
