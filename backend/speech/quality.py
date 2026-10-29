"""Repetition metrics used as safety rails against looping/hallucinated
transcripts."""
import re
from collections import Counter


def _tokens(text: str):
    return re.findall(r"[\wऀ-ॿ]+", text.lower(), flags=re.UNICODE)


def _repetition_metrics(tokens: list[str]):
    if not tokens:
        return {"unique_ratio": 0.0, "bigram_ratio": 1.0, "ngram_repeat": 99, "penalty": 4.0}
    unique_ratio = len(set(tokens)) / len(tokens)
    bigrams = list(zip(tokens, tokens[1:]))
    most_common_bigram = Counter(bigrams).most_common(1)[0][1] if bigrams else 0
    bigram_ratio = most_common_bigram / max(1, len(bigrams))
    fourgrams = list(zip(tokens, tokens[1:], tokens[2:], tokens[3:]))
    ngram_repeat = Counter(fourgrams).most_common(1)[0][1] if fourgrams else 0
    penalty = 0.0
    if len(tokens) >= 12 and unique_ratio < 0.35:
        penalty += (0.35 - unique_ratio) * 5
    if most_common_bigram >= 4:
        penalty += bigram_ratio * 3
    if ngram_repeat >= 3:
        penalty += 2.5
    return {"unique_ratio": unique_ratio, "bigram_ratio": bigram_ratio,
            "ngram_repeat": ngram_repeat, "penalty": penalty}
