"""Audio helpers: WAV duration, pause detection and pause-snapped chunking
with priming audio, sized for each provider's per-request limit."""
import re
import subprocess
import wave
from pathlib import Path

import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def _wav_duration(path: str) -> float:
    with wave.open(path, "rb") as wav:
        return wav.getnframes() / float(wav.getframerate())


def _silence_midpoints(audio_path: str, noise_db: int = -35, min_gap: float = 0.3):
    """Timestamps of natural pauses in the audio, for cutting chunks without slicing through a word."""
    result = subprocess.run([FFMPEG, "-i", audio_path, "-af", f"silencedetect=noise={noise_db}dB:d={min_gap}",
                             "-f", "null", "-"], capture_output=True, text=True)
    starts = [float(value) for value in re.findall(r"silence_start:\s*([\d.]+)", result.stderr)]
    ends = [float(value) for value in re.findall(r"silence_end:\s*([\d.]+)", result.stderr)]
    return [(start + end) / 2 for start, end in zip(starts, ends)]


def _chunk_boundaries(total_duration: float, silence_points: list[float], seconds: int, snap_window: float):
    boundaries = [0.0]
    cursor = 0.0
    while cursor < total_duration:
        target = cursor + seconds
        # Cutting exactly at a fixed interval risks slicing through a word
        # mid-sentence, which both loses that word and resets the timing
        # reference badly. Snap to the nearest real pause instead.
        nearby = [point for point in silence_points
                 if cursor < point <= min(target + snap_window, total_duration)
                 and point >= target - snap_window]
        boundary = min(nearby, key=lambda point: abs(point - target)) if nearby else min(target, total_duration)
        if boundary <= cursor:
            break
        boundaries.append(boundary)
        cursor = boundary
    return boundaries


def _split_wav(audio_path: str, output_dir: str, seconds: int = 20, snap_window: float = 2.0,
               overlap_seconds: float = 1.5):
    # Sarvam's real-time speech-to-text API hard-caps each request at 30
    # seconds of audio. A chunk's worst case is `seconds + snap_window` of
    # content plus up to `overlap_seconds` of priming audio prepended, so
    # these defaults (20 + 2 + 1.5 = 23.5s) leave a solid safety margin.
    # Whisper is prone to fumbling the opening moment of whatever audio
    # buffer it's handed (a known quirk, not specific to this app). The very
    # first chunk gets a silence lead-in to "warm up" before real content
    # starts. Every later chunk instead gets primed with real overlapping
    # audio from the tail of the previous chunk — genuine acoustic context,
    # not just silence — and any words re-recognized from that overlap get
    # dropped by the caller since the previous chunk already produced them.
    lead_in_seconds = 0.5
    silence_points = _silence_midpoints(audio_path)
    with wave.open(audio_path, "rb") as source:
        params = source.getparams()
        total_duration = source.getnframes() / params.framerate
        full_frames = source.readframes(source.getnframes())
    bytes_per_frame = params.sampwidth * params.nchannels

    def frame_slice(start_s, end_s):
        start_frame = max(0, int(round(start_s * params.framerate)))
        end_frame = max(start_frame, int(round(end_s * params.framerate)))
        return full_frames[start_frame * bytes_per_frame:end_frame * bytes_per_frame]

    boundaries = _chunk_boundaries(total_duration, silence_points, seconds, snap_window)
    silence_prefix = b"\x00" * (int(params.framerate * lead_in_seconds) * bytes_per_frame)
    chunks = []
    for index in range(len(boundaries) - 1):
        start, end = boundaries[index], boundaries[index + 1]
        if index == 0:
            prefix, prefix_duration = silence_prefix, lead_in_seconds
        else:
            prefix_start = max(0.0, start - overlap_seconds)
            prefix, prefix_duration = frame_slice(prefix_start, start), start - prefix_start
        path = Path(output_dir) / f"speech-{index}.wav"
        with wave.open(str(path), "wb") as chunk_file:
            chunk_file.setparams(params)
            chunk_file.writeframes(prefix)
            chunk_file.writeframes(frame_slice(start, end))
        chunks.append((str(path), start - prefix_duration, start))
    return chunks
