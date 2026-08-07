import asyncio
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field

from auth import current_user
from storage_service import APP_NAME, get_object, put_object

editor_assets_router = APIRouter(prefix="/api", tags=["editor-assets"])
FONT_MIME = {
    ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff",
    ".woff2": "font/woff2",
}


class PresetPayload(BaseModel):
    name: str = Field(min_length=2, max_length=50)
    style: dict[str, Any]
    template_id: str | None = None


@editor_assets_router.get("/editor/presets")
async def list_presets(request: Request, user=Depends(current_user)):
    return await request.app.state.db.editor_presets.find(
        {"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).sort("created_at", -1).to_list(100)


@editor_assets_router.post("/editor/presets")
async def create_preset(payload: PresetPayload, request: Request, user=Depends(current_user)):
    preset = {"preset_id": f"preset_{uuid.uuid4().hex[:12]}", "user_id": user["user_id"],
              "name": payload.name.strip(), "style": payload.style,
              "template_id": payload.template_id,
              "created_at": datetime.now(timezone.utc).isoformat()}
    await request.app.state.db.editor_presets.insert_one(preset.copy())
    return {key: value for key, value in preset.items() if key != "user_id"}


@editor_assets_router.delete("/editor/presets/{preset_id}")
async def delete_preset(preset_id: str, request: Request, user=Depends(current_user)):
    result = await request.app.state.db.editor_presets.delete_one(
        {"preset_id": preset_id, "user_id": user["user_id"]})
    if not result.deleted_count:
        raise HTTPException(404, "Preset not found")
    return {"status": "deleted"}


@editor_assets_router.get("/editor/fonts")
async def list_fonts(request: Request, user=Depends(current_user)):
    return await request.app.state.db.custom_fonts.find(
        {"user_id": user["user_id"], "is_deleted": False},
        {"_id": 0, "user_id": 0, "storage_path": 0}).sort("created_at", -1).to_list(100)


@editor_assets_router.post("/editor/fonts")
async def upload_font(request: Request, file: UploadFile = File(...), user=Depends(current_user)):
    extension = Path(file.filename or "font").suffix.lower()
    if extension not in FONT_MIME:
        raise HTTPException(415, "Upload a TTF, OTF, WOFF, or WOFF2 font")
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, "Font file must be smaller than 8 MB")
    font_id = f"font_{uuid.uuid4().hex[:12]}"
    family = Path(file.filename or "Custom Font").stem.replace("-", " ").replace("_", " ")[:60]
    path = f"{APP_NAME}/fonts/{user['user_id']}/{uuid.uuid4().hex}{extension}"
    try:
        stored = await asyncio.to_thread(put_object, path, data, FONT_MIME[extension])
    except Exception as exc:
        raise HTTPException(503, "Font upload failed") from exc
    record = {"font_id": font_id, "user_id": user["user_id"], "family": family,
              "filename": file.filename, "storage_path": stored["path"],
              "content_type": FONT_MIME[extension], "size": stored["size"],
              "is_deleted": False, "created_at": datetime.now(timezone.utc).isoformat()}
    await request.app.state.db.custom_fonts.insert_one(record.copy())
    return {key: value for key, value in record.items() if key not in {"user_id", "storage_path"}}


@editor_assets_router.get("/editor/fonts/{font_id}/file")
async def font_file(font_id: str, request: Request, user=Depends(current_user)):
    record = await request.app.state.db.custom_fonts.find_one(
        {"font_id": font_id, "user_id": user["user_id"], "is_deleted": False}, {"_id": 0})
    if not record:
        raise HTTPException(404, "Font not found")
    data, _ = await asyncio.to_thread(get_object, record["storage_path"])
    return Response(data, media_type=record["content_type"], headers={
        "Cache-Control": "private, max-age=86400", "Content-Length": str(len(data))})


@editor_assets_router.delete("/editor/fonts/{font_id}")
async def delete_font(font_id: str, request: Request, user=Depends(current_user)):
    result = await request.app.state.db.custom_fonts.update_one(
        {"font_id": font_id, "user_id": user["user_id"]}, {"$set": {"is_deleted": True}})
    if not result.matched_count:
        raise HTTPException(404, "Font not found")
    return {"status": "deleted"}