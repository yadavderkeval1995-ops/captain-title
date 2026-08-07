import os
from datetime import datetime, timezone
from urllib.parse import urlparse

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import current_user

payments_router = APIRouter(prefix="/api/payments", tags=["payments"])
CATALOG = {
    "single_45": {"lookup_key": "captain_single_45_inr", "type": "payment"},
    "basic_monthly": {"lookup_key": "captain_basic_monthly_inr", "type": "subscription"},
}


class CheckoutRequest(BaseModel):
    package_id: str
    origin_url: str


def _checkout_origin(requested_origin: str) -> str:
    configured_origin = os.environ.get("FRONTEND_URL", "").strip().rstrip("/")
    if configured_origin:
        return configured_origin
    parsed = urlparse(requested_origin)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise HTTPException(400, "Invalid checkout origin")
    if parsed.path not in {"", "/"} or parsed.params or parsed.query or parsed.fragment:
        raise HTTPException(400, "Checkout origin must not include a path, query, or fragment")
    if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1"}:
        raise HTTPException(400, "Checkout origin must use HTTPS")
    return f"{parsed.scheme}://{parsed.netloc}"


@payments_router.get("/catalog")
async def catalog():
    return {"items": [
        {"id": "single_45", "name": "Single video", "price": 69, "currency": "INR", "limit": "1 × 45 sec"},
        {"id": "basic_monthly", "name": "Basic", "price": 399, "currency": "INR", "limit": "10 × 60 sec / month"},
    ], "available": bool(os.environ.get("STRIPE_SECRET_KEY"))}


@payments_router.post("/checkout")
async def checkout(payload: CheckoutRequest, request: Request, user=Depends(current_user)):
    package = CATALOG.get(payload.package_id)
    if not package:
        raise HTTPException(400, "Unknown package")
    if payload.package_id == "single_45":
        usage = await request.app.state.db.usage.find_one(
            {"user_id": user["user_id"]}, {"_id": 0, "oneoff_purchase_count": 1})
        if (usage or {}).get("oneoff_purchase_count", 0) >= 3:
            raise HTTPException(409, "Single-video passes are limited to 3 purchases; choose Basic instead")
    secret = os.environ.get("STRIPE_SECRET_KEY")
    if not secret:
        raise HTTPException(503, "Stripe checkout is unavailable for the configured business country")
    origin = _checkout_origin(payload.origin_url)
    stripe.api_key = secret
    prices = stripe.Price.list(lookup_keys=[package["lookup_key"]], active=True, limit=1).data
    if not prices:
        raise HTTPException(503, "Payment catalog is not ready")
    session = stripe.checkout.Session.create(
        line_items=[{"price": prices[0].id, "quantity": 1}], mode=package["type"],
        success_url=f"{origin}/payment/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{origin}/payment/cancel",
        metadata={"user_id": user["user_id"], "package_id": payload.package_id},
        automatic_tax={"enabled": True}, billing_address_collection="required")
    await request.app.state.db.payment_transactions.insert_one({
        "session_id": session.id, "user_id": user["user_id"], "package_id": payload.package_id,
        "status": "initiated", "payment_status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat()})
    return {"checkout_url": session.url, "session_id": session.id}


async def _grant(db, session_id, user_id, package_id):
    if not user_id or package_id not in CATALOG:
        return
    record = await db.payment_transactions.find_one(
        {"session_id": session_id, "user_id": user_id, "package_id": package_id}, {"_id": 0})
    if not record or record.get("payment_status") == "paid":
        return
    if package_id == "single_45":
        usage = await db.usage.find_one({"user_id": user_id}, {"_id": 0}) or {}
        if usage.get("oneoff_purchase_count", 0) >= 3:
            await db.payment_transactions.update_one({"session_id": session_id}, {"$set": {
                "status": "manual_review", "payment_status": "paid_uncredited",
                "updated_at": datetime.now(timezone.utc).isoformat()}})
            return
    result = await db.payment_transactions.update_one(
        {"session_id": session_id, "payment_status": {"$ne": "paid"}},
        {"$set": {"status": "completed", "payment_status": "paid", "updated_at": datetime.now(timezone.utc).isoformat()}})
    if not result.modified_count:
        return
    if package_id == "single_45":
        await db.usage.update_one({"user_id": user_id}, {"$inc": {
            "oneoff_credits": 1, "oneoff_purchase_count": 1}})
    else:
        await db.usage.update_one({"user_id": user_id}, {"$set": {
            "basic_credits": 10, "subscription_active": True}})


@payments_router.get("/status/{session_id}")
async def status(session_id: str, request: Request, user=Depends(current_user)):
    record = await request.app.state.db.payment_transactions.find_one(
        {"session_id": session_id, "user_id": user["user_id"]}, {"_id": 0})
    if not record:
        raise HTTPException(404, "Transaction not found")
    if record["payment_status"] != "paid" and os.environ.get("STRIPE_SECRET_KEY"):
        stripe.api_key = os.environ["STRIPE_SECRET_KEY"]
        session = stripe.checkout.Session.retrieve(session_id)
        if session.payment_status == "paid" or session.status == "complete":
            await _grant(request.app.state.db, session_id, record["user_id"], record["package_id"])
            record = await request.app.state.db.payment_transactions.find_one(
                {"session_id": session_id, "user_id": user["user_id"]}, {"_id": 0})
    return {"session_id": session_id, "status": record["status"], "payment_status": record["payment_status"]}


@payments_router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET")
    if not secret:
        raise HTTPException(503, "Stripe webhook is not configured")
    try:
        event = stripe.Webhook.construct_event(await request.body(), request.headers.get("stripe-signature", ""), secret)
    except Exception as exc:
        raise HTTPException(400, "Invalid Stripe signature") from exc
    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        metadata = session.get("metadata", {})
        await _grant(request.app.state.db, session["id"], metadata.get("user_id"), metadata.get("package_id"))
    return {"status": "ok"}
