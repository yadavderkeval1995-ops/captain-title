import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from auth import auth_router
from captions import projects_router
from payments import payments_router
from storage_service import init_storage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("captain-title")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Captain Title API", version="1.0.0")
app.state.db = db
app.include_router(auth_router)
app.include_router(projects_router)
app.include_router(payments_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origin_regex=r"https?://.*",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.projects.create_index([("user_id", 1), ("created_at", -1)])
    try:
        init_storage()
        logger.info("Object storage initialized")
    except Exception as exc:
        logger.warning("Object storage will retry on first request: %s", exc)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Captain Title"}


@app.on_event("shutdown")
async def shutdown():
    client.close()