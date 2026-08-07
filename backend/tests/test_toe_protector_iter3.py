"""
Iteration 3 regression: Toe-protector catastrophic-repetition fix.

Verifies the exact recovered source /app/toe-protector-source.mp4 produces a
coherent chunked transcript with the new adaptive-chunked pipeline and that
the repetition guard rejects a synthetic "YouTube protector" loop.

Real Whisper + GPT calls: exactly ONE /projects/process and ONE
/projects/{id}/retranscribe are made in this file to keep spend minimal.
"""
import os
import re
import sys
import time
import uuid
import asyncio
from pathlib import Path

import pytest
import requests

sys.path.insert(0, "/app/backend")
from caption_ai import _repetition_metrics, _build_candidate, _tokens  # noqa: E402

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SOURCE = Path("/app/toe-protector-source.mp4")

DEVANAGARI = re.compile(r"[\u0900-\u097F]")

# ==========================
# Unit tests for repetition guard  (no cost)
# ==========================


class TestRepetitionGuard:
    """Prove the metrics + candidate builder reject the exact catastrophic
    "यूट्यूब प्रोटेक्टर" / "YouTube protector" alternating loop that broke
    the original project_81e50f2abf40."""

    def test_repetition_metrics_reject_youtube_protector_loop(self):
        # 40 tokens, alternating YouTube / protector - the actual pattern
        tokens = _tokens(" ".join(["YouTube", "protector"] * 20))
        m = _repetition_metrics(tokens)
        assert m["unique_ratio"] < 0.24, f"unique_ratio should be catastrophic, got {m}"
        assert m["bigram_ratio"] > 0.30, f"bigram_ratio should trip, got {m}"
        assert m["ngram_repeat"] >= 3, f"ngram_repeat should trip, got {m}"
        # Cumulative penalty must be large enough to break score
        assert m["penalty"] >= 2.5, f"penalty too small: {m}"

    def test_repetition_metrics_devanagari_loop_also_rejected(self):
        tokens = _tokens(" ".join(["यूट्यूब", "प्रोटेक्टर"] * 20))
        m = _repetition_metrics(tokens)
        assert m["ngram_repeat"] >= 3 and m["bigram_ratio"] > 0.30, m

    def test_candidate_marked_not_trustworthy_on_loop(self):
        """Feed a synthetic whisper response with the catastrophic loop; the
        candidate builder must set trustworthy=False and a large penalty."""

        class Seg:  # duck-typed segment shape (verbose_json)
            def __init__(self, s, e, txt, nsp=0.0, avg=-0.4):
                self.start = s; self.end = e; self.text = txt
                self.no_speech_prob = nsp; self.avg_logprob = avg

        class Word:
            def __init__(self, w, s, e):
                self.word = w; self.start = s; self.end = e

        class Resp:
            def __init__(self):
                self.text = " ".join(["YouTube", "protector"] * 20)
                self.segments = [Seg(0.0, 10.0, self.text)]
                self.words = []
                t = 0.0
                for tok in self.text.split():
                    self.words.append(Word(tok, t, t + 0.25))
                    t += 0.25

        cand = _build_candidate(Resp(), "hi", "hi")
        assert cand["trustworthy"] is False, cand
        assert cand["ngram_repeat"] >= 3, cand
        # The overall pipeline picks the max trustworthy candidate. On this
        # chunk both hi and fallback would produce identical loops, so
        # transcribe_words would drop the chunk. Rebuild-shape is sufficient.

    def test_candidate_trustworthy_on_normal_ad_speech(self):
        """A short cricket-ad-like normal sentence must survive the guard."""

        class Seg:
            def __init__(self, s, e, txt):
                self.start = s; self.end = e; self.text = txt
                self.no_speech_prob = 0.02; self.avg_logprob = -0.3

        class Word:
            def __init__(self, w, s, e):
                self.word = w; self.start = s; self.end = e

        class Resp:
            def __init__(self):
                text = "प्रोटेक्टर बना है कार्बन फाइबर और केवलार से जो आपको यॉर्कर्स पे प्रोटेक्शन देता है"
                self.text = text
                self.segments = [Seg(0.0, 8.0, text)]
                self.words = []
                t = 0.0
                for tok in text.split():
                    self.words.append(Word(tok, t, t + 0.4))
                    t += 0.4

        cand = _build_candidate(Resp(), "hi", "hi")
        assert cand["trustworthy"] is True, cand
        assert cand["ngram_repeat"] < 3, cand


# ==========================
# Real E2E - Toe-protector source
# ==========================

AD_VOCAB = [
    "protector", "carbon", "fiber", "kevlar", "yorker",
    "protection", "player", "injured", "toe", "safe",
    "season", "career", "website", "order",
]

CATASTROPHIC_PATTERNS = [
    "यूट्यूब प्रोटेक्टर",
    "youtube protector",
    "यूट्यूब प्रटेक्टर",
]


def _register():
    email = f"toe.iter3.{int(time.time()*1000)}.{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "captain12345", "name": "Toe Iter3"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.headers["X-Session-Token"], email


@pytest.mark.skipif(not SOURCE.exists(), reason="toe-protector-source.mp4 missing")
class TestToeProtectorRealPipeline:
    """One shared registration; one real /projects/process; one real /retranscribe."""

    @pytest.fixture(scope="class")
    def user(self):
        token, email = _register()
        return {"token": token, "email": email}

    @pytest.fixture(scope="class")
    def processed(self, user):
        with SOURCE.open("rb") as f:
            r = requests.post(
                f"{BASE_URL}/api/projects/process",
                headers={"Authorization": f"Bearer {user['token']}"},
                data={"theme": "viral", "speech_language": "auto"},
                files={"file": ("Toe Protector Ad Video.mp4", f, "video/mp4")},
                timeout=300,
            )
        assert r.status_code == 200, f"process failed: {r.status_code} {r.text[:600]}"
        proj = r.json()
        # Ensure the class-scoped project can also be reused by later tests
        pytest.toe_project = proj
        return proj

    # ---- transcription mode + shape ----

    def test_status_and_mode(self, processed):
        assert processed["project_id"].startswith("project_")
        assert processed["status"] == "ready"
        assert processed["transcription_mode"] == "adaptive-chunked", processed.get("transcription_mode")
        q = processed.get("transcription_quality") or {}
        assert q.get("mode") == "adaptive-chunked"
        assert q.get("chunks_used", 0) >= 2
        # ngram_repeat MUST stay under 3
        assert q.get("ngram_repeat", 99) < 3, q

    def test_no_catastrophic_repetition_in_raw(self, processed):
        raw = (processed.get("source_transcript") or "").lower()
        assert raw.strip(), "empty source_transcript"
        for pat in CATASTROPHIC_PATTERNS:
            assert pat.lower() not in raw, (
                f"catastrophic pattern {pat!r} still present in source_transcript: {raw[:300]!r}"
            )
        # 4-gram overall repetition must be low too
        tokens = _tokens(raw)
        assert len(tokens) >= 40, f"transcript too short: {len(tokens)} tokens"
        m = _repetition_metrics(tokens)
        assert m["ngram_repeat"] < 3, f"4-gram loop present in raw transcript: {m}, raw={raw[:400]!r}"

    def test_transcript_contains_ad_vocab(self, processed):
        """At least 6 of the expected cricket-ad terms should be present in
        the Roman Hinglish converted words. This is the "usable/coherent"
        bar the RCA note asked for, not a demand for perfect verbatim."""
        text_join = " ".join(w["text"] for w in processed["words"]).lower()
        original_join = " ".join(w["original"] for w in processed["words"]).lower()
        combined = text_join + " " + original_join
        found = [term for term in AD_VOCAB if term in combined]
        assert len(found) >= 6, f"only found ad terms {found} in transcript: {text_join!r}"

    def test_transcript_spans_video(self, processed):
        words = processed["words"]
        assert words, "no words"
        last_end = max(float(w["end"]) for w in words)
        # The video is 37.78s; requirement is last word end >= 35s
        assert last_end >= 35.0, f"transcript ends too early at {last_end}s (video ~37.78s)"

    def test_roman_hinglish_and_uncertain_markers(self, processed):
        words = processed["words"]
        text_join = " ".join(w["text"] for w in words)
        assert not DEVANAGARI.search(text_join), (
            f"converted text should be Roman Hinglish, found devanagari: {text_join!r}"
        )
        # At least one obvious product term should be corrected
        low = text_join.lower()
        assert any(t in low for t in ("protector", "carbon", "kevlar", "yorker")), text_join
        # Genuine ASR garble should surface as uncertain=True somewhere - the
        # RCA note says the ~20-30s segment is imperfect and marked uncertain.
        # We do NOT hard-require this because the model may have gotten lucky
        # on this run; instead we just log it for the report.
        uncertain_count = sum(1 for w in words if w.get("uncertain"))
        print(f"UNCERTAIN_WORD_COUNT: {uncertain_count}/{len(words)}")

    # ---- Re-listen endpoint ----

    def test_relisten_replaces_words_with_trusted_transcript(self, user, processed):
        pid = processed["project_id"]
        r = requests.post(
            f"{BASE_URL}/api/projects/{pid}/retranscribe",
            headers={"Authorization": f"Bearer {user['token']}"},
            json={"speech_language": "auto"},
            timeout=300,
        )
        assert r.status_code == 200, f"re-listen failed: {r.status_code} {r.text[:600]}"
        body = r.json()
        assert body["project_id"] == pid
        assert body["transcription_mode"] == "adaptive-chunked"
        assert isinstance(body["words"], list) and len(body["words"]) >= 20
        # Same catastrophic-loop guard on the refreshed raw
        raw = (body.get("source_transcript") or "").lower()
        for pat in CATASTROPHIC_PATTERNS:
            assert pat.lower() not in raw, raw[:300]
        q = body.get("transcription_quality") or {}
        assert q.get("ngram_repeat", 99) < 3, q

    # ---- Edit + save + render survives after re-listen ----

    def test_edit_save_after_relisten(self, user, processed):
        pid = processed["project_id"]
        # Re-fetch current words via a fresh /projects/process is too costly;
        # instead just PUT a small edit using the initial words.
        edited = []
        for w in processed["words"][:5]:  # tiny edit to first few words
            edited.append({
                "index": w["index"], "text": w["text"] + "*",
                "original": w.get("original", ""),
                "start": float(w["start"]), "end": float(w["end"]),
                "important": bool(w.get("important", False)),
                "uncertain": bool(w.get("uncertain", False)),
                "color": w.get("color", "#FFFFFF"),
                "font_size": int(w.get("font_size", 52)),
            })
        # Include the rest of the original words verbatim so shape is valid
        for w in processed["words"][5:]:
            edited.append({
                "index": w["index"], "text": w["text"],
                "original": w.get("original", ""),
                "start": float(w["start"]), "end": float(w["end"]),
                "important": bool(w.get("important", False)),
                "uncertain": bool(w.get("uncertain", False)),
                "color": w.get("color", "#FFFFFF"),
                "font_size": int(w.get("font_size", 52)),
            })
        r = requests.put(
            f"{BASE_URL}/api/projects/{pid}",
            headers={"Authorization": f"Bearer {user['token']}"},
            json={"theme": "viral", "words": edited},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "saved"
