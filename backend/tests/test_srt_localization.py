from srt_localization import build_srt, parse_srt, representative_cues


def test_parse_and_build_preserve_indexes_and_timestamps():
    content = "1\n00:00:01,000 --> 00:00:02,500\nHello.\n\n2\n00:00:03,000 --> 00:00:04,000\nLeave!\n"
    cues = parse_srt(content)
    cues[0]["translated_text"] = "नमस्ते।"; cues[1]["translated_text"] = "चले जाओ!"
    output = build_srt(cues)
    assert "1\n00:00:01,000 --> 00:00:02,500\nनमस्ते।" in output
    assert "2\n00:00:03,000 --> 00:00:04,000\nचले जाओ!" in output


def test_invalid_srt_is_rejected():
    try: parse_srt("not an srt")
    except ValueError as exc: assert "incomplete" in str(exc).lower()
    else: raise AssertionError("Expected invalid SRT to fail")


def test_representative_window_contains_emotional_dialogue():
    cues = [{"index": i, "start": f"00:00:{i:02d},000", "end": f"00:00:{i:02d},800", "text": "Okay."} for i in range(1, 15)]
    cues[9]["text"] = "Why would you do that?!"
    selected = representative_cues(cues, 5)
    assert any(cue["index"] == 10 for cue in selected)
