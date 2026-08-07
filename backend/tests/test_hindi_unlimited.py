"""
Iteration 2 focused regression: unlimited testing mode + Hindi/Hinglish real
Whisper transcription with no prompt leakage.

Covers:
- GET /api/usage returns unlimited_testing=True
- /api/projects/process runs with /app/hindi-hinglish-test.mp4 without decrementing
  free_remaining (entitlement="testing"), videos_created increments
- Devanagari source_transcript returned, no "Do not translate" / "Do not translate or rewrite"
  leakage anywhere in the transcript or words
- Roman Hinglish converted words in the returned words[] (ASCII-only text)
- Second /projects/process call succeeds under unlimited testing (free_remaining stays 1)
- speech_language=hi accepted; unknown value is 400
"""
import os
import re
import time
import uuid
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SAMPLE = Path("/app/hindi-hinglish-test.mp4")

DEVANAGARI = re.compile(r"[\u0900-\u097F]")
PROMPT_LEAK_PATTERNS = [
    "do not translate",
    "do not rewrite",
    "do not translate or rewrite",
    "do not paraphrase",
]


def _register():
    email = f"hindi.pytest.{int(time.time()*1000)}.{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": "captain123", "name": "Hindi Test"},
                      timeout=30)
    assert r.status_code == 200, r.text
    return r.headers["X-Session-Token"], email


class TestUnlimitedFlag:
    def test_usage_reports_unlimited_testing_true(self):
        token, _ = _register()
        r = requests.get(f"{BASE_URL}/api/usage",
                         headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert r.status_code == 200
        u = r.json()
        # This iteration explicitly enables unlimited testing in backend/.env
        assert u["unlimited_testing"] is True, f"expected unlimited_testing True, got {u}"
        assert u["free_remaining"] == 1
        assert u["videos_created"] == 0
        assert u["oneoff_credits"] == 0
        assert u["basic_credits"] == 0


class TestProcessValidation:
    def test_unknown_speech_language_rejected(self):
        token, _ = _register()
        if not SAMPLE.exists():
            pytest.skip("hindi sample missing")
        with SAMPLE.open("rb") as f:
            r = requests.post(
                f"{BASE_URL}/api/projects/process",
                headers={"Authorization": f"Bearer {token}"},
                data={"theme": "viral", "speech_language": "fr"},
                files={"file": ("hindi.mp4", f, "video/mp4")},
                timeout=60,
            )
        assert r.status_code == 400, r.text
        assert "language" in r.text.lower()


@pytest.mark.skipif(not SAMPLE.exists(), reason="hindi sample missing")
class TestHindiPipelineUnlimited:
    """One shared registration; two real Whisper+GPT calls to keep spend minimal."""

    @pytest.fixture(scope="class")
    def user(self):
        token, email = _register()
        return {"token": token, "email": email}

    def _process(self, token, language="hi"):
        with SAMPLE.open("rb") as f:
            return requests.post(
                f"{BASE_URL}/api/projects/process",
                headers={"Authorization": f"Bearer {token}"},
                data={"theme": "viral", "speech_language": language},
                files={"file": ("hindi-hinglish-test.mp4", f, "video/mp4")},
                timeout=240,
            )

    def test_first_run_hindi_real_transcript_and_no_prompt_leak(self, user):
        r = self._process(user["token"], "hi")
        assert r.status_code == 200, f"process failed: {r.status_code} {r.text[:400]}"
        project = r.json()
        # Structural guarantees
        assert project["project_id"].startswith("project_")
        assert project["theme"] == "viral"
        assert project["speech_language"] == "hi"
        assert 0 < project["duration"] <= 120
        assert project["status"] == "ready"
        assert isinstance(project["words"], list) and len(project["words"]) >= 3

        # === Source transcript checks ===
        src = project.get("source_transcript") or ""
        assert src.strip(), "empty source_transcript"
        # Real hindi speech must contain Devanagari characters
        assert DEVANAGARI.search(src), f"no devanagari in source_transcript: {src!r}"
        # Prompt leakage regression
        low = src.lower()
        for pattern in PROMPT_LEAK_PATTERNS:
            assert pattern not in low, (
                f"Whisper prompt leaked into transcript ({pattern!r}): {src!r}"
            )
        # Save for other assertions
        pytest.hindi_project_id = project["project_id"]
        pytest.hindi_source_transcript = src
        pytest.hindi_words = project["words"]
        print(f"SOURCE_TRANSCRIPT: {src}")

    def test_first_run_hinglish_words_are_roman(self, user):
        words = getattr(pytest, "hindi_words", None)
        assert words, "prior test must have populated words"
        # Each word has required schema
        for w in words[:5]:
            for k in ("index", "text", "original", "start", "end", "important", "color", "font_size"):
                assert k in w
            assert w["end"] >= w["start"]
        # "original" side (whisper heard) should carry devanagari overall
        original_join = " ".join(w["original"] for w in words)
        assert DEVANAGARI.search(original_join), f"words[].original missing devanagari: {original_join!r}"
        # Converted "text" must be primarily Roman (Hinglish) - no devanagari
        text_join = " ".join(w["text"] for w in words)
        assert not DEVANAGARI.search(text_join), f"converted text should be Roman Hinglish, got: {text_join!r}"
        # None of the converted words should leak prompt boilerplate
        low = text_join.lower()
        for pattern in PROMPT_LEAK_PATTERNS:
            assert pattern not in low, f"prompt leaked into converted words ({pattern!r}): {text_join!r}"
        print(f"HINGLISH_WORDS: {[w['text'] for w in words]}")

    def test_usage_after_first_run_free_remaining_unchanged(self, user):
        r = requests.get(f"{BASE_URL}/api/usage",
                         headers={"Authorization": f"Bearer {user['token']}"}, timeout=15)
        assert r.status_code == 200
        u = r.json()
        # Testing entitlement: free_remaining does NOT decrement
        assert u["unlimited_testing"] is True
        assert u["free_remaining"] == 1, u
        assert u["videos_created"] == 1, u

    def test_second_run_also_succeeds_under_unlimited(self, user):
        r = self._process(user["token"], "hi")
        assert r.status_code == 200, f"second process should succeed under unlimited testing: {r.status_code} {r.text[:400]}"
        body = r.json()
        assert body["status"] == "ready"

    def test_usage_after_second_run(self, user):
        r = requests.get(f"{BASE_URL}/api/usage",
                         headers={"Authorization": f"Bearer {user['token']}"}, timeout=15)
        assert r.status_code == 200
        u = r.json()
        assert u["unlimited_testing"] is True
        assert u["free_remaining"] == 1, u
        assert u["videos_created"] == 2, u
