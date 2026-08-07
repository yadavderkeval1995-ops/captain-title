import asyncio
import logging
import os
import tempfile
from pathlib import Path

import imageio_ffmpeg

from caption_ai import transcribe_words
from storage_service import get_object

logger = logging.getLogger("captain-title.audit")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


async def run_transcription_audit():
    key = os.environ.get("TRANSCRIPTION_AUDIT_OBJECT", "").strip()
    if not key:
        return
    try:
        data, _ = await asyncio.to_thread(get_object, key)
        with tempfile.TemporaryDirectory() as temp:
            source = str(Path(temp, "source.mp4"))
            audio = str(Path(temp, "speech.wav"))
            Path(source).write_bytes(data)
            process = await asyncio.create_subprocess_exec(
                FFMPEG, "-y", "-i", source, "-vn", "-ac", "1", "-ar", "16000",
                "-c:a", "pcm_s16le", audio,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
            _, stderr = await process.communicate()
            if process.returncode:
                raise RuntimeError(stderr.decode(errors="replace")[-1200:])
            words, diagnostics = await transcribe_words(audio, "auto")
        logger.warning("TRANSCRIPTION_AUDIT diagnostics=%s", diagnostics)
        logger.warning("TRANSCRIPTION_AUDIT words=%s", " | ".join(
            f"{word['start']:.2f}-{word['end']:.2f}:{word['original']}" for word in words))
    except Exception:
        logger.exception("TRANSCRIPTION_AUDIT failed")
