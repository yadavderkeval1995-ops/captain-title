import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture
def api_client():
    session = requests.Session()
    return session


def _register(session, prefix="editor.test"):
    email = f"{prefix}.{int(time.time()*1000)}.{uuid.uuid4().hex[:6]}@example.com"
    password = "captain123"
    r = session.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": password, "name": "Testing Agent"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    token = r.headers.get("X-Session-Token")
    assert token
    session.headers.update({"Authorization": f"Bearer {token}"})
    return session, email, password, token


@pytest.fixture
def fresh_user():
    """A fresh, freshly-registered user with a session Bearer token."""
    session = requests.Session()
    session, email, password, token = _register(session)
    return {"session": session, "email": email, "password": password, "token": token}
