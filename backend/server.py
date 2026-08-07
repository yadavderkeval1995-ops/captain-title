import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from auth import auth_router
from captions import projects_router, resume_pending_projects
from editor_assets import editor_assets_router
from payments import payments_router
from srt_routes import srt_router
from storage_service import init_storage
from transcription_audit import run_transcription_audit

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("captain-title")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]


def _cors_origins():
    configured = os.environ.get("CORS_ORIGINS", "")
    origins = [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]
    frontend_url = os.environ.get("FRONTEND_URL", "").strip().rstrip("/")
    if frontend_url: origins.append(frontend_url)
    return list(dict.fromkeys(origins or ["http://localhost:3000", "http://127.0.0.1:3000"]))


@asynccontextmanager
async def lifespan(application: FastAPI):
    await db.users.create_index("email", unique=True)
    await db.user_sessions.create_index("token_digest", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.projects.create_index([("user_id", 1), ("created_at", -1)])
    await db.srt_projects.create_index([("user_id", 1), ("created_at", -1)])
    await db.srt_projects.create_index("job_id", unique=True)
    await db.usage.create_index("user_id", unique=True)
    await db.payment_transactions.create_index("session_id", unique=True)
    try:
        init_storage(); logger.info("Object storage initialized")
    except Exception as exc: logger.warning("Object storage will retry on first request: %s", exc)
    await resume_pending_projects(db)
    if os.environ.get("TRANSCRIPTION_AUDIT_OBJECT", "").strip():
        asyncio.create_task(run_transcription_audit())
    yield
    client.close()


app = FastAPI(title="Captain Title API", version="1.1.0", lifespan=lifespan)
app.state.db = db
app.include_router(auth_router); app.include_router(projects_router); app.include_router(srt_router); app.include_router(editor_assets_router); app.include_router(payments_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=_cors_origins(), allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type", "Range", "Stripe-Signature"], expose_headers=["Content-Length", "Content-Range", "Accept-Ranges"])


@app.middleware("http")
async def reject_oversized_font_uploads(request, call_next):
    if request.method == "POST" and request.url.path == "/api/editor/fonts":
        if int(request.headers.get("content-length") or 0) > 8 * 1024 * 1024:
            return JSONResponse(status_code=413, content={"detail": "Font file must be smaller than 8 MB"})
    return await call_next(request)


@app.get("/api/health")
async def health(): return {"status": "ok", "service": "Captain Title"}
