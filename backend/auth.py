import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=72)
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)


class UserOut(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    plan: str = "free"


def _session_pepper() -> str:
    value = os.environ.get("SESSION_PEPPER", "")
    if len(value) < 32:
        raise RuntimeError("SESSION_PEPPER must be a fresh secret of at least 32 characters")
    return value


def _token_digest(token: str) -> str:
    return hashlib.sha256(f"{_session_pepper()}:{token}".encode()).hexdigest()


def _token_from_request(request: Request) -> Optional[str]:
    cookie = request.cookies.get("session_token")
    header = request.headers.get("authorization", "")
    return cookie or (header[7:] if header.lower().startswith("bearer ") else None)


async def current_user(request: Request) -> dict:
    token = _token_from_request(request)
    if not token:
        raise HTTPException(401, "Please sign in")
    db = request.app.state.db
    session = await db.user_sessions.find_one({"token_digest": _token_digest(token)}, {"_id": 0})
    if not session:
        raise HTTPException(401, "Session not found")
    expiry = session["expires_at"]
    if isinstance(expiry, str):
        expiry = datetime.fromisoformat(expiry)
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry < datetime.now(timezone.utc):
        raise HTTPException(401, "Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user


async def _create_session(db, user_id: str) -> str:
    token = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    await db.user_sessions.insert_one({
        "token_digest": _token_digest(token),
        "user_id": user_id,
        "created_at": now,
        "expires_at": now + timedelta(days=7),
    })
    return token


def _set_cookie(response: Response, token: str):
    secure = os.environ.get("COOKIE_SECURE", "true").lower() == "true"
    same_site = os.environ.get("COOKIE_SAMESITE", "lax").lower()
    response.set_cookie("session_token", token, max_age=604800, httponly=True,
                        secure=secure, samesite=same_site, path="/")


async def _ensure_usage(db, user_id: str):
    await db.usage.update_one({"user_id": user_id}, {"$setOnInsert": {
        "user_id": user_id, "free_remaining": 1, "oneoff_credits": 0,
        "oneoff_purchase_count": 0, "basic_credits": 0,
        "subscription_active": False, "videos_created": 0,
    }}, upsert=True)


@auth_router.post("/register", response_model=UserOut)
async def register(payload: Credentials, response: Response, request: Request):
    db = request.app.state.db
    email = payload.email.lower()
    if await db.users.find_one({"email": email}, {"_id": 1}):
        raise HTTPException(409, "An account already exists for this email")
    user = {"user_id": f"user_{uuid.uuid4().hex[:12]}", "email": email,
            "name": payload.name or email.split("@")[0], "picture": None, "plan": "free",
            "password_hash": bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt(rounds=12)).decode(),
            "created_at": datetime.now(timezone.utc).isoformat()}
    await db.users.insert_one(user.copy())
    await _ensure_usage(db, user["user_id"])
    _set_cookie(response, await _create_session(db, user["user_id"]))
    return UserOut(**user)


@auth_router.post("/login", response_model=UserOut)
async def login(payload: Credentials, response: Response, request: Request):
    db = request.app.state.db
    user = await db.users.find_one({"email": payload.email.lower()}, {"_id": 0})
    if not user or not user.get("password_hash") or not bcrypt.checkpw(payload.password.encode(), user["password_hash"].encode()):
        raise HTTPException(401, "Email or password is incorrect")
    _set_cookie(response, await _create_session(db, user["user_id"]))
    return UserOut(**user)


@auth_router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(current_user)):
    return UserOut(**user)


@auth_router.post("/logout")
async def logout(response: Response, request: Request):
    token = _token_from_request(request)
    if token:
        await request.app.state.db.user_sessions.delete_one({"token_digest": _token_digest(token)})
    response.delete_cookie("session_token", path="/")
    return {"status": "signed_out"}
