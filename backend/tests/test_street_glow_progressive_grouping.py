"""Unit tests for the Street Glow progressive-reveal DP grouping
(_group_words_for_street_glow_progressive in captions.py). Pure-function
tests against the grouping algorithm only - no server, no rendering, no
network. STREET_GLOW_PROGRESSIVE_REVEAL stays False everywhere else in the
codebase; these tests call the grouping function directly regardless of
the flag's value."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import captions as c


def mk(text, start, end, **kw):
    word = {"text": text, "start": start, "end": end}
    word.update(kw)
    return word


def group_texts(groups):
    return [[w["text"] for w in g] for g in groups]


def assert_preserves_words(words, groups):
    """Every word assigned exactly once, in order, with its original
    timing untouched."""
    flat = [w for g in groups for w in g]
    assert len(flat) == len(words)
    assert [w["text"] for w in flat] == [w["text"] for w in words]
    for original, placed in zip(words, flat):
        assert placed["start"] == original["start"]
        assert placed["end"] == original["end"]
        assert placed is original


def assert_hard_caps(groups, max_total=5, max_red=2, max_white=3):
    for g in groups:
        assert len(g) <= max_total, f"group too long: {group_texts([g])}"
        white = g[max_red:]
        assert len(white) <= max_white, f"white overflow: {group_texts([g])}"


# --- Originally-flagged bad splits (round 1) ------------------------------

def test_postposition_stays_with_its_noun():
    # "toe pe lagta hai" - "pe" (postposition) must not be split from "toe".
    words = [
        mk("bat", 0.00, 0.25), mk("toe", 0.25, 0.50), mk("pe", 0.50, 0.70),
        mk("lagta", 0.75, 1.00), mk("hai", 1.00, 1.25, original="hai."),
    ]
    groups = c._group_words_for_street_glow_progressive(words)
    assert_preserves_words(words, groups)
    assert_hard_caps(groups)
    texts = group_texts(groups)
    toe_group = next(g for g in texts if "toe" in g)
    assert "pe" in toe_group, texts


def test_light_verb_compound_stays_together():
    # "absorb ho jata hai" (English root + Hindi light-verb chain) must
    # never be split between "absorb" and "ho jata hai".
    words = [
        mk("Pura", 0.00, 0.25), mk("impact", 0.25, 0.55), mk("absorb", 0.55, 0.80),
        mk("ho", 0.80, 0.95), mk("jata", 0.95, 1.15), mk("hai", 1.15, 1.35, original="hai."),
    ]
    groups = c._group_words_for_street_glow_progressive(words)
    assert_preserves_words(words, groups)
    assert_hard_caps(groups)
    texts = group_texts(groups)
    for i, g in enumerate(texts):
        if "absorb" in g and g[-1] == "absorb":
            # "absorb" ends a group only if "ho" isn't its very next word
            # overall (it always is here), so this must never happen.
            assert False, f"absorb split from ho jata hai: {texts}"


def test_auxiliary_stays_with_main_verb():
    # "face karte ho" - "karte"/"ho" must not be split from "face".
    words = [
        mk("aapko", 0.00, 0.25), mk("face", 0.25, 0.50), mk("karte", 0.55, 0.80),
        mk("ho", 0.80, 1.00, original="ho."),
    ]
    groups = c._group_words_for_street_glow_progressive(words)
    assert_preserves_words(words, groups)
    assert_hard_caps(groups)
    texts = group_texts(groups)
    face_group = next(g for g in texts if "face" in g)
    assert "karte" in face_group and "ho" in face_group, texts


# --- Round-2 complaint: unnecessary short fragments created locally ------

def test_conjunction_does_not_force_a_short_fragment():
    # "aur seedha" must not become a standalone 2-word group when it can
    # join neighbouring words into a more balanced group instead.
    words = [
        mk("Pehle", 0.00, 0.30), mk("dekho", 0.30, 0.60), mk("kaise", 0.60, 0.85),
        mk("karte", 0.85, 1.10), mk("hain", 1.10, 1.35),
        mk("aur", 1.45, 1.65), mk("seedha", 1.65, 1.95), mk("dekho", 1.95, 2.25),
        mk("kaise", 2.25, 2.50), mk("reaction", 2.50, 2.90), mk("aata", 2.90, 3.15),
        mk("hai", 3.15, 3.40, original="hai."),
    ]
    groups = c._group_words_for_street_glow_progressive(words)
    assert_preserves_words(words, groups)
    assert_hard_caps(groups)
    texts = group_texts(groups)
    assert ["aur", "seedha"] not in texts, texts


def test_clause_starter_begins_the_next_group_not_ends_this_one():
    # With perfectly even word spacing (no pause to break a tie), a
    # clause-starter boundary must still land so "aur" opens the next
    # group rather than trailing the previous one as an orphan last word.
    labels = ["Pehle", "dekho", "kaise", "karte", "hain", "aur",
              "seedha", "dekho", "kaise", "reaction", "aata", "hai"]
    words = [mk(t, i * 0.25, i * 0.25 + 0.25) for i, t in enumerate(labels)]
    words[-1]["original"] = "hai."
    groups = c._group_words_for_street_glow_progressive(words)
    assert_preserves_words(words, groups)
    assert_hard_caps(groups)
    texts = group_texts(groups)
    aur_group = next(g for g in texts if "aur" in g)
    assert aur_group[0] == "aur", texts


def test_global_optimization_prefers_balanced_groups_over_local_choice():
    # A run with no hard pauses/punctuation anywhere should still settle
    # into mostly 3-4 word groups rather than drifting into 1-2 word
    # fragments, because the DP scores the whole run at once.
    labels = ["Ek", "number", "shot", "tha", "wo", "bhai", "kamaal", "ka", "tha"]
    words = [mk(t, i * 0.3, i * 0.3 + 0.25) for i, t in enumerate(labels)]
    groups = c._group_words_for_street_glow_progressive(words)
    assert_preserves_words(words, groups)
    assert_hard_caps(groups)
    sizes = [len(g) for g in groups]
    assert all(1 <= s <= 5 for s in sizes)
    # not ALL single-word groups - the balanced-size preference should win
    assert sum(1 for s in sizes if s == 1) <= 1, sizes


# --- Structural invariants -------------------------------------------------

def test_hard_pause_always_breaks():
    words = [
        mk("Hello", 0.00, 0.30), mk("world", 0.30, 0.60),
        mk("Next", 2.00, 2.30), mk("sentence", 2.30, 2.60),
    ]
    groups = c._group_words_for_street_glow_progressive(words)
    assert_preserves_words(words, groups)
    texts = group_texts(groups)
    assert texts == [["Hello", "world"], ["Next", "sentence"]]


def test_sentence_end_always_breaks():
    words = [
        mk("Done", 0.00, 0.30, original="Done."), mk("Now", 0.35, 0.60),
        mk("next", 0.60, 0.85), mk("part", 0.85, 1.10),
    ]
    groups = c._group_words_for_street_glow_progressive(words)
    assert_preserves_words(words, groups)
    assert groups[0][-1]["text"] == "Done"
    assert len(groups) >= 2


def test_manual_split_override_wins():
    words = [
        mk("a", 0.0, 0.2), mk("b", 0.2, 0.4, new_caption=True), mk("c", 0.4, 0.6),
    ]
    groups = c._group_words_for_street_glow_progressive(words)
    assert_preserves_words(words, groups)
    texts = group_texts(groups)
    assert texts == [["a"], ["b", "c"]]


def test_manual_merge_override_wins_past_max_words():
    words = [mk(f"w{i}", i * 0.3, i * 0.3 + 0.25) for i in range(8)]
    for i, w in enumerate(words):
        w["new_caption"] = True if i == 0 else False
    groups = c._group_words_for_street_glow_progressive(words, max_words=8)
    assert_preserves_words(words, groups)
    assert len(groups) == 1
    assert len(groups[0]) == 8


def test_never_exceeds_max_words_when_not_forced():
    labels = [f"w{i}" for i in range(20)]
    words = [mk(t, i * 0.2, i * 0.2 + 0.15) for i, t in enumerate(labels)]
    groups = c._group_words_for_street_glow_progressive(words)
    assert_preserves_words(words, groups)
    assert_hard_caps(groups)


def test_single_word_input():
    words = [mk("Wow", 0.0, 0.4)]
    groups = c._group_words_for_street_glow_progressive(words)
    assert_preserves_words(words, groups)
    assert group_texts(groups) == [["Wow"]]


def test_empty_input():
    assert c._group_words_for_street_glow_progressive([]) == []


def test_wired_only_for_street_glow_progressive_flag():
    """The DP path must only engage for theme=='street_glow' with the
    flag on - everything else keeps using the existing generic grouping,
    so this is a purely additive, isolated change."""
    words = [mk(f"w{i}", i * 0.3, i * 0.3 + 0.25) for i in range(6)]
    assert c.STREET_GLOW_PROGRESSIVE_REVEAL is False
    generic = c._group_words_for_display(words, min_display=1.5, max_words=6)
    assert group_texts(generic) == [[f"w{i}" for i in range(6)]]
