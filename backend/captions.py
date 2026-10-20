import asyncio
import logging
import os
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
import imageio_ffmpeg

from auth import current_user
from caption_ai import convert_to_hinglish, reassign_emphasis, transcribe_words
from storage_service import APP_NAME, get_object, put_object

projects_router = APIRouter(prefix="/api", tags=["captions"])
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
FONTS_DIR = Path(__file__).resolve().parent / "fonts"
logger = logging.getLogger("captain-title.captions")
active_jobs: set[str] = set()
# Caption templates: a color scheme plus an optional "accent_font" used only
# for emphasized/important words - the primary font for everything else
# comes from the separately chosen FONTS entry below, so a template can mix
# two fonts (accent_font set) or stay single-font (accent_font None).
THEMES = {
    "viral": {"base": "#FFFFFF", "accent": "#FF3B30", "accent_font": "Anton"},
    "cinematic": {"base": "#FFF7DB", "accent": "#FFB800", "accent_font": "Caveat"},
    "minimal": {"base": "#FFFFFF", "accent": "#007AFF", "accent_font": None},
    "podcast": {"base": "#FFFFFF", "accent": "#A855F7", "accent_font": None},
    "meme_mix": {"base": "#FFFFFF", "accent": "#FFEB3B", "accent_font": "Permanent Marker"},
    "street_pop": {"base": "#FFFFFF", "accent": "#FF6EC7", "accent_font": "Caveat"},
    # Designer "tiered" templates: a 3-way support/feature/key reading of
    # each word (see convert_to_hinglish's emphasis field) instead of a
    # flat important/normal split, each tier with its own font/color/size -
    # matches the layered, mixed-typography look used by top caption apps.
    "editorial_pop": {"tiers": {
        "support": {"font": "Poppins", "color": "#FFFFFF", "size": 40},
        "feature": {"font": "Playfair Display SemiBold", "color": "#FFFFFF", "size": 58},
        "key": {"font": "Anton", "color": "#FFEB3B", "size": 82},
    }},
    "clean_vogue": {"tiers": {
        "support": {"font": "Poppins", "color": "#E4E4E7", "size": 38},
        "feature": {"font": "Playfair Display SemiBold", "color": "#FF8FC7", "size": 56},
        "key": {"font": "Bebas Neue", "color": "#FFFFFF", "size": 86},
    }},
    "street_heat": {"tiers": {
        "support": {"font": "Poppins", "color": "#FFFFFF", "size": 40},
        "feature": {"font": "Permanent Marker", "color": "#FFFFFF", "size": 54},
        "key": {"font": "Anton", "color": "#FF4D00", "size": 84},
    }},
}
FONTS = {
    "poppins": {"label": "Poppins", "family": "Poppins"},
    "anton": {"label": "Anton", "family": "Anton"},
    "bebas": {"label": "Bebas Neue", "family": "Bebas Neue"},
    "classic": {"label": "Classic", "family": "DejaVu Sans"},
}


CAPTION_POSITIONS = {"top", "middle", "bottom"}


class WordEdit(BaseModel):
    index: int
    text: str = Field(min_length=1, max_length=80)
    original: str = ""
    start: float
    end: float
    important: bool = False
    emphasis: str = "support"
    uncertain: bool = False
    color: str = "#FFFFFF"
    font_size: int = Field(default=52, ge=24, le=92)
    # None means "no manual placement" - inherit the project's caption_position
    # preset. A concrete value is a percentage (0-100) of canvas width/height
    # for where the caption box's center should sit, set by dragging it in
    # the editor.
    pos_x: float | None = Field(default=None, ge=0, le=100)
    pos_y: float | None = Field(default=None, ge=0, le=100)
    # None means "use the automatic default" (a tier change for a tiered
    # template, or the midpoint for a plain two-line template) - True/False
    # is an explicit manual override from a merge/split edit.
    new_line: bool | None = None
    # None means "auto" (size to content, as before). A concrete value is a
    # percentage of canvas width/height for an explicit box size set by
    # dragging a resize handle in the editor. Editor-side only for now - the
    # ASS renderer still places text at a point (\pos), not a wrapped box.
    box_width: float | None = Field(default=None, ge=0, le=100)
    box_height: float | None = Field(default=None, ge=0, le=100)


class ElementEdit(BaseModel):
    id: str
    # "sticker" is one of the curated glyph buttons (Elements panel); "text"
    # is free-form typed content (Text panel) and additionally honors font_id.
    kind: Literal["sticker", "text"] = "sticker"
    char: str = Field(min_length=1, max_length=60)
    font_id: str = "poppins"
    color: str = "#FFFFFF"
    font_size: int = Field(default=120, ge=20, le=280)
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    pos_x: float = Field(default=50, ge=0, le=100)
    pos_y: float = Field(default=30, ge=0, le=100)


class SfxMarker(BaseModel):
    id: str
    # Editor-side annotation only for now - there's no licensed SFX audio
    # bundled to actually mix into the export (see render(), which doesn't
    # read this field). It's persisted and shown on the timeline so the
    # marker placement itself isn't lost between sessions.
    type: Literal["whoosh", "pop", "cash", "ding"]
    time: float = Field(ge=0)


class ProjectEdit(BaseModel):
    theme: str
    font_id: str = "poppins"
    words_per_caption: int | None = Field(default=None, ge=1, le=8)
    caption_lines: int = Field(default=1, ge=1, le=2)
    caption_position: str = "bottom"
    audio_volume: int = Field(default=100, ge=0, le=200)
    audio_muted: bool = False
    brightness: int = Field(default=0, ge=-50, le=50)
    contrast: int = Field(default=100, ge=50, le=200)
    saturation: int = Field(default=100, ge=0, le=200)
    render_quality: Literal["high", "draft"] = "high"
    words: list[WordEdit]
    elements: list[ElementEdit] = []
    sfx_markers: list[SfxMarker] = []


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


def _video_resolution(path):
    result = subprocess.run([FFMPEG, "-i", path, "-f", "null", "-"],
                            capture_output=True, text=True)
    match = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", result.stderr)
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


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
        tiers = palette.get("tiers")
        for word in words:
            if tiers:
                config = tiers[word["emphasis"] if word.get("emphasis") in tiers else "support"]
                word["color"] = config["color"]
                word["font_size"] = config["size"]
            else:
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
                        theme: str = Form("viral"), font_id: str = Form("poppins"),
                        speech_language: str = Form("auto"),
                        user=Depends(current_user)):
    if theme not in THEMES:
        raise HTTPException(400, "Unknown caption theme")
    if font_id not in FONTS:
        raise HTTPException(400, "Unknown caption font")
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
        width, height = await asyncio.to_thread(_video_resolution, source)
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
                   "duration": duration, "width": width, "height": height, "size_bytes": len(data),
                   "theme": theme, "font_id": font_id,
                   "words_per_caption": None, "caption_lines": 1, "caption_position": "bottom",
                   "audio_volume": 100, "audio_muted": False,
                   "brightness": 0, "contrast": 100, "saturation": 100, "render_quality": "high", "elements": [], "sfx_markers": [],
                   "words": [], "source_transcript": "",
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
    if payload.font_id not in FONTS:
        raise HTTPException(400, "Unknown caption font")
    if payload.caption_position not in CAPTION_POSITIONS:
        raise HTTPException(400, "Unknown caption position")
    result = await request.app.state.db.projects.update_one(
        {"project_id": project_id, "user_id": user["user_id"]},
        {"$set": {"theme": payload.theme, "font_id": payload.font_id,
                  "words_per_caption": payload.words_per_caption,
                  "caption_lines": payload.caption_lines, "caption_position": payload.caption_position,
                  "audio_volume": payload.audio_volume, "audio_muted": payload.audio_muted,
                  "brightness": payload.brightness, "contrast": payload.contrast, "saturation": payload.saturation,
                  "render_quality": payload.render_quality,
                  "words": [word.model_dump() for word in payload.words],
                  "elements": [element.model_dump() for element in payload.elements],
                  "sfx_markers": [marker.model_dump() for marker in payload.sfx_markers],
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


@projects_router.post("/projects/{project_id}/ai/emphasis")
async def reassign_emphasis_endpoint(project_id: str, request: Request, user=Depends(current_user)):
    db = request.app.state.db
    project = await db.projects.find_one({"project_id": project_id, "user_id": user["user_id"]}, {"_id": 0})
    if not project:
        raise HTTPException(404, "Project not found")
    if not project.get("words"):
        raise HTTPException(422, "No captions to re-tag yet")
    try:
        words = await reassign_emphasis(list(project["words"]), project.get("name", ""))
    except Exception as exc:
        raise HTTPException(502, "AI emphasis re-assignment failed. Please try again.") from exc
    # Re-bake color/font_size from the (possibly now different) tier, same
    # as a template switch does - a word whose tier just changed shouldn't
    # keep styling that belonged to its old one.
    palette = THEMES.get(project["theme"], THEMES["viral"])
    tiers = palette.get("tiers")
    for word in words:
        if tiers:
            config = tiers[word["emphasis"] if word.get("emphasis") in tiers else "support"]
            word["color"] = config["color"]
            word["font_size"] = config["size"]
        else:
            word["color"] = palette["accent"] if word["important"] else palette["base"]
            word["font_size"] = 62 if word["important"] else 52
    await db.projects.update_one({"project_id": project_id}, {"$set": {
        "words": words, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"words": words}


def _ass_time(seconds):
    hours = int(seconds // 3600); minutes = int((seconds % 3600) // 60); secs = seconds % 60
    return f"{hours}:{minutes:02d}:{secs:05.2f}"


def _ass_color(hex_color):
    value = hex_color.lstrip("#").ljust(6, "F")[:6]
    return f"&H00{value[4:6]}{value[2:4]}{value[0:2]}&"


SENTENCE_END_CHARS = ".!?।॥"  # includes Devanagari danda/double danda


def _ends_sentence(word):
    """Whether this word closes out a sentence/dialogue line, judged from its
    original (pre-Hinglish-romanization) text - GPT's romanization pass isn't
    reliably instructed to keep trailing punctuation, but Sarvam's raw output
    does carry it."""
    original = (word.get("original") or "").strip()
    return bool(original) and original[-1] in SENTENCE_END_CHARS


def _group_words_for_display(words, min_display=0.35, max_words=3, max_gap=0.4, strict_count=False):
    """Group fast/short consecutive words into one display line so each stays
    on screen long enough to read (and to survive the video player's own
    timeupdate granularity) instead of flashing past one at a time. With
    strict_count (a user-chosen words-per-caption instead of "Auto"), always
    pack up to max_words rather than stopping early once min_display is met -
    a natural pause (max_gap) is still a break point either way. A sentence-
    ending word is always the last word of its group, regardless of the gap
    or count settings, so a caption never splices the tail of one sentence
    onto the start of the next."""
    groups = []
    index = 0
    total = len(words)
    while index < total:
        group = [words[index]]
        group_end = words[index]["end"]
        next_index = index + 1
        while (next_index < total and len(group) < max_words and not _ends_sentence(group[-1])
              and words[next_index]["start"] - group_end < max_gap
              and (strict_count or group_end - words[index]["start"] < min_display)):
            group.append(words[next_index])
            group_end = words[next_index]["end"]
            next_index += 1
        groups.append(group)
        index = next_index
    return groups


# Alignment (ASS \an numpad values) and vertical margin for each position
# preset. "middle" ignores MarginV (ASS vertically centers regardless).
POSITION_PRESETS = {"top": (8, 150), "middle": (5, 0), "bottom": (2, 210)}


def _group_position(group, caption_position):
    """A group carries a manual pos_x/pos_y (dragged in the editor) on its
    first word if the user has placed this exact caption - otherwise fall
    back to the project's position preset."""
    anchor = group[0]
    pos_x, pos_y = anchor.get("pos_x"), anchor.get("pos_y")
    if pos_x is not None and pos_y is not None:
        x_px, y_px = round(pos_x / 100 * 1080), round(pos_y / 100 * 1920)
        return f"\\an5\\pos({x_px},{y_px})", 0
    align, margin_v = POSITION_PRESETS.get(caption_position, POSITION_PRESETS["bottom"])
    return f"\\an{align}", margin_v


def _auto_line_breaks(group, tiers, caption_lines):
    """The default line-wrap, before any manual override: a tiered template
    breaks at each tier change (not always a new line per word - a run of
    consecutive same-tier words, e.g. two support words, still shares a
    line); a plain template splits once at the midpoint when caption_lines
    is 2, otherwise never breaks."""
    if tiers:
        breaks = [False] * len(group)
        previous_tier = None
        for index, word in enumerate(group):
            tier = word["emphasis"] if word.get("emphasis") in tiers else "support"
            breaks[index] = index > 0 and tier != previous_tier
            previous_tier = tier
        return breaks
    if caption_lines == 2 and len(group) > 1:
        midpoint = -(-len(group) // 2)
        return [index == midpoint for index in range(len(group))]
    return [False] * len(group)


def _resolve_line_breaks(group, tiers, caption_lines):
    """The automatic default, with any word's explicit new_line (set by a
    manual merge/split edit) taking precedence over it."""
    auto = _auto_line_breaks(group, tiers, caption_lines)
    return [word["new_line"] if word.get("new_line") is not None else auto[index]
            for index, word in enumerate(group)]


def _write_element_dialogue(element):
    """A sticker or free-text overlay: fixed position (no word-sync), own
    font size/color, drawn on a layer above the caption text so it sits on
    top of it. A sticker glyph relies on fontconfig's own fallback to find a
    font that covers it (the project's chosen caption font usually doesn't);
    a text layer instead honors its own explicit font choice."""
    safe = (element.get("char") or "").replace("{", "").replace("}", "")
    x_px = round(element.get("pos_x", 50) / 100 * 1080)
    y_px = round(element.get("pos_y", 30) / 100 * 1920)
    tags = f"\\an5\\pos({x_px},{y_px})\\fs{element.get('font_size', 120)}\\c{_ass_color(element.get('color', '#FFFFFF'))}"
    if element.get("kind") == "text":
        family = FONTS.get(element.get("font_id", "poppins"), FONTS["poppins"])["family"]
        tags = f"\\fn{family}" + tags
    return (f"Dialogue: 1,{_ass_time(element['start'])},{_ass_time(element['end'])},"
            f"Default,,0,0,0,,{{{tags}}}{safe}\n")


def _write_ass(path, words, theme, font_id="poppins", words_per_caption=None,
               caption_lines=1, caption_position="bottom", elements=None):
    palette = THEMES.get(theme, THEMES["viral"])
    primary_family = FONTS.get(font_id, FONTS["poppins"])["family"]
    tiers = palette.get("tiers")
    accent_family = palette.get("accent_font") or primary_family
    header = f"""[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,{primary_family},52,&H00FFFFFF,&H00007AFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,70,70,210,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"""
    lines = [header]
    groups = _group_words_for_display(words, max_words=words_per_caption or 3,
                                      strict_count=words_per_caption is not None)
    for group in groups:
        position_tag, margin_v = _group_position(group, caption_position)
        breaks = _resolve_line_breaks(group, tiers, caption_lines)
        word_parts = []
        for index, word in enumerate(group):
            safe = word["text"].replace("{", "").replace("}", "")
            # Color/size always come from the word itself (editable per word
            # in the UI, defaulted from the theme at generation/theme-switch
            # time) - a tiered theme only still decides the font family.
            if tiers:
                tier = word["emphasis"] if word.get("emphasis") in tiers else "support"
                family = tiers[tier]["font"]
            else:
                family = accent_family if word.get("important") else primary_family
            tags = f"\\fn{family}\\c{_ass_color(word.get('color', '#FFFFFF'))}\\fs{word.get('font_size', 52)}"
            if index == 0:
                tags = position_tag + tags
            separator = r"\N" if (index > 0 and breaks[index]) else (" " if index > 0 else "")
            word_parts.append(f"{separator}{{{tags}}}{safe}")
        styled = "".join(word_parts)
        lines.append(f"Dialogue: 0,{_ass_time(group[0]['start'])},{_ass_time(group[-1]['end'])},"
                     f"Default,,0,0,{margin_v},,{styled}\n")
    for element in (elements or []):
        if element["end"] > element["start"]:
            lines.append(_write_element_dialogue(element))
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


def _escape_filter_path(path):
    """ffmpeg's filtergraph syntax splits options on ':' and uses '\\' to
    escape characters, so a raw Windows path (drive-letter colon, backslash
    separators) has to be escaped before it can be embedded as a filter
    option value - otherwise the drive letter's colon gets parsed as the
    end of the filename argument."""
    return Path(path).as_posix().replace(":", r"\:")


RENDER_QUALITY_PRESETS = {
    # "high" is close to visually lossless; "draft" trades quality for a
    # much faster encode when you just want to sanity-check timing/styling
    # before spending the time on a full-quality export.
    "high": {"preset": "slow", "crf": "17"},
    "draft": {"preset": "veryfast", "crf": "26"},
}


def _render(source, ass_path, output, fonts_dir, audio_volume=100, audio_muted=False,
           brightness=0, contrast=100, saturation=100, quality="high"):
    # Escaping a Windows drive-letter colon with '\:' only works for the
    # subtitles filter's own filename argument - ffmpeg's generic option
    # parser (used for fontsdir=...) doesn't honor that escape the same way
    # and chokes right where the drive letter starts. Sidestep the whole
    # problem by running ffmpeg from the .ass file's directory and
    # referencing both paths relatively, so neither needs a drive letter
    # (and therefore no colon) in the filtergraph string at all.
    work_dir = os.path.dirname(ass_path)
    ass_name = os.path.basename(ass_path)
    fonts_rel = os.path.relpath(fonts_dir, work_dir)
    subtitles_arg = f"subtitles={_escape_filter_path(ass_name)}:fontsdir={_escape_filter_path(fonts_rel)}"
    volume = 0 if audio_muted else max(0, audio_volume) / 100
    # Color grading runs before the subtitles are burned in, so captions
    # stay their own full-strength color regardless of how the footage is
    # graded - matches how caption apps treat text as a separate layer.
    eq_arg = f"eq=brightness={brightness / 100}:contrast={contrast / 100}:saturation={saturation / 100}"
    video_filter = f"{eq_arg},{subtitles_arg}"
    render_preset = RENDER_QUALITY_PRESETS.get(quality, RENDER_QUALITY_PRESETS["high"])
    result = subprocess.run([FFMPEG, "-y", "-i", source, "-vf", video_filter,
                             "-af", f"volume={volume}",
                             "-c:v", "libx264", "-preset", render_preset["preset"], "-crf", render_preset["crf"],
                             "-c:a", "aac", "-b:a", "192k",
                             "-movflags", "+faststart", output], capture_output=True, text=True, cwd=work_dir)
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
        _write_ass(ass, project["words"], project["theme"], project.get("font_id", "poppins"),
                  project.get("words_per_caption"), project.get("caption_lines", 1),
                  project.get("caption_position", "bottom"), project.get("elements"))
        try:
            await asyncio.to_thread(_render, source, ass, output, str(FONTS_DIR),
                                    project.get("audio_volume", 100), project.get("audio_muted", False),
                                    project.get("brightness", 0), project.get("contrast", 100),
                                    project.get("saturation", 100), project.get("render_quality", "high"))
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