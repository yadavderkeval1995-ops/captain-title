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
    # "Hormozi style": plain bold white text with the punchline word in
    # bright yellow and a noticeably heavier font - the single most common
    # pattern across today's top caption/editing apps (Kapwing, CapCut).
    "bold_impact": {"base": "#FFFFFF", "accent": "#FFD60A", "accent_font": "Archivo Black"},
    # A calmer, modern alternative for explainer/SaaS-style talking-head
    # content - geometric sans, a cool accent instead of a loud one.
    "tech_editorial": {"base": "#E4E4E7", "accent": "#5EEAD4", "accent_font": "Space Grotesk"},
    # Hindi-first tiered templates: same layered support/feature/key design
    # as the three above, built entirely on bundled fonts with real
    # Devanagari coverage (see DEVANAGARI_CAPABLE_FONTS) instead of a Latin
    # font that would otherwise get silently swapped out the moment native
    # script displays - a Hindi creator gets the same designed look in
    # either script, not a fallback font switch.
    "hindi_bold": {"tiers": {
        "support": {"font": "Hind", "color": "#FFFFFF", "size": 40},
        "feature": {"font": "Mukta ExtraBold", "color": "#FFFFFF", "size": 58},
        "key": {"font": "Baloo 2 ExtraBold", "color": "#FFD60A", "size": 84},
    }},
    "hindi_editorial": {"tiers": {
        "support": {"font": "Hind", "color": "#E4E4E7", "size": 38},
        "feature": {"font": "Tiro Devanagari Hindi", "color": "#FFFFFF", "size": 56},
        "key": {"font": "Rozha One", "color": "#FFB800", "size": 82},
    }},
    "hindi_street": {"tiers": {
        "support": {"font": "Mukta ExtraBold", "color": "#FFFFFF", "size": 40},
        "feature": {"font": "Yatra One", "color": "#FFFFFF", "size": 54},
        "key": {"font": "Baloo 2 ExtraBold", "color": "#FF4D9E", "size": 84},
    }},
    "hindi_minimal": {"tiers": {
        "support": {"font": "Hind", "color": "#E4E4E7", "size": 38},
        "feature": {"font": "Mukta ExtraBold", "color": "#FFFFFF", "size": 54},
        "key": {"font": "Noto Sans Devanagari Black", "color": "#38BDF8", "size": 78},
    }},
}
FONTS = {
    "poppins": {"label": "Poppins", "family": "Poppins"},
    "anton": {"label": "Anton", "family": "Anton"},
    "bebas": {"label": "Bebas Neue", "family": "Bebas Neue"},
    "classic": {"label": "Classic", "family": "DejaVu Sans"},
    "archivo": {"label": "Archivo Black", "family": "Archivo Black"},
    "space_grotesk": {"label": "Space Grotesk", "family": "Space Grotesk"},
    "baloo2": {"label": "Baloo 2", "family": "Baloo 2 ExtraBold"},
    "hind": {"label": "Hind", "family": "Hind"},
    "mukta": {"label": "Mukta", "family": "Mukta ExtraBold"},
    "kalam": {"label": "Kalam", "family": "Kalam"},
}
# Template style variants (Captik-style "VARIANTS" row) - mirrors the
# `variants` export in frontend/src/components/ThemePanel.jsx exactly:
# font family, outline/shadow/blur standing in for text-stroke/box-shadow,
# and the accent color used for "Emphasize"-tagged words. outline=None means
# "use the word's own color" (a self-colored glow) rather than a fixed hue.
VARIANTS = {
    "rock": {"font": "Anton", "bord": 3, "outline": "#000000", "shad": 0, "blur": 0, "accent": "#FF4D00"},
    "glow": {"font": "Outfit", "bord": 3, "outline": None, "shad": 0, "blur": 4, "accent": "#22D3EE"},
    "swiss": {"font": "IBM Plex Sans", "bord": 0, "outline": None, "shad": 0, "blur": 0, "accent": "#007AFF"},
    "clean": {"font": "Poppins", "bord": 0, "outline": "#000000", "shad": 2, "blur": 1, "accent": "#EAB308"},
}
# Editor-side-only fallback accent for an emphasized word when no variant is
# selected - matches the CSS default in App.css's .emphasize-accent rule.
DEFAULT_EMPHASIZE_ACCENT = "#EAB308"
# Dual-script export: none of the bundled Latin display fonts (Anton, Outfit,
# IBM Plex Sans, Poppins, Bebas Neue, DejaVu Sans) carry Devanagari glyphs, so
# when script_mode="native" surfaces a word's native-script text we force
# this font regardless of theme/variant, purely for glyph coverage.
DEVANAGARI_FONT = "Noto Sans Devanagari"
# Every bundled font (backend/fonts/) whose own glyph set actually covers
# Devanagari - a Hindi template built on one of these keeps its own font
# in native-script mode instead of word_tags() silently swapping it out
# for the DEVANAGARI_FONT fallback above (see word_tags's own comment).
DEVANAGARI_CAPABLE_FONTS = {
    DEVANAGARI_FONT, "Noto Sans Devanagari Black", "Baloo 2 ExtraBold", "Hind",
    "Mukta ExtraBold", "Rozha One", "Yatra One", "Tiro Devanagari Hindi", "Kalam",
}
# Every bundled font (backend/fonts/) that actually has a second, genuinely
# bolder weight file of its own - everything else is bundled as a single
# weight (often already a Bold/ExtraBold/Black cut by name, just not paired
# with a lighter sibling file). Requesting \b1 on one of those asks
# fontconfig/libass for a bolder face that doesn't exist, which it answers
# by synthetically embossing the existing glyphs - a visibly different,
# slightly outlined look from how a browser's own font-synthesis renders
# the same request in the live preview. Keying the Bold toggle off this set
# (checked per-word by the actual chosen family, not a single project-wide
# Style flag) means a word only ever gets a REAL bold face, or none at all.
BOLD_CAPABLE_FONTS = {"Poppins", "Caveat"}
_DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")


def _has_devanagari(text):
    return bool(_DEVANAGARI_RE.search(text or ""))


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
    # Bounds mirror the Transform panel's Scale slider (CaptionStudio.jsx's
    # setCaptionScale clamps to [16, 120]) - they MUST match, or scaling a
    # caption past the old 92 ceiling fails this validation on save/export
    # for every word at once (Apply to All Captions broadcasts one size to
    # every word, so a single out-of-range scale fails the whole project).
    font_size: int = Field(default=66, ge=16, le=120)
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
    # The vertical gap (px, at the 1080x1920 canvas scale ROW_GAP_PX uses)
    # ABOVE this word's row, when it starts one - None means "use the
    # project default" (ROW_GAP_PX). Lets each line boundary in a multi-line
    # caption get its own spacing instead of one uniform gap for the whole
    # block (e.g. a tighter gap between the bottom two lines than between
    # the top two).
    gap_before: float | None = Field(default=None, ge=0, le=60)
    # None means "auto" (size to content, as before). A concrete value is a
    # percentage of canvas width/height for an explicit box size set by
    # dragging a resize handle in the editor. Editor-side only for now - the
    # ASS renderer still places text at a point (\pos), not a wrapped box.
    box_width: float | None = Field(default=None, ge=0, le=100)
    box_height: float | None = Field(default=None, ge=0, le=100)
    # None means "no manual rotation" (0deg). A concrete value tilts this
    # caption's whole box around its own center point (the same point \pos
    # anchors on, via \an5), set by the Transform panel's Rotation slider.
    rotation: float | None = Field(default=None, ge=-45, le=45)
    # None means "use the project default line spacing" (LINE_HEIGHT in
    # captions.py / App.css's .caption-overlay). A concrete value is a
    # multiplier on each row's own tallest word, same role LINE_HEIGHT plays
    # - set by the Transform panel's Line Height slider.
    line_height: float | None = Field(default=None, ge=0.8, le=2.0)
    # None means "auto grouping" (the heuristics in _group_words_for_display
    # decide where one caption/display-group ends and the next begins).
    # True forces a new group to start at this word (a manual "Split at
    # Word"/"Split at Playhead" edit); False forces this word to join the
    # PREVIOUS group even if the heuristics would otherwise break here (a
    # manual "Merge with Next" edit, applied to the first word of the group
    # being merged away). Mirrors new_line's tri-state pattern one level up,
    # at the caption-grouping level instead of the line-wrap level.
    new_caption: bool | None = None
    # "FOR THIS MOMENT" kinetic tag applied to this word while it's active in
    # the editor preview. Editor-side only for now, like box_width/height
    # above - the ASS renderer has no equivalent of a live CSS keyframe
    # animation, so this doesn't change the exported video yet.
    kinetic: Literal["pulse", "pop", "scale", "box", "wobble"] | None = None
    # A separate accent highlight from the tiered-template "important" flag -
    # toggled per word from the moment popover, not tied to any theme/tier.
    # Unlike kinetic above, this DOES reach the export: _write_ass recolors
    # (to the active variant's accent, or a default yellow) and up-sizes the
    # word, mirroring App.css's .emphasize-accent rule.
    emphasize: bool = False


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
    # Draw-order staging relative to the caption text (ASS Layer field: a
    # higher layer draws on top). This is standard z-index staging only -
    # there's no video matting/segmentation here, so "behind" sits behind
    # the captions, not behind an actual person in the footage.
    layer: Literal["front", "behind"] = "front"


class SfxMarker(BaseModel):
    id: str
    # There's no licensed SFX audio bundled, so both the editor's on-click
    # preview and the actual export (_render's ffmpeg filter_complex) play a
    # synthesized placeholder tone per type instead of a real sample - see
    # frontend/src/lib/sfx.js (editor) and _sfx_source_filter (export),
    # which are hand-kept in sync rather than sharing one definition.
    type: Literal["whoosh", "bass_drop", "pop", "cash", "shutter"]
    time: float = Field(ge=0)
    # Word.index this marker was dropped on, if any (the "FOR THIS MOMENT"
    # per-word SFX row) - purely informational, doesn't change how it's used.
    word_index: int | None = None


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
    # Template style variant (Rock/Glow/Swiss/Clean) - applied in both the
    # editor preview (CaptionStudio.jsx) and the export (_write_ass's
    # VARIANTS table: font family + outline/shadow/blur standing in for
    # text-stroke/box-shadow, and the Emphasize accent color).
    variant: str | None = None
    # Which script each word displays as: "roman" is word.text (the GPT
    # Hinglish romanization); "native" is word.original (Sarvam's own
    # Devanagari-script recognition, when the source speech was Hindi/mixed -
    # see caption_ai.py's convert_to_hinglish). Affects the editor canvas,
    # the Timeline labels, and both exports (_write_ass/_write_srt).
    script_mode: Literal["roman", "native"] = "roman"
    # Two independent, project-wide typography controls, separate from
    # theme/variant: "clean" is the default soft text-shadow glow with no
    # hard border (matches the editor preview); "outlined" is a bold black
    # outline + offset shadow, no blur (the look most caption apps default
    # to). Only affects captions with no variant selected - a variant's own
    # outline/shadow design (e.g. Rock's hard outline) always takes
    # priority, since that's a more specific, deliberate choice.
    caption_style: Literal["clean", "outlined"] = "clean"
    bold: bool = True
    italic: bool = False


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
                word["font_size"] = 76 if word["important"] else 66
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
                   "brightness": 0, "contrast": 100, "saturation": 100, "render_quality": "high", "elements": [], "sfx_markers": [], "variant": None, "script_mode": "roman",
                   "caption_style": "clean", "bold": True, "italic": False,
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
                  "variant": payload.variant, "script_mode": payload.script_mode,
                  "caption_style": payload.caption_style, "bold": payload.bold, "italic": payload.italic,
                  "updated_at": datetime.now(timezone.utc).isoformat()}})
    if not result.matched_count:
        raise HTTPException(404, "Project not found")
    return {"status": "saved"}


@projects_router.get("/projects/{project_id}/srt")
async def export_srt(project_id: str, request: Request, user=Depends(current_user)):
    project = await request.app.state.db.projects.find_one(
        {"project_id": project_id, "user_id": user["user_id"]}, {"_id": 0, "words": 1, "script_mode": 1})
    if not project:
        raise HTTPException(404, "Project not found")
    if not project.get("words"):
        raise HTTPException(422, "No captions to export yet")
    srt = _write_srt(project["words"], project.get("script_mode", "roman"))
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
            word["font_size"] = 76 if word["important"] else 66
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
    onto the start of the next.

    A word's own new_caption overrides all of the above: True always starts
    a new group right at that word (a manual "Split" edit), False always
    keeps it in the previous group (a manual "Merge" edit) even past
    max_words/max_gap/sentence-end - the same tri-state pattern new_line
    uses one level down, for caption boundaries instead of line wraps."""
    groups = []
    index = 0
    total = len(words)
    while index < total:
        group = [words[index]]
        group_end = words[index]["end"]
        next_index = index + 1
        while next_index < total:
            nxt = words[next_index]
            forced_split = nxt.get("new_caption") is True
            forced_merge = nxt.get("new_caption") is False
            if forced_split:
                break
            if not forced_merge and not (len(group) < max_words and not _ends_sentence(group[-1])
                  and nxt["start"] - group_end < max_gap
                  and (strict_count or group_end - words[index]["start"] < min_display)):
                break
            group.append(nxt)
            group_end = nxt["end"]
            next_index += 1
        groups.append(group)
        index = next_index
    return groups


# Alignment (ASS \an numpad values) and vertical margin for each position
# preset. "middle" ignores MarginV (ASS vertically centers regardless).
# Mirrors CaptionStudio.jsx's POSITION_DEFAULTS exactly (percentages of the
# 1080x1920 canvas) - the point the whole caption block (every row of it) is
# centered on, same as the preview's `top:${boxY}%; transform:translate(-50%,-50%)`.
POSITION_DEFAULTS = {"top": (50, 14), "middle": (50, 50), "bottom": (50, 80)}
# Matches .caption-overlay's CSS line-height:1.25 and gap:2px - used to stack
# a multi-row caption's lines tightly, growing evenly in both directions
# from the block's own center, instead of libass's own (much taller) default
# inter-line spacing for a `\N` break, which is what produced the oversized
# gap between lines that the single-Dialogue-with-\N approach had. Kept
# tight (not the 1.25 this briefly was) because row height already scales
# with each row's own tallest word - a row holding an emphasized/bigger
# word was getting a proportionally huge extra margin on top of its own
# bigger font, which is what actually produced the "massive gap" between
# lines of very different sizes. 1.1 still leaves a little headroom for
# Devanagari matras (ि, े, ै, ं) without that compounding effect.
LINE_HEIGHT = 1.1
ROW_GAP_PX = 2
# "Active word" pop timing/scale - mirrors .caption-overlay span.active's
# transform:scale(1.1) plus its brighter glow, animated in and back out
# over the word's own speaking window via ASS \t() transform tags.
POP_IN_MS = 120
POP_OUT_MS = 150
POP_SCALE = 112
POP_BLUR_BOOST = 3


def _group_center(group, caption_position):
    """A group carries a manual pos_x/pos_y (dragged, or set from the
    Transform panel's Position sliders) on its first word if the user has
    placed this exact caption - otherwise fall back to the project's
    position preset."""
    anchor = group[0]
    pos_x, pos_y = anchor.get("pos_x"), anchor.get("pos_y")
    if pos_x is None or pos_y is None:
        pos_x, pos_y = POSITION_DEFAULTS.get(caption_position, POSITION_DEFAULTS["bottom"])
    return round(pos_x / 100 * 1080), round(pos_y / 100 * 1920)


def _group_rotation(group):
    """The Transform panel's Rotation slider, set per-caption on the
    group's anchor (first) word - None/0 means no rotation."""
    return group[0].get("rotation") or 0


def _group_line_height(group):
    """The Transform panel's Line Height slider, set per-caption on the
    group's anchor (first) word - None means "use the project default"
    (LINE_HEIGHT), same multiplier App.css's .caption-overlay falls back
    to in the preview."""
    return group[0].get("line_height") or LINE_HEIGHT


def _split_rows(group, breaks):
    rows = [[]]
    for index, word in enumerate(group):
        if index > 0 and breaks[index]:
            rows.append([])
        rows[-1].append(word)
    return rows


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
    font size/color. Draw order relative to the caption text (Layer 0) is
    standard z-index staging only - there's no video matting/segmentation
    here, so "behind" sits behind the captions, not behind an actual person
    in the footage. A sticker glyph relies on fontconfig's own fallback to
    find a font that covers it (the project's chosen caption font usually
    doesn't); a text layer instead honors its own explicit font choice."""
    safe = (element.get("char") or "").replace("{", "").replace("}", "")
    x_px = round(element.get("pos_x", 50) / 100 * 1080)
    y_px = round(element.get("pos_y", 30) / 100 * 1920)
    # Matches .element-overlay's CSS text-shadow (0 2px 6px rgba(0,0,0,.7))
    # rather than inheriting the Style line's own Outline/Shadow - elements
    # have no per-theme/variant border of their own, so without this they'd
    # pick up whatever the Style line happens to default to.
    tags = f"\\an5\\pos({x_px},{y_px})\\fs{element.get('font_size', 120)}\\c{_ass_color(element.get('color', '#FFFFFF'))}\\bord0\\shad2\\blur3"
    if element.get("kind") == "text":
        family = FONTS.get(element.get("font_id", "poppins"), FONTS["poppins"])["family"]
        tags = f"\\fn{family}" + tags
    layer = -1 if element.get("layer") == "behind" else 2
    return (f"Dialogue: {layer},{_ass_time(element['start'])},{_ass_time(element['end'])},"
            f"Default,,0,0,0,,{{{tags}}}{safe}\n")


def _write_ass(path, words, theme, font_id="poppins", words_per_caption=None,
               caption_lines=1, caption_position="bottom", elements=None, variant=None,
               script_mode="roman", caption_style="clean", bold=True, italic=False):
    palette = THEMES.get(theme, THEMES["viral"])
    primary_family = FONTS.get(font_id, FONTS["poppins"])["family"]
    tiers = palette.get("tiers")
    accent_family = palette.get("accent_font") or primary_family
    variant_config = VARIANTS.get(variant)
    # Outline/Shadow are 0 here deliberately - the live editor preview
    # (CaptionStudio.jsx's .caption-overlay) never shows a hard border by
    # default, only a soft text-shadow glow. Baking a global Outline/Shadow
    # into the Style line would apply a heavy black border to every word
    # that doesn't explicitly override it, which doesn't match the preview
    # at all. Each word below gets its own explicit \\bord/\\shad/\\blur
    # tag instead, so the export can replicate that same soft-glow look
    # (or a variant's own distinct outline) exactly, word by word.
    # Bold is NOT forced here at the Style level any more - see
    # BOLD_CAPABLE_FONTS above. word_tags() below applies \b1 per word,
    # only for a family that can actually back it up with a real face.
    italic_field = -1 if italic else 0
    header = f"""[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,{primary_family},52,&H00FFFFFF,&H00007AFF,&H00000000,&H80000000,0,{italic_field},0,0,100,100,0,0,1,0,0,2,70,70,210,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"""
    lines = [header]
    groups = _group_words_for_display(words, max_words=words_per_caption or 3,
                                      strict_count=words_per_caption is not None)
    for group in groups:
        center_x, center_y = _group_center(group, caption_position)
        rotation = _group_rotation(group)
        line_height = _group_line_height(group)
        breaks = _resolve_line_breaks(group, tiers, caption_lines)
        rows = _split_rows(group, breaks)

        def word_tags(word, display_text):
            if variant_config:
                family = variant_config["font"]
            elif tiers:
                tier = word["emphasis"] if word.get("emphasis") in tiers else "support"
                family = tiers[tier]["font"]
            else:
                family = accent_family if word.get("important") else primary_family
            # Glyph coverage overrides style choice - but only when it has
            # to: most of the Latin display fonts above can't render
            # Devanagari at all, so when the native script is actually
            # showing (word.original, not a Romanized fallback), force the
            # fallback font that covers it UNLESS the family already chosen
            # (a Hindi template's own font, e.g. Baloo 2/Hind/Mukta/Rozha
            # One/Yatra One/Tiro Devanagari Hindi) already has real
            # Devanagari glyphs of its own - forcing the fallback on top of
            # those would silently throw away the whole point of a
            # dedicated Hindi template the moment native script is shown.
            if _has_devanagari(display_text) and family not in DEVANAGARI_CAPABLE_FONTS:
                family = DEVANAGARI_FONT
            color = word.get("color", "#FFFFFF")
            font_size = word.get("font_size", 52)
            # "FOR THIS MOMENT" Emphasize toggle: a fixed accent highlight
            # (the active variant's accent, or a default yellow with none
            # selected) plus a size bump - mirrors App.css's
            # .emphasize-accent rule and its var(--variant-accent) hookup.
            if word.get("emphasize"):
                color = (variant_config or {}).get("accent", DEFAULT_EMPHASIZE_ACCENT)
                font_size = round(font_size * 1.18)
            # \fscx100\fscy100 is set explicitly (not just as a \t() target)
            # so each word starts its own animation from a clean baseline -
            # override tags otherwise carry forward onto the next word's
            # text run within the same Dialogue line, which would let one
            # word's still-finishing pop bleed into the next word's.
            tags = f"\\fn{family}\\c{_ass_color(color)}\\fs{font_size}\\fscx100\\fscy100"
            if bold and family in BOLD_CAPABLE_FONTS:
                tags += "\\b1"
            if variant_config:
                outline_hex = variant_config["outline"] or color
                base_blur = variant_config["blur"]
                tags += (f"\\3c{_ass_color(outline_hex)}\\bord{variant_config['bord']}"
                         f"\\shad{variant_config['shad']}\\blur{base_blur}")
            elif caption_style == "outlined":
                # User-chosen "Outlined" text style: a bold black outline +
                # offset shadow, no blur - the classic hard-bordered caption
                # look, independent of theme/variant.
                base_blur = 0
                tags += f"\\3c&H000000&\\bord3\\shad2\\blur{base_blur}"
            else:
                # Default "Clean" text style: match the editor preview's
                # default look exactly - a soft black glow around the text
                # (CSS text-shadow), never a hard outline. A small \bord
                # blurred into a halo (rather than a directional \shad) is
                # the ASS equivalent of a soft shadow that surrounds the
                # glyph on every side, same as the CSS.
                base_blur = 4
                tags += f"\\3c&H000000&\\bord2\\shad0\\blur{base_blur}"
            # "Active word" pop: CaptionStudio.jsx's .caption-overlay
            # span.active scales the word up 1.1x and brightens its glow
            # for exactly as long as it's the word currently being spoken.
            # The export has no live playhead to key off of, but each word
            # already carries its own [start,end] - animate the same pop in
            # and back out over that word's own window, relative to this
            # Dialogue line's own start time (libass \t() transform tags are
            # always relative, not absolute clip time).
            rel_on = max(0, round((word["start"] - group[0]["start"]) * 1000))
            rel_off = max(rel_on + 1, round((word["end"] - group[0]["start"]) * 1000))
            pop_in_end = min(rel_off, rel_on + POP_IN_MS)
            pop_out_start = max(pop_in_end, rel_off - POP_OUT_MS)
            tags += (f"\\t({rel_on},{pop_in_end},\\fscx{POP_SCALE}\\fscy{POP_SCALE}\\blur{base_blur + POP_BLUR_BOOST})"
                     f"\\t({pop_out_start},{rel_off},\\fscx100\\fscy100\\blur{base_blur})")
            return tags, font_size

        # Each row's height is driven by its own tallest word (after any
        # emphasize size bump), scaled by the same line-height the preview
        # uses - so a multi-row caption's rows stack tightly and grow evenly
        # from the block's own center, the same way the preview's flex
        # column layout does, instead of libass's own (much taller) default
        # spacing for a `\N`-joined line.
        row_heights = []
        for row in rows:
            sizes = [word_tags(word, (word.get("original") or word["text"])
                                if script_mode == "native" else word["text"])[1] for word in row]
            row_heights.append(max(sizes, default=52) * line_height)
        # Each row boundary can carry its own gap (the word starting row i+1's
        # own gap_before) instead of one uniform ROW_GAP_PX for the whole
        # block - lets e.g. the gap between the bottom two lines differ from
        # the gap between the top two.
        # `or` would silently discard an explicit gap_before=0 (0 is falsy
        # in Python) and fall back to ROW_GAP_PX anyway - an "is not None"
        # check is what pos_x/pos_y already correctly use one function up
        # (_group_center) for the same "None means unset" convention.
        row_gaps = [rows[i + 1][0].get("gap_before") if rows[i + 1][0].get("gap_before") is not None else ROW_GAP_PX
                    for i in range(len(rows) - 1)]
        total_height = sum(row_heights) + sum(row_gaps)
        row_top = center_y - total_height / 2

        cumulative = 0.0
        for row_index, row in enumerate(rows):
            row_center_y = round(row_top + cumulative + row_heights[row_index] / 2)
            cumulative += row_heights[row_index] + (row_gaps[row_index] if row_index < len(row_gaps) else 0)
            word_parts = []
            for index, word in enumerate(row):
                display_text = (word.get("original") or word["text"]) if script_mode == "native" else word["text"]
                safe = display_text.replace("{", "").replace("}", "")
                tags, _ = word_tags(word, display_text)
                if index == 0:
                    # \org pins the rotation pivot to the whole caption
                    # block's own center (not this row's own \pos) so a
                    # multi-row caption rotates as one rigid block instead
                    # of each row spinning independently around itself.
                    frz = f"\\org({center_x},{center_y})\\frz{rotation:g}" if rotation else ""
                    tags = f"\\an5\\pos({center_x},{row_center_y}){frz}" + tags
                separator = " " if index > 0 else ""
                word_parts.append(f"{separator}{{{tags}}}{safe}")
            styled = "".join(word_parts)
            lines.append(f"Dialogue: 0,{_ass_time(group[0]['start'])},{_ass_time(group[-1]['end'])},"
                         f"Default,,0,0,0,,{styled}\n")
    for element in (elements or []):
        if element["end"] > element["start"]:
            lines.append(_write_element_dialogue(element))
    Path(path).write_text("".join(lines), encoding="utf-8")


def _srt_time(seconds):
    hours = int(seconds // 3600); minutes = int((seconds % 3600) // 60); secs = seconds % 60
    millis = int(round((secs - int(secs)) * 1000))
    return f"{hours:02d}:{minutes:02d}:{int(secs):02d},{millis:03d}"


def _write_srt(words, script_mode="roman"):
    lines = []
    for index, word in enumerate(words, start=1):
        text = (word.get("original") or word["text"]) if script_mode == "native" else word["text"]
        lines.append(f"{index}\n{_srt_time(word['start'])} --> {_srt_time(word['end'])}\n{text}\n")
    return "\n".join(lines)


def _escape_filter_path(path):
    """ffmpeg's filtergraph syntax splits options on ':' and uses '\\' to
    escape characters, so a raw Windows path (drive-letter colon, backslash
    separators) has to be escaped before it can be embedded as a filter
    option value - otherwise the drive letter's colon gets parsed as the
    end of the filename argument."""
    return Path(path).as_posix().replace(":", r"\:")


RENDER_QUALITY_PRESETS = {
    # "high" is close to visually lossless; "medium" (not libx264's "slow")
    # keeps that same CRF - so still very high quality - while encoding
    # meaningfully faster, since "slow" could make a real-length export
    # take long enough to feel hung with no progress indicator in the UI.
    # "draft" trades quality for a much faster encode when you just want to
    # sanity-check timing/styling before spending the time on a full export.
    "high": {"preset": "medium", "crf": "17"},
    "draft": {"preset": "veryfast", "crf": "26"},
}
# Hard ceiling on how long a single ffmpeg render may run. Without this, a
# genuinely stuck/runaway ffmpeg process (a corrupt source file, a pathological
# filter graph, a platform-specific encoder quirk) hangs the render request
# forever - the backend never responds, so the editor's "Exporting..." button
# never recovers either. A clear timeout error beats an infinite spinner.
RENDER_TIMEOUT_SECONDS = 300

# Mirrors frontend/src/lib/sfx.js's placeholder sounds - there's no
# licensed SFX audio bundled (every free/CC0 sample host tried from this
# sandbox - Freesound, Pixabay, Mixkit, Zapsplat, SoundBible, OpenGameArt -
# is blocked by the outbound proxy policy here), so the export gets a
# synthesized stand-in for each type instead of the marker having no
# audible effect at all in the final video. whoosh/pop/shutter are
# fundamentally noisy, transient sounds (air movement, a sharp impact) -
# synthesizing them as a pure tone sweep (the original approach) reads as
# a generic "beep" no matter the frequency, so those three are built from
# filtered white noise instead; bass_drop (a real pitch-dropping sine, same
# technique real trailer bass drops use) and cash (two short bell tones,
# like a cash register's two-note "cha-ching") stay tone-based since that
# genuinely is the right synthesis technique for what they're imitating.
def _tone_burst(freq, duration, attack=0.01, decay=6):
    """A single sine tone with a fast attack + exponential decay envelope -
    the building block for bass_drop's sweep and cash's two chime notes."""
    phase = f"2*PI*{freq}*t"
    envelope = f"if(lt(t,{attack}),t/{attack},exp(-{decay}*(t-{attack})/{duration}))"
    return f"({envelope})*sin({phase})"


def _sfx_source_filter(sfx_type, label):
    """A standalone ffmpeg lavfi filter chain (no -i input needed) that
    synthesizes one SFX marker's placeholder sound, ending in output pad
    [{label}] so the caller (_sfx_mix_filters) can pipe it into its own
    pan/delay/volume stage same as before. Any internal sub-labels are
    namespaced off `label` so multiple markers of the same type in one
    project never collide on a shared pad name."""
    if sfx_type == "whoosh":
        # Band-limited noise instead of a tone sweep - air-movement texture,
        # not a pitch. A moderate, fairly wide band gives it an "airy"
        # broadband character; the long-ish decay is what reads as "whoosh"
        # rather than a short "swish".
        return (f"anoisesrc=d=0.3:c=white:r=44100:a=0.6,"
                f"bandpass=f=1100:width_type=h:w=900,"
                f"afade=t=in:d=0.02,afade=t=out:st=0.08:d=0.22:curve=exp,"
                f"volume=1.3[{label}]")
    if sfx_type == "pop":
        # A quick noise burst through a higher band - a sharp transient
        # "pop"/bubble sound, not a held note.
        return (f"anoisesrc=d=0.08:c=white:r=44100:a=0.5,"
                f"bandpass=f=2200:width_type=h:w=1800,"
                f"afade=t=in:d=0.002,afade=t=out:st=0.012:d=0.068:curve=exp,"
                f"volume=1.6[{label}]")
    if sfx_type == "shutter":
        # A very short, bright noise click - a camera shutter's mechanical
        # snap reads as broadband high-frequency energy, not a tone at all.
        return (f"anoisesrc=d=0.05:c=white:r=44100:a=0.5,"
                f"highpass=f=3500,"
                f"afade=t=in:d=0.001,afade=t=out:st=0.006:d=0.044:curve=exp,"
                f"volume=1.3[{label}]")
    if sfx_type == "cash":
        # Two short bell-like notes a fifth apart, the second landing ~70ms
        # after the first - the classic two-note "cha-ching" shape, instead
        # of one continuous ascending sweep.
        note_a, note_b = f"{label}_a", f"{label}_b"
        return (f"aevalsrc=exprs='{_tone_burst(880, 0.15)}':s=44100:d=0.15[{note_a}];"
                f"aevalsrc=exprs='{_tone_burst(1320, 0.15)}':s=44100:d=0.15[{note_b}];"
                f"[{note_b}]adelay=70|70[{note_b}d];"
                f"[{note_a}][{note_b}d]amix=inputs=2:duration=longest:normalize=0,"
                f"volume=0.6[{label}]")
    # bass_drop (and any unrecognized type, as the previous default was):
    # a sine dropping from 90Hz to 27Hz, the same technique real trailer/
    # EDM bass drops use - asoftclip adds a bit of harmonic saturation so
    # it has some weight instead of sounding like a thin, clean sine.
    phase = "2*PI*(90+(27-90)*min(t/0.4,1))*t"
    envelope = "if(lt(t,0.015),t/0.015,exp(-5*(t-0.015)/0.24))"
    return (f"aevalsrc=exprs='({envelope})*sin({phase})':s=44100:d=0.4,"
            f"asoftclip=type=tanh:param=0.7,volume=1.3[{label}]")


def _sfx_mix_filters(sfx_markers):
    """Builds the filter_complex lines for every SFX marker - its synthesized
    tone, panned to stereo and delayed to its exact timestamp - plus the
    list of labels to mix in. Returns ([], []) for no markers, so a project
    without any SFX keeps using the original, simpler filter graph untouched."""
    lines, labels = [], []
    for index, marker in enumerate(sfx_markers):
        src_label, out_label = f"sfxsrc{index}", f"sfx{index}"
        lines.append(_sfx_source_filter(marker.get("type", "pop"), src_label))
        delay_ms = max(0, round(marker.get("time", 0) * 1000))
        lines.append(f"[{src_label}]pan=stereo|c0=c0|c1=c0,adelay={delay_ms}|{delay_ms},volume=0.7[{out_label}]")
        labels.append(out_label)
    return lines, labels


def _render(source, ass_path, output, fonts_dir, audio_volume=100, audio_muted=False,
           brightness=0, contrast=100, saturation=100, quality="high", sfx_markers=None):
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
    common_args = ["-c:v", "libx264", "-preset", render_preset["preset"], "-crf", render_preset["crf"],
                   "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output]

    sfx_lines, sfx_labels = _sfx_mix_filters(sfx_markers or [])
    if sfx_labels:
        # SFX are a separate accent layer, not competing with the dialogue
        # for headroom - normalize=0 keeps amix from auto-attenuating every
        # input by 1/N, so the main audio stays at its own authored volume
        # and only the SFX branches carry their own (lower) mix volume.
        mix_inputs = "".join(f"[{label}]" for label in ["main_a", *sfx_labels])
        filter_complex = (
            f"[0:v]{video_filter}[vout];[0:a]volume={volume}[main_a];"
            + ";".join(sfx_lines) + ";"
            + f"{mix_inputs}amix=inputs={1 + len(sfx_labels)}:duration=first:dropout_transition=0:normalize=0[aout]"
        )
        args = [FFMPEG, "-y", "-i", source, "-filter_complex", filter_complex,
                "-map", "[vout]", "-map", "[aout]", *common_args]
    else:
        args = [FFMPEG, "-y", "-i", source, "-vf", video_filter, "-af", f"volume={volume}", *common_args]

    try:
        result = subprocess.run(args, capture_output=True, text=True, cwd=work_dir,
                                timeout=RENDER_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        logger.error("FFmpeg render timed out after %ss: %s", RENDER_TIMEOUT_SECONDS, " ".join(args))
        raise RuntimeError(
            f"Rendering took longer than {RENDER_TIMEOUT_SECONDS}s and was stopped. "
            "Try a shorter clip, or Draft quality for a faster export."
        ) from exc
    if result.returncode:
        logger.error("FFmpeg render failed (exit %s): %s", result.returncode, result.stderr[-2000:])
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
                  project.get("caption_position", "bottom"), project.get("elements"),
                  variant=project.get("variant"), script_mode=project.get("script_mode", "roman"),
                  caption_style=project.get("caption_style", "clean"), bold=project.get("bold", True),
                  italic=project.get("italic", False))
        try:
            await asyncio.to_thread(_render, source, ass, output, str(FONTS_DIR),
                                    project.get("audio_volume", 100), project.get("audio_muted", False),
                                    project.get("brightness", 0), project.get("contrast", 100),
                                    project.get("saturation", 100), project.get("render_quality", "high"),
                                    sfx_markers=project.get("sfx_markers", []))
        except RuntimeError as exc:
            # Our own _render() raises RuntimeError with a message that's
            # already safe and useful to show the user directly (a timeout,
            # or "FFmpeg could not render this video") - surface it instead
            # of a generic message, so a stuck export is distinguishable
            # from any other failure.
            raise HTTPException(500, str(exc)) from exc
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