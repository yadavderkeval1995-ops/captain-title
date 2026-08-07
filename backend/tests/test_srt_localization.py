from srt_localization import build_srt, detect_dialogue_groups, parse_srt, representative_cues


def test_bilingual_build_preserves_indexes_timestamps_and_line_order():
    content = "1\n00:00:01,000 --> 00:00:02,500\nHello.\n\n2\n00:00:03,000 --> 00:00:04,000\nLeave!\n"
    cues = parse_srt(content)
    cues[0]["translated_text"] = "नमस्ते।"; cues[1]["translated_text"] = "चले जाओ!"
    output = build_srt(cues)
    assert "1\n00:00:01,000 --> 00:00:02,500\nHello.\nनमस्ते।" in output
    assert "2\n00:00:03,000 --> 00:00:04,000\nLeave!\nचले जाओ!" in output


def test_invalid_srt_is_rejected():
    try: parse_srt("not an srt")
    except ValueError as exc: assert "incomplete" in str(exc).lower()
    else: raise AssertionError("Expected invalid SRT to fail")


def test_representative_window_contains_emotional_dialogue():
    cues = [{"index": i, "start": f"00:00:{i:02d},000", "end": f"00:00:{i:02d},800", "text": "Okay."} for i in range(1, 15)]
    cues[9]["text"] = "Why would you do that?!"
    assert any(cue["index"] == 10 for cue in representative_cues(cues, 5))


def test_connected_sentence_groups_up_to_five_cues():
    content = (
        "1\n00:00:01,000 --> 00:00:01,700\nThe message that was sent\n\n"
        "2\n00:00:01,800 --> 00:00:02,500\nby the manager\n\n"
        "3\n00:00:02,600 --> 00:00:03,300\nto the entire team\n\n"
        "4\n00:00:03,400 --> 00:00:04,100\nwas deleted\n\n"
        "5\n00:00:04,200 --> 00:00:05,000\nbefore anyone read it.\n\n"
        "6\n00:00:06,000 --> 00:00:07,000\nWhat happened?\n"
    )
    groups = detect_dialogue_groups(parse_srt(content))
    assert [cue["index"] for cue in groups[0]] == [1, 2, 3, 4, 5]
    assert [cue["index"] for cue in groups[1]] == [6]


def test_group_never_exceeds_five_cues():
    cues = [{"index": i, "start": f"00:00:{i:02d},000", "end": f"00:00:{i:02d},700", "text": "unfinished fragment"} for i in range(1, 8)]
    groups = detect_dialogue_groups(cues)
    assert max(len(group) for group in groups) == 5
