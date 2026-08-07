import asyncio
import logging
import os
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
import imageio_ffmpeg

from auth import current_user
from caption_ai import convert_to_hinglish, transcribe_words
from storage_service import APP_NAME, get_object, put_object

projects_router = APIRouter(prefix="/api", tags=["captions"])
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
logger = logging.getLogger("captain-title.captions")
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
        try:
            await asyncio.to_thread(_extract_audio, source, audio)
            words, transcription = await transcribe_words(audio, speech_language)
            source_transcript = " ".join(word["original"] for word in words)
            words = await convert_to_hinglish(words, file.filename or "")
            palette = THEMES[theme]
            for word in words:
                word["color"] = palette["accent"] if word["important"] else palette["base"]
                word["font_size"] = 62 if word["important"] else 52
            project_id = f"project_{uuid.uuid4().hex[:12]}"
            storage_path = f"{APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}{suffix}"
            stored = await asyncio.to_thread(put_object, storage_path, data, file.content_type or "video/mp4")
            project = {"project_id": project_id, "user_id": user["user_id"], "name": file.filename,
                       "duration": duration, "theme": theme, "words": words,
                       "source_transcript": source_transcript, "speech_language": speech_language,
                       "transcription_mode": transcription["mode"],
                       "transcription_quality": transcription,
                       "source_path": stored["path"], "render_path": None, "status": "ready",
                       "created_at": datetime.now(timezone.utc).isoformat()}
            await db.projects.insert_one(project.copy())
            if credit == "testing":
                await db.usage.update_one({"user_id": user["user_id"]}, {"$inc": {"videos_created": 1}})
            else:
                field = {"free": "free_remaining", "oneoff": "oneoff_credits", "basic": "basic_credits"}[credit]
                await db.usage.update_one({"user_id": user["user_id"]}, {"$inc": {field: -1, "videos_created": 1}})
            project.pop("user_id")
            project.pop("source_path")
            return project
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Caption generation failed")
            message = str(exc)
            if "trustworthy transcript" in message.lower():
                raise HTTPException(424, {"message": message, "reason": "low_confidence_audio"}) from exc
            raise HTTPException(424, {"message": "Caption generation could not finish. Please try Re-listen or a clearer audio track.",
                                      "reason": "transcription_failed"}) from exc


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
    data, _ = await asyncio.to_thread(get_object, project["source_path"])
    with tempfile.TemporaryDirectory() as temp:
        source = os.path.join(temp, "source.mp4")
        audio = os.path.join(temp, "speech.wav")
        Path(source).write_bytes(data)
        try:
            if await asyncio.to_thread(_duration, source) > 120:
                raise ValueError("Stored video exceeds the 120-second limit")
            await asyncio.to_thread(_extract_audio, source, audio)
            words, transcription = await transcribe_words(audio, payload.speech_language)
            source_transcript = " ".join(word["original"] for word in words)
            words = await convert_to_hinglish(words, project.get("name", ""))
        except Exception as exc:
            logger.exception("Re-transcription failed")
            raise HTTPException(424, {"message": "Re-listen could not produce a trustworthy transcript from this audio.",
                                      "reason": "low_confidence_audio"}) from exc
    palette = THEMES[project["theme"]]
    for word in words:
        word["color"] = palette["accent"] if word["important"] else palette["base"]
        word["font_size"] = 62 if word["important"] else 52
    await db.projects.update_one({"project_id": project_id}, {"$set": {
        "words": words, "source_transcript": source_transcript,
        "speech_language": payload.speech_language,
        "transcription_mode": transcription["mode"],
        "transcription_quality": transcription,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    return {"project_id": project_id, "words": words, "source_transcript": source_transcript,
            "transcription_mode": transcription["mode"], "transcription_quality": transcription}


def _ass_time(seconds):
    hours = int(seconds // 3600); minutes = int((seconds % 3600) // 60); secs = seconds % 60
    return f"{hours}:{minutes:02d}:{secs:05.2f}"


def _ass_color(hex_color):
    value = hex_color.lstrip("#").ljust(6, "F")[:6]
    return f"&H00{value[4:6]}{value[2:4]}{value[0:2]}&"


def _write_ass(path, words, theme):
    header = """[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,DejaVu Sans,52,&H00FFFFFF,&H00007AFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,70,70,210,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"""
    lines = [header]
    for start in range(0, len(words), 4):
        group = words[start:start + 4]
        styled = []
        for word in group:
            safe = word["text"].replace("{", "").replace("}", "")
            styled.append(f"{{\\c{_ass_color(word.get('color', '#FFFFFF'))}\\fs{word.get('font_size', 52)}}}{safe}")
        lines.append(f"Dialogue: 0,{_ass_time(group[0]['start'])},{_ass_time(group[-1]['end'])},Default,,0,0,0,,{' '.join(styled)}\n")
    Path(path).write_text("".join(lines), encoding="utf-8")


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
async def project_media(project_id: str, request: Request, user=Depends(current_user)):
    project = await request.app.state.db.projects.find_one(
        {"project_id": project_id, "user_id": user["user_id"]}, {"_id": 0, "source_path": 1})
    if not project:
        raise HTTPException(404, "Project not found")
    data, content_type = await asyncio.to_thread(get_object, project["source_path"])
    return Response(data, media_type=content_type)


@projects_router.get("/projects/{project_id}/download")
async def download(project_id: str, request: Request, user=Depends(current_user)):
    project = await request.app.state.db.projects.find_one(
        {"project_id": project_id, "user_id": user["user_id"]}, {"_id": 0, "render_path": 1})
    if not project or not project.get("render_path"):
        raise HTTPException(404, "Rendered video not found")
    data, _ = await asyncio.to_thread(get_object, project["render_path"])
    return Response(data, media_type="video/mp4", headers={"Content-Disposition": "attachment; filename=captain-title.mp4"})