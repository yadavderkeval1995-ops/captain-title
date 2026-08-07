"""Deterministic phrase grouping for timed caption words.

The helper never creates, drops, or reorders words. It only assigns existing words
into display phrases and applies a conservative emphasis policy.
"""
from __future__ import annotations

import re
from typing import Iterable

_SENTENCE_END = re.compile(r"[.!?।…]+[\"')\]]*$")
_SOFT_END = re.compile(r"[,;:]+[\"')\]]*$")
_EMPHATIC = re.compile(r"^(?:bahut|bilkul|sirf|never|always|must|zaroor|important|best|worst|nahi|mat)$", re.I)


def _display_text(words: Iterable[dict]) -> str:
    return " ".join(str(w.get("text") or w.get("original") or "").strip() for w in words).strip()


def _phrase_emphasis(words: list[dict], max_ratio: float = 0.20) -> None:
    """Keep AI emphasis only when plausible and add sparse lexical emphasis.

    Uncertain words are never emphasized. At most 20% of a phrase (and normally
    one word) is emphasized, preventing noisy karaoke-style highlighting.
    """
    if not words:
        return
    candidates = []
    for pos, word in enumerate(words):
        text = str(word.get("text") or word.get("original") or "").strip(".,!?।…:;\"'")
        ai_vote = bool(word.get("important"))
        heuristic = bool(_EMPHATIC.match(text)) or (len(text) >= 8 and pos > 0)
        if not word.get("uncertain") and (ai_vote or heuristic):
            candidates.append((0 if ai_vote else 1, -len(text), pos))
        word["important"] = False
    allowance = min(max(1, int(len(words) * max_ratio)), 2)
    for _, _, pos in sorted(candidates)[:allowance]:
        words[pos]["important"] = True


def create_caption_groups(
    words: list[dict], *, max_words: int = 8, max_duration: float = 3.6,
    max_chars: int = 42, hard_pause: float = 0.72, soft_pause: float = 0.38,
) -> list[dict]:
    """Group timed words into natural, readable phrases.

    Boundaries prefer sentence punctuation and silence, then commas, duration,
    word count, and line length. Returned groups reference copies of input word
    dictionaries; their flattened order and timestamps exactly match the input.
    """
    if not words:
        return []
    groups: list[dict] = []
    current: list[dict] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        _phrase_emphasis(current)
        groups.append({
            "index": len(groups), "start": float(current[0]["start"]),
            "end": float(current[-1]["end"]), "text": _display_text(current),
            "words": current,
        })
        current = []

    for source in words:
        word = dict(source)
        if current:
            gap = max(0.0, float(word["start"]) - float(current[-1]["end"]))
            proposed = current + [word]
            exceeds = (len(proposed) > max_words or
                       float(word["end"]) - float(current[0]["start"]) > max_duration or
                       len(_display_text(proposed)) > max_chars)
            prior_text = str(current[-1].get("text") or current[-1].get("original") or "")
            if gap >= hard_pause or _SENTENCE_END.search(prior_text) or exceeds:
                flush()
            elif gap >= soft_pause and (len(current) >= 3 or _SOFT_END.search(prior_text)):
                flush()
        current.append(word)
        text = str(word.get("text") or word.get("original") or "")
        if _SENTENCE_END.search(text):
            flush()
    flush()
    return groups


# Compatibility-friendly alias for callers that use a noun-like helper name.
caption_groups = create_caption_groups
