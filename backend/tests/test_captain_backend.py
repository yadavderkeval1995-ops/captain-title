"""
Captain Title backend regression tests.
Covers: health, auth (register/login/me/logout), Google validation, usage/catalog,
project processing gating (unauthenticated + duration/format checks), payments
availability + checkout (blocked STRIPE_MODE=unavailable_country).
NB: A full free-credit real Whisper+GPT run is exercised in test_ai_pipeline_real.
"""
import os
import time
import uuid
from pathlib import Path

import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


# ---- Health ----------------------------------------------------------------
class TestHealth:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "ok"
        assert body.get("service") == "Tadaaam"


# ---- Auth ------------------------------------------------------------------
class TestAuth:
    def _email(self):
        return f"editor.pytest.{int(time.time()*1000)}.{uuid.uuid4().hex[:6]}@example.com"

    def test_register_login_me_logout(self):
        s = requests.Session()
        email = self._email()
        pw = "captain123"
        # Register
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": email, "password": pw, "name": "T1 Tester"}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == email
        assert body["plan"] == "free"
        assert body["name"] == "T1 Tester"
        token = r.headers.get("X-Session-Token")
        assert token, "X-Session-Token header missing"

        # me via Bearer token (no cookie jar)
        s2 = requests.Session()
        me = s2.get(f"{BASE_URL}/api/auth/me",
                    headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert me.status_code == 200
        assert me.json()["email"] == email

        # Login same account
        s3 = requests.Session()
        r2 = s3.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": pw}, timeout=15)
        assert r2.status_code == 200
        token2 = r2.headers.get("X-Session-Token")
        assert token2 and token2 != token

        # Logout invalidates token
        lo = requests.post(f"{BASE_URL}/api/auth/logout",
                           headers={"Authorization": f"Bearer {token2}"}, timeout=15)
        assert lo.status_code == 200
        me2 = requests.get(f"{BASE_URL}/api/auth/me",
                           headers={"Authorization": f"Bearer {token2}"}, timeout=15)
        assert me2.status_code == 401

    def test_duplicate_registration(self):
        s = requests.Session()
        email = self._email()
        pw = "captain123"
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": email, "password": pw, "name": "Dup"}, timeout=15)
        assert r.status_code == 200
        r2 = s.post(f"{BASE_URL}/api/auth/register",
                    json={"email": email, "password": pw, "name": "Dup"}, timeout=15)
        assert r2.status_code == 409

    def test_login_wrong_password(self):
        email = self._email()
        pw = "captain123"
        requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": pw, "name": "X"}, timeout=15)
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": "wrongwrong"}, timeout=15)
        assert r.status_code == 401

    def test_password_min_length_validation(self):
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": f"short.{uuid.uuid4().hex[:6]}@example.com",
                                "password": "short", "name": "Short"}, timeout=15)
        assert r.status_code in (400, 422)

    def test_google_login_redirects(self):
        r = requests.get(f"{BASE_URL}/api/auth/google/login", timeout=15, allow_redirects=False)
        assert r.status_code in (302, 307)
        location = r.headers.get("location", "")
        # Redirects to Google's consent screen if GOOGLE_CLIENT_ID is configured,
        # otherwise back to the frontend with a friendly error flag.
        assert "accounts.google.com" in location or "google_error=not_configured" in location

    def test_me_without_token(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 401


# ---- Usage + catalog -------------------------------------------------------
class TestUsageAndCatalog:
    def _register(self):
        email = f"catalog.{int(time.time()*1000)}.{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": email, "password": "captain123", "name": "Catalog User"}, timeout=15)
        assert r.status_code == 200, r.text
        return r.headers["X-Session-Token"]

    def test_usage_defaults_for_new_user(self):
        token = self._register()
        r = requests.get(f"{BASE_URL}/api/usage",
                         headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert r.status_code == 200
        u = r.json()
        assert u["free_remaining"] == 1
        assert u["oneoff_credits"] == 0
        assert u["basic_credits"] == 0
        assert u["subscription_active"] is False
        assert u["videos_created"] == 0
        assert isinstance(u["plans"], list) and len(u["plans"]) == 2

    def test_payments_catalog_public(self):
        r = requests.get(f"{BASE_URL}/api/payments/catalog", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body["items"], list) and len(body["items"]) == 2
        ids = {i["id"] for i in body["items"]}
        assert ids == {"single_45", "basic_monthly"}
        for item in body["items"]:
            assert item["currency"] == "INR"
        # In this environment STRIPE_MODE=unavailable_country -> no key
        assert body["available"] is False


# ---- Payments checkout blocked --------------------------------------------
class TestPaymentsBlocked:
    def test_checkout_returns_503_when_stripe_unavailable(self):
        email = f"checkout.{int(time.time()*1000)}.{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": email, "password": "captain123", "name": "Pay User"}, timeout=15)
        token = r.headers["X-Session-Token"]
        r2 = requests.post(f"{BASE_URL}/api/payments/checkout",
                           headers={"Authorization": f"Bearer {token}"},
                           json={"package_id": "single_45",
                                 "origin_url": "https://caption-studio-56.preview.emergentagent.com"},
                           timeout=15)
        assert r2.status_code == 503
        assert "Stripe" in r2.text or "unavailable" in r2.text.lower()

    def test_checkout_unknown_package(self):
        email = f"pkg.{int(time.time()*1000)}.{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": email, "password": "captain123", "name": "Pkg User"}, timeout=15)
        token = r.headers["X-Session-Token"]
        r2 = requests.post(f"{BASE_URL}/api/payments/checkout",
                           headers={"Authorization": f"Bearer {token}"},
                           json={"package_id": "not_a_package",
                                 "origin_url": "https://x.example.com"}, timeout=15)
        # Backend checks package first -> should be 400 unknown package
        assert r2.status_code == 400


# ---- Project processing guardrails (without spending free credit) ---------
class TestProcessGuardrails:
    def _token(self):
        email = f"proc.{int(time.time()*1000)}.{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": email, "password": "captain123", "name": "Proc User"}, timeout=15)
        return r.headers["X-Session-Token"]

    def test_process_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/projects/process", timeout=15)
        assert r.status_code == 401

    def test_process_rejects_bad_extension(self):
        token = self._token()
        files = {"file": ("evil.txt", b"hello world", "text/plain")}
        r = requests.post(f"{BASE_URL}/api/projects/process",
                          headers={"Authorization": f"Bearer {token}"},
                          data={"theme": "viral"}, files=files, timeout=30)
        assert r.status_code == 415

    def test_process_rejects_unknown_theme(self):
        token = self._token()
        sample = Path("/app/captain-sample.mp4")
        if not sample.exists():
            pytest.skip("Sample video missing")
        with sample.open("rb") as f:
            r = requests.post(f"{BASE_URL}/api/projects/process",
                              headers={"Authorization": f"Bearer {token}"},
                              data={"theme": "not_a_theme"},
                              files={"file": ("sample.mp4", f, "video/mp4")}, timeout=60)
        assert r.status_code == 400

    def test_download_missing_render_returns_404(self):
        token = self._token()
        r = requests.get(f"{BASE_URL}/api/projects/does-not-exist/download",
                         headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert r.status_code == 404
