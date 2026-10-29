"""Word timing helpers shared by all providers."""


def _spread_words(text: str, start: float, end: float):
    """Split one timed phrase into words, sharing its span in proportion to
    each word's length (+2 so short words like "hai" still get a readable
    slot). An estimate - real per-word timing only comes from Whisper."""
    tokens = text.split()
    weights = [len(token) + 2 for token in tokens]
    total = sum(weights) or 1
    words, cursor = [], start
    for token, weight in zip(tokens, weights):
        duration = (end - start) * weight / total
        words.append({"original": token, "start": round(cursor, 3), "end": round(cursor + duration, 3)})
        cursor += duration
    return words


def _normalize_word_timings(words: list[dict]):
    """Keep native alignment while making zero-length API timestamps visible."""
    previous_start = 0.0
    for index, word in enumerate(words):
        start = max(float(word["start"]), previous_start)
        end = max(float(word["end"]), start + 0.06)
        if index + 1 < len(words):
            next_start = float(words[index + 1]["start"])
            if next_start >= start + 0.06:
                end = min(end, next_start)
        word["start"] = round(start, 3)
        word["end"] = round(end, 3)
        previous_start = start
    return words
