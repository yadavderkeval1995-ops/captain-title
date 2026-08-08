from srt_localization import build_srt, detect_dialogue_groups, parse_srt


def test_fast_mode_requires_only_valid_srt_semantics():
    cues = parse_srt("1\n00:00:01,000 --> 00:00:02,000\nHello there.\n")
    assert cues[0]["text"] == "Hello there."


def test_fast_and_video_modes_share_bilingual_export():
    cues = parse_srt("1\n00:00:01,000 --> 00:00:02,000\nHello there.\n")
    cues[0]["translated_text"] = "नमस्ते।"
    assert "Hello there.\nनमस्ते।" in build_srt(cues)


def test_fast_mode_keeps_semantic_grouping():
    cues = parse_srt("1\n00:00:01,000 --> 00:00:02,000\nThe letter written\n\n2\n00:00:02,100 --> 00:00:03,000\nby her was lost.\n")
    assert [item["index"] for item in detect_dialogue_groups(cues)[0]] == [1, 2]
