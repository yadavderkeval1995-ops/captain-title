import asyncio
import inspect

import pytest
from fastapi import HTTPException, Response

import auth
import payments


class FakeTransactions:
    def __init__(self, record=None):
        self.record = record
        self.last_query = None

    async def find_one(self, query, projection):
        self.last_query = query
        if not self.record:
            return None
        if query.get("session_id") != self.record.get("session_id"):
            return None
        if query.get("user_id") != self.record.get("user_id"):
            return None
        return self.record.copy()


class FakeDatabase:
    def __init__(self, transaction=None):
        self.payment_transactions = FakeTransactions(transaction)


class FakeApp:
    def __init__(self, database):
        self.state = type("State", (), {"db": database})()


class FakeRequest:
    def __init__(self, database):
        self.app = FakeApp(database)


def test_checkout_origin_prefers_configured_frontend(monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "https://captain.example.com/")
    assert payments._checkout_origin("https://attacker.example") == "https://captain.example.com"


@pytest.mark.parametrize("origin", [
    "javascript:alert(1)",
    "https://user:password@example.com",
    "https://example.com/path",
    "https://example.com?next=evil",
    "http://example.com",
])
def test_checkout_origin_rejects_unsafe_values(monkeypatch, origin):
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    with pytest.raises(HTTPException) as caught:
        payments._checkout_origin(origin)
    assert caught.value.status_code == 400


def test_checkout_origin_allows_https_and_local_development(monkeypatch):
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    assert payments._checkout_origin("https://captain.example.com") == "https://captain.example.com"
    assert payments._checkout_origin("http://localhost:3000") == "http://localhost:3000"
    assert payments._checkout_origin("http://127.0.0.1:3000") == "http://127.0.0.1:3000"


def test_payment_status_is_bound_to_authenticated_user(monkeypatch):
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    record = {
        "session_id": "cs_owner",
        "user_id": "user_owner",
        "status": "initiated",
        "payment_status": "pending",
    }
    database = FakeDatabase(record)
    result = asyncio.run(payments.status(
        "cs_owner", FakeRequest(database), {"user_id": "user_owner"}))
    assert result["session_id"] == "cs_owner"
    assert database.payment_transactions.last_query == {
        "session_id": "cs_owner", "user_id": "user_owner"}


def test_payment_status_hides_other_users_transaction(monkeypatch):
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    database = FakeDatabase({
        "session_id": "cs_private",
        "user_id": "user_owner",
        "status": "completed",
        "payment_status": "paid",
    })
    with pytest.raises(HTTPException) as caught:
        asyncio.run(payments.status(
            "cs_private", FakeRequest(database), {"user_id": "user_other"}))
    assert caught.value.status_code == 404


def test_session_header_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("EXPOSE_SESSION_TOKEN_HEADER", raising=False)
    response = Response()
    auth._include_session_header(response, "secret-token")
    assert "X-Session-Token" not in response.headers


def test_session_header_requires_explicit_legacy_flag(monkeypatch):
    monkeypatch.setenv("EXPOSE_SESSION_TOKEN_HEADER", "true")
    response = Response()
    auth._include_session_header(response, "test-token")
    assert response.headers["X-Session-Token"] == "test-token"


def test_status_route_declares_auth_dependency():
    signature = inspect.signature(payments.status)
    dependency = signature.parameters["user"].default
    assert dependency.dependency is auth.current_user
