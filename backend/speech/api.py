"""Speech Service v2: transcription jobs that return a Canonical Transcript,
plus the provider and language catalogs. Runs alongside the v1 project
endpoints, which the current editor keeps using."""
import asyncio
import logging
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from auth import current_user
from speech.canonical import build_canonical
from speech.errors import ProviderAuthError, ProviderUnsupportedError
from speech.languages import LANGUAGE_CODES, LANGUAGES
from speech.pipeline import transcribe
from speech.registry import default_registry

speech_router = APIRouter(prefix="/api/v2", tags=["speech"])
logger = logging.getLogger("tadaaam.speech.api")
MAX_UPLOAD_BYTES = 120 * 1024 * 1024
MAX_SECONDS = 120


def _now():
    return datetime.now(timezone.utc).isoformat()


@speech_router.get("/providers")
async def list_providers():
    registry = default_registry()
    return {"default": registry.routing.get("default"), "providers": registry.describe()}


@speech_router.get("/languages")
async def list_languages():
    return {"languages": LANGUAGES}


@speech_router.post("/transcriptions", status_code=202)
async def create_transcription(request: Request, file: UploadFile = File(...),
                               language: str = Form("auto"), code_mix: bool = Form(True),
                               provider: str | None = Form(None), output_script: str | None = Form(None),
                               tagging: bool = Form(False), user=Depends(current_user)):
    # Late import: captions imports caption_ai, which imports this package.
    from captions import _duration, _extract_audio

    language_code = None if language == "auto" else language
    if language_code is not None and language_code not in LANGUAGE_CODES:
        raise HTTPException(400, f"Unsupported language '{language}'. See GET /api/v2/languages.")
    if output_script is None:
        output_script = "roman" if language_code in {None, "hi"} else "native"
    if output_script not in {"roman", "native"}:
        raise HTTPException(400, "output_script must be 'roman' or 'native'")
    try:
        chosen = default_registry().resolve(language_code, provider or None)
    except ProviderUnsupportedError as exc:
        raise HTTPException(400, str(exc)) from exc
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File must be smaller than 120 MB")

    work_dir = tempfile.mkdtemp(prefix="tadaaam-tx-")
    try:
        source = os.path.join(work_dir, "source" + (Path(file.filename or "audio").suffix.lower() or ".bin"))
        audio = os.path.join(work_dir, "speech.wav")
        Path(source).write_bytes(data)
        try:
            await asyncio.to_thread(_extract_audio, source, audio)
            duration = await asyncio.to_thread(_duration, audio)
        except Exception as exc:
            raise HTTPException(422, "This file has no readable audio") from exc
        if duration > MAX_SECONDS:
            raise HTTPException(422, f"Audio can be at most {MAX_SECONDS} seconds")
    except BaseException:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise

    job = {"job_id": f"tx_{uuid.uuid4().hex[:12]}", "user_id": user["user_id"], "status": "queued",
           "progress": 0, "file_name": file.filename, "duration": duration,
           "request": {"language": language, "code_mix": code_mix, "provider": chosen.capabilities.id,
                       "output_script": output_script, "tagging": tagging},
           "result": None, "error_message": None, "created_at": _now(), "updated_at": _now()}
    db = request.app.state.db
    await db.transcriptions.insert_one(job.copy())
    asyncio.create_task(_run_transcription(db, job, audio, work_dir))
    return {"job_id": job["job_id"], "status": "queued", "provider": chosen.capabilities.id}


@speech_router.get("/transcriptions/{job_id}")
async def get_transcription(job_id: str, request: Request, user=Depends(current_user)):
    job = await request.app.state.db.transcriptions.find_one(
        {"job_id": job_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not job:
        raise HTTPException(404, "Transcription not found")
    return job


async def _run_transcription(db, job: dict, audio: str, work_dir: str):
    from caption_ai import convert_to_hinglish

    job_id, options = job["job_id"], job["request"]

    async def update(**fields):
        await db.transcriptions.update_one({"job_id": job_id}, {"$set": {**fields, "updated_at": _now()}})

    async def on_progress(done: int, total: int):
        await update(status="processing", progress=5 + int(80 * done / max(1, total)))

    try:
        await update(status="processing", progress=5)
        language = None if options["language"] == "auto" else options["language"]
        words, diagnostics = await transcribe(audio, language, options["code_mix"], options["provider"],
                                              on_progress=on_progress)
        if options["tagging"]:
            await update(progress=88)
            words = await convert_to_hinglish(words, job.get("file_name") or "")
        transcript = build_canonical(words, diagnostics, requested_language=options["language"],
                                     code_mix=options["code_mix"], output_script=options["output_script"],
                                     job_id=job_id, model=os.environ.get("SARVAM_STT_MODEL", "saaras:v4")
                                     if diagnostics["provider"] in {"sarvam", "hybrid"} else None)
        await update(status="ready", progress=100, result=transcript.model_dump(by_alias=True))
    except Exception as exc:
        logger.exception("Transcription job %s failed", job_id)
        if isinstance(exc, ProviderAuthError):
            message = str(exc)
        elif "trustworthy transcript" in str(exc).lower():
            message = "No trustworthy transcript was found. Try clearer speech or less background music."
        else:
            message = "Transcription could not finish."
        await update(status="failed", progress=100, error_message=message)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


async def fail_interrupted_transcriptions(db):
    """Jobs hold their audio in a temp dir, so a backend restart can't resume them."""
    await db.transcriptions.update_many(
        {"status": {"$in": ["queued", "processing"]}},
        {"$set": {"status": "failed", "error_message": "The backend restarted during this job. Submit it again.",
                  "updated_at": _now()}})
