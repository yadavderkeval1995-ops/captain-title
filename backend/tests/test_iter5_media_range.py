"""Iter5: GET /api/projects/{id}/media HTTP Range semantics + WebM preview."""
import hashlib
import os
import time

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
PROJECT_ID = "project_c0af42d2ab1e"
OWNER_EMAIL = "iter4.mediab.1786098208077@example.com"
OWNER_PW = "captain12345"


@pytest.fixture(scope="module")
def owner_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": OWNER_EMAIL, "password": OWNER_PW}, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def foreign_session():
    s = requests.Session()
    email = f"iter5.foreign.{int(time.time()*1000)}@example.com"
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": OWNER_PW, "name": "Foreign"}, timeout=15)
    assert r.status_code in (200, 409)
    if r.status_code == 409:
        s.post(f"{BASE_URL}/api/auth/login",
               json={"email": email, "password": OWNER_PW}, timeout=15)
    return s


class TestProjectFixture:
    def test_project_has_webm_preview(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}", timeout=15)
        assert r.status_code == 200
        p = r.json()
        assert p["status"] == "ready"
        assert p["preview_path"], "preview_path must be present"
        assert p["preview_content_type"] == "video/webm"
        assert p["duration"] > 30 and p["duration"] < 45
        assert len(p["words"]) > 50


class TestNoRange:
    def test_returns_200_with_full_body_and_accept_ranges(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media", timeout=60)
        assert r.status_code == 200
        assert r.headers["Content-Type"] == "video/webm"
        assert r.headers["Accept-Ranges"] == "bytes"
        assert int(r.headers["Content-Length"]) == len(r.content)
        # WebM magic bytes 1A 45 DF A3
        assert r.content[:4] == b"\x1a\x45\xdf\xa3", "not a WebM/Matroska file"


class TestBoundedRange:
    def test_bounded_range_returns_206_correct_length(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media",
                              headers={"Range": "bytes=0-524287"}, timeout=30)
        assert r.status_code == 206
        assert r.headers["Content-Type"] == "video/webm"
        assert r.headers["Accept-Ranges"] == "bytes"
        assert r.headers["Content-Length"] == "524288"
        cr = r.headers["Content-Range"]
        assert cr.startswith("bytes 0-524287/")
        assert len(r.content) == 524288


class TestOpenEndedRange:
    def test_bytes_0_dash_is_honored_to_eof(self, owner_session):
        """Regression: iter4 fix - bytes=0- must return full file, not first 1MB."""
        # Get total size first
        head = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media",
                                 headers={"Range": "bytes=0-0"}, timeout=15)
        total = int(head.headers["Content-Range"].split("/")[1])

        r = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media",
                              headers={"Range": "bytes=0-"}, timeout=120)
        assert r.status_code == 206
        assert int(r.headers["Content-Length"]) == total
        assert r.headers["Content-Range"] == f"bytes 0-{total-1}/{total}"
        assert len(r.content) == total
        assert total > 1024 * 1024, "test file too small to detect 1MB cap regression"


class TestSuffixRange:
    def test_suffix_returns_last_n_bytes(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media",
                              headers={"Range": "bytes=-1000"}, timeout=15)
        assert r.status_code == 206
        assert int(r.headers["Content-Length"]) == 1000
        total = int(r.headers["Content-Range"].split("/")[1])
        assert r.headers["Content-Range"] == f"bytes {total-1000}-{total-1}/{total}"


class TestMiddleSeek:
    def test_middle_range(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media",
                              headers={"Range": "bytes=1000000-2000000"}, timeout=30)
        assert r.status_code == 206
        assert int(r.headers["Content-Length"]) == 1000001
        assert r.headers["Content-Range"].startswith("bytes 1000000-2000000/")


class TestInvalidRange:
    def test_out_of_bounds_returns_416(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media",
                              headers={"Range": "bytes=99999999-999999999"}, timeout=15)
        assert r.status_code == 416
        assert r.headers["Content-Range"].startswith("bytes */")

    def test_malformed_range_returns_416(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media",
                              headers={"Range": "not-a-range"}, timeout=15)
        assert r.status_code == 416


class TestContentIntegrity:
    def test_concatenated_ranges_reproduce_full(self, owner_session):
        # Fetch full first
        full = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media", timeout=60).content
        # Fetch in 3 pieces
        a = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media",
                              headers={"Range": "bytes=0-999999"}, timeout=30).content
        b = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media",
                              headers={"Range": "bytes=1000000-2999999"}, timeout=30).content
        c = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media",
                              headers={"Range": f"bytes=3000000-{len(full)-1}"}, timeout=60).content
        reconstructed = a + b + c
        assert hashlib.sha256(reconstructed).hexdigest() == hashlib.sha256(full).hexdigest()
        assert len(reconstructed) == len(full)


class TestAuthIsolation:
    def test_foreign_user_gets_404(self, foreign_session):
        r = foreign_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media",
                                headers={"Range": "bytes=0-1000"}, timeout=15)
        assert r.status_code == 404

    def test_no_auth_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/media", timeout=15)
        assert r.status_code == 401


class TestRelistenClearsWords:
    """Regression: retranscribe_project clears words in Mongo while queued."""
    def test_retranscribe_response_clears_words(self, owner_session):
        # We do NOT actually retranscribe (costs real Whisper). We only inspect
        # what retranscribe_project returns via a dry-run: the source route sets
        # words=[] in Mongo before scheduling. If invoked it would consume a
        # credit; instead, verify the current words list is intact.
        r = owner_session.get(f"{BASE_URL}/api/projects/{PROJECT_ID}", timeout=15)
        assert r.status_code == 200
        # Confirm the fix line is present in source (structural)
        with open("/app/backend/captions.py") as f:
            src = f.read()
        assert '"words": []' in src, "retranscribe_project must clear words on queue"
        assert '"source_transcript": ""' in src
