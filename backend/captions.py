import asyncio
import logging
import os
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
import imageio_ffmpeg

from auth import current_user
from caption_ai import convert_to_hinglish, transcribe_words
from storage_service import APP_NAME, get_object, put_object

projects_router = APIRouter(prefix="/api", tags=["captions"])
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
logger = logging.getLogger("captain-title.captions")
active_jobs: set[str] = set()
THEMES = {
    "viral": {"base": "#FFFFFF", "accent": "#FF3B30", "font": "Arial Black"},
    "cinematic": {"base": "#FFF7DB", "accent": "#FFB800", "font": "DejaVu Sans"},
    "minimal": {"base": "#FFFFFF", "accent": "#007AFF", "font": "DejaVu Sans"},
    "podcast": {"base": "#FFFFFF", "accent": "#A855F7", "font": "DejaVu Sans"},
}


class WordEdit(BaseModel):
    index: int
    text: str = Field(min_length=1, max_length=80)
    original: str = ""
    start: float
    end: float
    important: bool = False
    uncertain: bool = False
    color: str = "#FFFFFF"
    font_size: int = Field(default=52, ge=24, le=92)


class ProjectEdit(BaseModel):
    theme: str
    words: list[WordEdit]


class RetranscribeRequest(BaseModel):
    speech_language: str = "auto"


def _public_project(project: dict):
    hidden = {"_id", "user_id", "source_path", "credit_type", "content_type"}
    return {key: value for key, value in project.items() if key not in hidden}


async def _usage(db, user_id):
    usage = await db.usage.find_one({"user_id": user_id}, {"_id": 0})
    return usage or {"free_remaining": 0, "oneoff_credits": 0, "basic_credits": 0,
                     "subscription_active": False, "videos_created": 0}


def _entitlement(usage, duration):
    if os.environ.get("UNLIMITED_TESTING", "").lower() == "true" and duration <= 120:
        return "testing"
    if duration <= 45 and usage.get("free_remaining", 0) > 0:
        return "free"
    if duration <= 45 and usage.get("oneoff_credits", 0) > 0:
        return "oneoff"
    if duration <= 60 and usage.get("basic_credits", 0) > 0:
        return "basic"
    return None


def _duration(path):
    result = subprocess.run([FFMPEG, "-i", path, "-f", "null", "-"],
                            capture_output=True, text=True)
    match = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", result.stderr)
    if not match:
        raise ValueError("Video duration unavailable")
    hours, minutes, seconds = match.groups()
    return round(int(hours) * 3600 + int(minutes) * 60 + float(seconds), 2)


def _extract_audio(source, audio):
    subprocess.run([FFMPEG, "-y", "-i", source, "-vn", "-ac", "1", "-ar", "16000",
                    "-c:a", "pcm_s16le", audio], capture_output=True, check=True)


def _create_browser_preview(source: str, output: str):
    result = subprocess.run([
        FFMPEG, "-y", "-i", source, "-vf", "scale=720:-2",
        "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8",
        "-b:v", "1100k", "-c:a", "libopus", "-b:a", "96k", output,
    ], capture_output=True, text=True)
    if result.returncode:
        logger.warning("Browser preview conversion failed: %s", result.stderr[-1200:])
        return None
    return Path(output).read_bytes()


async def _run_caption_job(db, project_id: str, consume_credit: bool):
    try:
        project = await db.projects.find_one({"project_id": project_id}, {"_id": 0})
        if not project:
            return
        await db.projects.update_one({"project_id": project_id}, {"$set": {
            "status": "processing", "progress": 12, "processing_label": "Preparing audio",
            "error_message": None, "updated_at": datetime.now(timezone.utc).isoformat()}})
        data, _ = await asyncio.to_thread(get_object, project["source_path"])
        suffix = Path(project.get("name") or "video.mp4").suffix.lower() or ".mp4"
        with tempfile.TemporaryDirectory() as temp:
            source = os.path.join(temp, f"source{suffix}")
            audio = os.path.join(temp, "speech.wav")
            preview = os.path.join(temp, "preview.webm")
            Path(source).write_bytes(data)
            await asyncio.to_thread(_extract_audio, source, audio)
            preview_task = asyncio.create_task(asyncio.to_thread(_create_browser_preview, source, preview))
            await db.projects.update_one({"project_id": project_id}, {"$set": {
                "progress": 28, "processing_label": "Listening word by word"}})
            words, transcription = await transcribe_words(audio, project.get("speech_language", "auto"))
            source_transcript = " ".join(word["original"] for word in words)
            await db.projects.update_one({"project_id": project_id}, {"$set": {
                "progress": 78, "processing_label": "Creating Roman Hinglish"}})
            words = await convert_to_hinglish(words, project.get("name", ""))
            preview_bytes = await preview_task
            preview_result = None
            if preview_bytes:
                preview_storage_path = f"{APP_NAME}/previews/{project['user_id']}/{uuid.uuid4().hex}.webm"
                preview_result = await asyncio.to_thread(
                    put_object, preview_storage_path, preview_bytes, "video/webm")
        palette = THEMES[project["theme"]]
        for word in words:
            word["color"] = palette["accent"] if word["important"] else palette["base"]
            word["font_size"] = 62 if word["important"] else 52
        ready_fields = {
            "words": words, "source_transcript": source_transcript,
            "transcription_mode": transcription["mode"], "transcription_quality": transcription,
            "status": "ready", "progress": 100, "processing_label": "Captions ready",
            "updated_at": datetime.now(timezone.utc).isoformat()}
        if preview_result:
            ready_fields.update({"preview_path": preview_result["path"], "preview_content_type": "video/webm"})
        await db.projects.update_one({"project_id": project_id}, {"$set": ready_fields})
        if consume_credit:
            credit = project.get("credit_type")
            if credit == "testing":
                await db.usage.update_one({"user_id": project["user_id"]}, {"$inc": {"videos_created": 1}})
            elif credit in {"free", "oneoff", "basic"}:
                field = {"free": "free_remaining", "oneoff": "oneoff_credits", "basic": "basic_credits"}[credit]
                await db.usage.update_one({"user_id": project["user_id"]}, {"$inc": {field: -1, "videos_created": 1}})
    except Exception as exc:
        logger.exception("Background caption job failed for %s", project_id)
        message = ("No trustworthy transcript was found. Try clearer speech or less background music."
                   if "trustworthy transcript" in str(exc).lower()
                   else "Caption processing could not finish. Please try Re-listen.")
        await db.projects.update_one({"project_id": project_id}, {"$set": {
            "status": "failed", "progress": 100, "processing_label": "Processing failed",
            "error_message": message, "updated_at": datetime.now(timezone.utc).isoformat()}})
    finally:
        active_jobs.discard(project_id)


def schedule_caption_job(db, project_id: str, consume_credit: bool = True):
    if project_id in active_jobs:
        return
    active_jobs.add(project_id)
    asyncio.create_task(_run_caption_job(db, project_id, consume_credit))


async def resume_pending_projects(db):
    pending = await db.projects.find({"status": {"$in": ["queued", "processing"]}}, {"_id": 0, "project_id": 1}).to_list(100)
    for project in pending:
        schedule_caption_job(db, project["project_id"], consume_credit=True)


@projects_router.get("/usage")
async def usage(request: Request, user=Depends(current_user)):
    record = await _usage(request.app.state.db, user["user_id"])
    return {**record, "unlimited_testing": os.environ.get("UNLIMITED_TESTING", "").lower() == "true", "plans": [
        {"id": "single_45", "name": "Single video", "price": 69, "videos": 1, "max_seconds": 45},
        {"id": "basic_monthly", "name": "Basic", "price": 399, "videos": 10, "max_seconds": 60},
    ]}


@projects_router.post("/projects/process")
async def process_video(request: Request, file: UploadFile = File(...),
                        theme: str = Form("viral"), speech_language: str = Form("auto"),
                        user=Depends(current_user)):
    if theme not in THEMES:
        raise HTTPException(400, "Unknown caption theme")
    if speech_language not in {"hi", "auto"}:
        raise HTTPException(400, "Speech language must be Hindi/Hinglish or Auto")
    suffix = Path(file.filename or "video.mp4").suffix.lower()
    if suffix not in {".mp4", ".mov"}:
        raise HTTPException(415, "Upload an MP4 or MOV video")
    data = await file.read()
    if len(data) > 120 * 1024 * 1024:
        raise HTTPException(413, "Video must be smaller than 120 MB")
    with tempfile.TemporaryDirectory() as temp:
        source = os.path.join(temp, f"source{suffix}")
        audio = os.path.join(temp, "speech.wav")
        Path(source).write_bytes(data)
        try:
            duration = await asyncio.to_thread(_duration, source)
        except Exception as exc:
            raise HTTPException(422, "This video could not be read") from exc
        if duration > 120:
            raise HTTPException(422, "Videos can be at most 120 seconds")
        db = request.app.state.db
        usage_record = await _usage(db, user["user_id"])
        credit = _entitlement(usage_record, duration)
        if not credit:
            detail = "Current plans process up to 60 seconds" if duration > 60 else "Choose a video pass or Basic plan to continue"
            raise HTTPException(402, detail)
        project_id = f"project_{uuid.uuid4().hex[:12]}"
        storage_path = f"{APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}{suffix}"
        try:
            stored = await asyncio.to_thread(put_object, storage_path, data, file.content_type or "video/mp4")
        except Exception as exc:
            raise HTTPException(503, "Video upload could not be stored. Please try again.") from exc
        project = {"project_id": project_id, "user_id": user["user_id"], "name": file.filename,
                   "duration": duration, "theme": theme, "words": [], "source_transcript": "",
                   "speech_language": speech_language, "transcription_mode": None,
                   "transcription_quality": None, "source_path": stored["path"],
                   "content_type": file.content_type or "video/mp4", "credit_type": credit,
                   "render_path": None, "status": "queued", "progress": 5,
                   "processing_label": "Upload complete", "error_message": None,
                   "created_at": datetime.now(timezone.utc).isoformat()}
        await db.projects.insert_one(project.copy())
        schedule_caption_job(db, project_id, consume_credit=True)
        return _public_project(project)


@projects_router.get("/projects/{project_id}")
async def get_project(project_id: str, request: Request, user=Depends(current_user)):
    project = await request.app.state.db.projects.find_one(
        {"project_id": project_id, "user_id": user["user_id"]}, {"_id": 0})
    if not project:
        raise HTTPException(404, "Project not found")
    return _public_project(project)


@projects_router.put("/projects/{project_id}")
async def update_project(project_id: str, payload: ProjectEdit, request: Request,
                         user=Depends(current_user)):
    if payload.theme not in THEMES:
        raise HTTPException(400, "Unknown theme")
    result = await request.app.state.db.projects.update_one(
        {"project_id": project_id, "user_id": user["user_id"]},
        {"$set": {"theme": payload.theme, "words": [word.model_dump() for word in payload.words],
                  "updated_at": datetime.now(timezone.utc).isoformat()}})
    if not result.matched_count:
        raise HTTPException(404, "Project not found")
    return {"status": "saved"}


@projects_router.get("/projects/{project_id}/srt")
async def export_srt(project_id: str, request: Request, user=Depends(current_user)):
    project = await request.app.state.db.projects.find_one(
        {"project_id": project_id, "user_id": user["user_id"]}, {"_id": 0, "words": 1})
    if not project:
        raise HTTPException(404, "Project not found")
    if not project.get("words"):
        raise HTTPException(422, "No captions to export yet")
    srt = _write_srt(project["words"])
    return Response(srt, media_type="application/x-subrip",
                    headers={"Content-Disposition": "attachment; filename=captain-title.srt"})


@projects_router.post("/projects/{project_id}/retranscribe")
async def retranscribe_project(project_id: str, payload: RetranscribeRequest, request: Request,
                               user=Depends(current_user)):
    if payload.speech_language not in {"hi", "auto"}:
        raise HTTPException(400, "Speech language must be Hindi only or Adaptive Hinglish")
    db = request.app.state.db
    project = await db.projects.find_one(
        {"project_id": project_id, "user_id": user["user_id"]}, {"_id": 0})
    if not project:
        raise HTTPException(404, "Project not found")
    await db.projects.update_one({"project_id": project_id}, {"$set": {
        "speech_language": payload.speech_language, "status": "queued", "progress": 5,
        "processing_label": "Re-listen queued", "error_message": None, "words": [],
        "source_transcript": "",
        "updated_at": datetime.now(timezone.utc).isoformat()}})
    schedule_caption_job(db, project_id, consume_credit=False)
    refreshed = await db.projects.find_one({"project_id": project_id}, {"_id": 0})
    return _public_project(refreshed)


def _ass_time(seconds):
    hours = int(seconds // 3600); minutes = int((seconds % 3600) // 60); secs = seconds % 60
    return f"{hours}:{minutes:02d}:{secs:05.2f}"


def _ass_color(hex_color):
    value = hex_color.lstrip("#").ljust(6, "F")[:6]
    return f"&H00{value[4:6]}{value[2:4]}{value[0:2]}&"


def _write_ass(path, words, theme):
    header = """[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,DejaVu Sans,52,&H00FFFFFF,&H00007AFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,70,70,210,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"""
    lines = [header]
    for word in words:
        safe = word["text"].replace("{", "").replace("}", "")
        styled = f"{{\\c{_ass_color(word.get('color', '#FFFFFF'))}\\fs{word.get('font_size', 52)}}}{safe}"
        lines.append(f"Dialogue: 0,{_ass_time(word['start'])},{_ass_time(word['end'])},Default,,0,0,0,,{styled}\n")
    Path(path).write_text("".join(lines), encoding="utf-8")


def _srt_time(seconds):
    hours = int(seconds // 3600); minutes = int((seconds % 3600) // 60); secs = seconds % 60
    millis = int(round((secs - int(secs)) * 1000))
    return f"{hours:02d}:{minutes:02d}:{int(secs):02d},{millis:03d}"


def _write_srt(words):
    lines = []
    for index, word in enumerate(words, start=1):
        lines.append(f"{index}\n{_srt_time(word['start'])} --> {_srt_time(word['end'])}\n{word['text']}\n")
    return "\n".join(lines)


def _render(source, ass_path, output):
    result = subprocess.run([FFMPEG, "-y", "-i", source, "-vf", f"subtitles={ass_path}",
                             "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac",
                             "-movflags", "+faststart", output], capture_output=True, text=True)
    if result.returncode:
        logger.error("FFmpeg render failed: %s", result.stderr[-2000:])
        raise RuntimeError("FFmpeg could not render this video")


@projects_router.post("/projects/{project_id}/render")
async def render(project_id: str, request: Request, user=Depends(current_user)):
    db = request.app.state.db
    project = await db.projects.find_one({"project_id": project_id, "user_id": user["user_id"]}, {"_id": 0})
    if not project:
        raise HTTPException(404, "Project not found")
    data, content_type = await asyncio.to_thread(get_object, project["source_path"])
    with tempfile.TemporaryDirectory() as temp:
        source = os.path.join(temp, "source.mp4")
        ass = os.path.join(temp, "captions.ass")
        output = os.path.join(temp, "captain-title.mp4")
        Path(source).write_bytes(data)
        _write_ass(ass, project["words"], project["theme"])
        try:
            await asyncio.to_thread(_render, source, ass, output)
        except Exception as exc:
            raise HTTPException(500, "Video rendering failed") from exc
        rendered = Path(output).read_bytes()
        output_path = f"{APP_NAME}/renders/{user['user_id']}/{uuid.uuid4().hex}.mp4"
        stored = await asyncio.to_thread(put_object, output_path, rendered, "video/mp4")
    await db.projects.update_one({"project_id": project_id}, {"$set": {"render_path": stored["path"], "status": "rendered"}})
    return {"status": "rendered", "download_url": f"/api/projects/{project_id}/download"}


@projects_router.get("/projects/{project_id}/media")
async def project_media(project_id: str, request: Request,
                        range_header: str | None = Header(default=None, alias="Range"),
                        user=Depends(current_user)):
    project = await request.app.state.db.projects.find_one(
        {"project_id": project_id, "user_id": user["user_id"]},
        {"_id": 0, "source_path": 1, "preview_path": 1, "preview_content_type": 1})
    if not project:
        raise HTTPException(404, "Project not found")
    media_path = project.get("preview_path") or project["source_path"]
    data, content_type = await asyncio.to_thread(get_object, media_path)
    content_type = project.get("preview_content_type") or content_type
    total = len(data)
    common_headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"}
    if not range_header:
        return Response(data, media_type=content_type,
                        headers={**common_headers, "Content-Length": str(total)})
    match = re.match(r"bytes=(\d*)-(\d*)$", range_header.strip())
    if not match:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{total}", **common_headers})
    start_raw, end_raw = match.groups()
    if start_raw:
        start = int(start_raw)
        end = min(int(end_raw) if end_raw else total - 1, total - 1)
    else:
        suffix_length = min(int(end_raw or 0), total)
        start, end = total - suffix_length, total - 1
    if start < 0 or start >= total or end < start:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{total}", **common_headers})
    chunk = data[start:end + 1]
    return Response(chunk, status_code=206, media_type=content_type, headers={
        **common_headers, "Content-Range": f"bytes {start}-{end}/{total}",
        "Content-Length": str(len(chunk)),
    })


@projects_router.get("/projects/{project_id}/download")
async def download(project_id: str, request: Request, user=Depends(current_user)):
    project = await request.app.state.db.projects.find_one(
        {"project_id": project_id, "user_id": user["user_id"]}, {"_id": 0, "render_path": 1})
    if not project or not project.get("render_path"):
        raise HTTPException(404, "Rendered video not found")
    data, _ = await asyncio.to_thread(get_object, project["render_path"])
    return Response(data, media_type="video/mp4", headers={"Content-Disposition": "attachment; filename=captain-title.mp4"})