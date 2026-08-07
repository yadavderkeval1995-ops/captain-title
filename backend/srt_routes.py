import asyncio
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field

from auth import current_user
from srt_localization import analyze_scene, build_srt, create_style_samples, parse_srt, translate_full
from storage_service import APP_NAME, get_object, put_object


srt_router = APIRouter(prefix="/api/srt-projects", tags=["srt-localization"])
VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".avi"}
STYLES = {"gen-z", "cinematic", "urdu-touch"}


class StyleApproval(BaseModel):
    style: str
    style_brief: str = Field(default="", max_length=1000)
    project_guide: str = Field(default="", max_length=4000)


def _public(job):
    hidden = {"_id", "user_id", "video_path", "srt_path", "scene_context", "source_cues", "translated_cues"}
    return {key: value for key, value in job.items() if key not in hidden}


async def _set(db, job_id, **fields):
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.srt_projects.update_one({"job_id": job_id}, {"$set": fields})


async def _analyze_job(db, job_id):
    try:
        job = await db.srt_projects.find_one({"job_id": job_id}, {"_id": 0})
        video_data, _ = await asyncio.to_thread(get_object, job["video_path"])
        srt_data, _ = await asyncio.to_thread(get_object, job["srt_path"])
        cues = parse_srt(srt_data.decode("utf-8-sig"))
        await _set(db, job_id, status="analyzing", progress=28, processing_label="Reading video emotion and scene tone")
        with tempfile.TemporaryDirectory() as temp:
            suffix = Path(job["video_name"]).suffix.lower() or ".mp4"
            video = Path(temp) / f"source{suffix}"; video.write_bytes(video_data)
            scene = await analyze_scene(str(video), cues)
        await _set(db, job_id, status="sampling", progress=62, processing_label="Creating three Hindi voice options")
        sample_cues, style_samples = await create_style_samples(cues, scene)
        await _set(db, job_id, status="awaiting_style", progress=70, processing_label="Choose a Hindi voice", scene_context=scene, source_cues=cues, sample_cues=sample_cues, style_samples=style_samples, warnings=scene.get("warnings", []))
    except Exception as exc:
        await _set(db, job_id, status="failed", progress=100, processing_label="Analysis failed", error_message=str(exc))


async def _translate_job(db, job_id):
    try:
        job = await db.srt_projects.find_one({"job_id": job_id}, {"_id": 0})
        await _set(db, job_id, status="translating", progress=76, processing_label="Applying the approved voice to the full SRT")
        translated = await translate_full(job["source_cues"], job.get("scene_context", {}), job["approved_style"], job.get("style_brief", ""), job.get("project_guide", ""))
        content = build_srt(translated).encode("utf-8")
        output_path = f"{APP_NAME}/srt-localization/{job['user_id']}/{uuid.uuid4().hex}-hindi.srt"
        await asyncio.to_thread(put_object, output_path, content, "application/x-subrip; charset=utf-8")
        await _set(db, job_id, status="completed", progress=100, processing_label="Hindi SRT ready", output_path=output_path, translated_cues=translated)
    except Exception as exc:
        await _set(db, job_id, status="failed", progress=100, processing_label="Translation failed", error_message=str(exc))


@srt_router.post("")
async def create_srt_project(request: Request, video: UploadFile = File(...), english_srt: UploadFile = File(...), user=Depends(current_user)):
    suffix = Path(video.filename or "video.mp4").suffix.lower()
    if suffix not in VIDEO_SUFFIXES: raise HTTPException(415, "Upload MP4, MOV, MKV, WebM, or AVI video")
    if not (english_srt.filename or "").lower().endswith(".srt"): raise HTTPException(415, "Upload an English .srt file")
    video_data = await video.read(); srt_data = await english_srt.read()
    if len(video_data) > 3 * 1024 * 1024 * 1024: raise HTTPException(413, "Video must be smaller than 3 GB")
    if len(srt_data) > 2 * 1024 * 1024: raise HTTPException(413, "SRT must be smaller than 2 MB")
    try: parse_srt(srt_data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError) as exc: raise HTTPException(422, str(exc)) from exc
    job_id = f"srt_{uuid.uuid4().hex[:14]}"; base = f"{APP_NAME}/srt-localization/{user['user_id']}/{job_id}"
    try:
        await asyncio.to_thread(put_object, f"{base}{suffix}", video_data, video.content_type or "video/mp4")
        await asyncio.to_thread(put_object, f"{base}.srt", srt_data, "application/x-subrip")
    except Exception as exc: raise HTTPException(503, "Files could not be stored") from exc
    job = {"job_id": job_id, "user_id": user["user_id"], "video_name": video.filename, "srt_name": english_srt.filename, "video_path": f"{base}{suffix}", "srt_path": f"{base}.srt", "status": "queued", "progress": 5, "processing_label": "Files uploaded", "style_samples": [], "sample_cues": [], "warnings": [], "error_message": None, "created_at": datetime.now(timezone.utc).isoformat()}
    await request.app.state.db.srt_projects.insert_one(job.copy()); asyncio.create_task(_analyze_job(request.app.state.db, job_id))
    return _public(job)


@srt_router.get("/{job_id}")
async def get_srt_project(job_id: str, request: Request, user=Depends(current_user)):
    job = await request.app.state.db.srt_projects.find_one({"job_id": job_id, "user_id": user["user_id"]}, {"_id": 0})
    if not job: raise HTTPException(404, "SRT localization project not found")
    return _public(job)


@srt_router.post("/{job_id}/approve-style")
async def approve_style(job_id: str, payload: StyleApproval, request: Request, user=Depends(current_user)):
    if payload.style not in STYLES: raise HTTPException(422, "Choose Gen-Z, cinematic, or Urdu-touch Hindi")
    db = request.app.state.db; job = await db.srt_projects.find_one({"job_id": job_id, "user_id": user["user_id"]}, {"_id": 0})
    if not job: raise HTTPException(404, "SRT localization project not found")
    if job["status"] != "awaiting_style": raise HTTPException(409, "This project is not waiting for a style decision")
    await _set(db, job_id, approved_style=payload.style, style_brief=payload.style_brief, project_guide=payload.project_guide, status="queued_translation", processing_label="Style approved")
    asyncio.create_task(_translate_job(db, job_id)); return {"status": "queued_translation"}


@srt_router.get("/{job_id}/download")
async def download_srt(job_id: str, request: Request, user=Depends(current_user)):
    job = await request.app.state.db.srt_projects.find_one({"job_id": job_id, "user_id": user["user_id"]}, {"_id": 0})
    if not job or not job.get("output_path"): raise HTTPException(404, "Hindi SRT is not ready")
    data, _ = await asyncio.to_thread(get_object, job["output_path"])
    return Response(data, media_type="application/x-subrip; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="translated-hindi.srt"'})
