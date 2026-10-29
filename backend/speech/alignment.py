"""Global alignment of two transcripts of the same audio: Sarvam's text onto
Whisper's word timing (the "hybrid" provider)."""
from difflib import SequenceMatcher


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _align_words(whisper_tokens: list[str], sarvam_tokens: list[str]):
    """Needleman-Wunsch style global alignment between Whisper's and Sarvam's
    word sequences for one chunk, using fuzzy string similarity as the match
    score. Both engines hear the same audio in the same order, so the two
    sequences are usually close to the same length - this lines them up
    positionally and only introduces a skip where they genuinely disagree on
    word count (a word one engine missed or merged), rather than trusting
    either engine's exact spelling to decide the alignment."""
    n, m = len(whisper_tokens), len(sarvam_tokens)
    gap = -0.6
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    choice = [[""] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = dp[i - 1][0] + gap
        choice[i][0] = "skip_whisper"
    for j in range(1, m + 1):
        dp[0][j] = dp[0][j - 1] + gap
        choice[0][j] = "skip_sarvam"
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            match_score = _similarity(whisper_tokens[i - 1], sarvam_tokens[j - 1]) - 0.4
            best_score, best_choice = dp[i - 1][j - 1] + match_score, "match"
            if dp[i - 1][j] + gap > best_score:
                best_score, best_choice = dp[i - 1][j] + gap, "skip_whisper"
            if dp[i][j - 1] + gap > best_score:
                best_score, best_choice = dp[i][j - 1] + gap, "skip_sarvam"
            dp[i][j] = best_score
            choice[i][j] = best_choice
    ops = []
    i, j = n, m
    while i > 0 or j > 0:
        kind = choice[i][j]
        if kind == "match":
            ops.append(("match", i - 1, j - 1)); i -= 1; j -= 1
        elif kind == "skip_whisper":
            ops.append(("skip_whisper", i - 1)); i -= 1
        else:
            ops.append(("skip_sarvam", j - 1)); j -= 1
    ops.reverse()
    return ops


def _emit_interpolated(result: list[dict], texts: list[str], start: float, end: float):
    """Give a run of Sarvam words that Whisper never produced a timing slot
    of its own, by evenly spacing them across the gap between their
    neighboring matched words."""
    end = max(end, start + 0.1)
    step = max(0.08, (end - start) / len(texts))
    for offset, text in enumerate(texts):
        word_start = start + offset * step
        result.append({"original": text, "start": round(word_start, 3), "end": round(min(end, word_start + step), 3)})


def _detect_merged_matches(ops: list[tuple], whisper_tokens: list[str], sarvam_tokens: list[str]):
    """Find whisper word indices caught up in a Sarvam word-merge: on fast
    Hindi speech, Sarvam sometimes recognizes several spoken words as ONE
    run-on token with no internal spacing. The aligner then fuzzy-matches
    that oversized token to whichever single Whisper word scores best and
    "skip_whisper"s the Whisper words on either side of it as unmatched -
    which normally means a Whisper-only hallucination to discard, but here
    means the other whisper-tokenized words the merged blob actually spans.
    Flags a match as a merge (by its matched whisper index) only when the
    sarvam token is much longer than what it matched AND is bracketed by at
    least one such orphaned neighbor - an ordinary long single word, matched
    cleanly with no orphaned neighbors, is left alone."""
    merged = set()
    n = len(ops)
    for idx, op in enumerate(ops):
        if op[0] != "match":
            continue
        i, j = op[1], op[2]
        sarvam_word = sarvam_tokens[j]
        if len(sarvam_word) < 9 or len(sarvam_word) < 2.3 * max(1, len(whisper_tokens[i])):
            continue
        before = idx - 1
        while before >= 0 and ops[before][0] == "skip_whisper":
            before -= 1
        after = idx + 1
        while after < n and ops[after][0] == "skip_whisper":
            after += 1
        if before + 1 == idx and after == idx + 1:
            continue  # no orphaned neighbors - an ordinary long single-word match
        for k in range(before + 1, after):
            if ops[k][0] == "skip_whisper":
                merged.add(ops[k][1])
        merged.add(i)
    return merged


def _stitch_chunk(whisper_words: list[dict], sarvam_text: str):
    """Replace Whisper's (less accurate) words with Sarvam's recognized
    words, while keeping Whisper's per-word timing."""
    sarvam_tokens = sarvam_text.split()
    if not whisper_words or not sarvam_tokens:
        return []
    whisper_tokens = [word["original"] for word in whisper_words]
    ops = _align_words(whisper_tokens, sarvam_tokens)
    merged_indices = _detect_merged_matches(ops, whisper_tokens, sarvam_tokens)
    result = []
    pending: list[str] = []
    last_end = whisper_words[0]["start"]
    for op in ops:
        kind = op[0]
        if kind == "match":
            i, j = op[1], op[2]
            if pending:
                _emit_interpolated(result, pending, last_end, whisper_words[i]["start"])
                pending = []
            # A merge-flagged match uses Whisper's own (less accurate, but
            # correctly segmented) word instead of Sarvam's unsplittable
            # run-on blob - GPT's Hinglish pass still corrects its spelling
            # from context same as any other ASR word.
            text = whisper_tokens[i] if i in merged_indices else sarvam_tokens[j]
            result.append({"original": text, "start": whisper_words[i]["start"], "end": whisper_words[i]["end"]})
            last_end = whisper_words[i]["end"]
        elif kind == "skip_whisper":
            i = op[1]
            if i in merged_indices:
                # One of the words a neighboring merge swallowed - recover it
                # with its own Whisper text/timing instead of dropping it.
                if pending:
                    _emit_interpolated(result, pending, last_end, whisper_words[i]["start"])
                    pending = []
                result.append({"original": whisper_tokens[i], "start": whisper_words[i]["start"], "end": whisper_words[i]["end"]})
                last_end = whisper_words[i]["end"]
            else:
                # A Whisper word with no Sarvam counterpart - likely a Whisper
                # mis-hearing or hallucination Sarvam didn't reproduce. Drop
                # the word but keep its timing as a continuity anchor.
                last_end = max(last_end, whisper_words[i]["end"])
        else:
            pending.append(sarvam_tokens[op[1]])
    if pending:
        end_anchor = max(whisper_words[-1]["end"], last_end + 0.1 * len(pending))
        _emit_interpolated(result, pending, last_end, end_anchor)
    return result
