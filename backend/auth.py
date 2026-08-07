import asyncio
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import requests
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)


class GoogleSession(BaseModel):
    session_id: str


class UserOut(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    plan: str = "free"


def _token_from_request(request: Request) -> Optional[str]:
    cookie = request.cookies.get("session_token")
    header = request.headers.get("authorization", "")
    return cookie or (header[7:] if header.lower().startswith("bearer ") else None)


async def current_user(request: Request) -> dict:
    token = _token_from_request(request)
    if not token:
        raise HTTPException(401, "Please sign in")
    db = request.app.state.db
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
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
    token = secrets.token_urlsafe(40)
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })
    return token


def _set_cookie(response: Response, token: str):
    response.set_cookie("session_token", token, max_age=604800, httponly=True,
                        secure=True, samesite="none", path="/")


def _include_session_header(response: Response, token: str):
    if os.environ.get("EXPOSE_SESSION_TOKEN_HEADER", "").lower() == "true":
        response.headers["X-Session-Token"] = token


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
            "password_hash": bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode(),
            "created_at": datetime.now(timezone.utc).isoformat()}
    await db.users.insert_one(user.copy())
    await _ensure_usage(db, user["user_id"])
    token = await _create_session(db, user["user_id"])
    _set_cookie(response, token)
    _include_session_header(response, token)
    return UserOut(**user)


@auth_router.post("/login", response_model=UserOut)
async def login(payload: Credentials, response: Response, request: Request):
    db = request.app.state.db
    user = await db.users.find_one({"email": payload.email.lower()}, {"_id": 0})
    if not user or not user.get("password_hash") or not bcrypt.checkpw(payload.password.encode(), user["password_hash"].encode()):
        raise HTTPException(401, "Email or password is incorrect")
    token = await _create_session(db, user["user_id"])
    _set_cookie(response, token)
    _include_session_header(response, token)
    return UserOut(**user)


@auth_router.post("/google/session", response_model=UserOut)
async def google_session(payload: GoogleSession, response: Response, request: Request):
    def exchange():
        result = requests.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": payload.session_id}, timeout=20)
        result.raise_for_status()
        return result.json()
    try:
        profile = await asyncio.to_thread(exchange)
    except Exception as exc:
        raise HTTPException(401, "Google sign-in could not be verified") from exc
    db = request.app.state.db
    email = profile["email"].lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        user = {"user_id": f"user_{uuid.uuid4().hex[:12]}", "email": email,
                "name": profile.get("name") or email.split("@")[0],
                "picture": profile.get("picture"), "plan": "free",
                "created_at": datetime.now(timezone.utc).isoformat()}
        await db.users.insert_one(user.copy())
    else:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {
            "name": profile.get("name") or user["name"],
            "picture": profile.get("picture") or user.get("picture")}})
    await _ensure_usage(db, user["user_id"])
    token = await _create_session(db, user["user_id"])
    _set_cookie(response, token)
    _include_session_header(response, token)
    return UserOut(**user)


@auth_router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(current_user)):
    return UserOut(**user)


@auth_router.post("/logout")
async def logout(response: Response, request: Request):
    token = _token_from_request(request)
    if token:
        await request.app.state.db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/", secure=True, samesite="none")
    return {"status": "signed_out"}
