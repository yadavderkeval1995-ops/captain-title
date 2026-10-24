"""Standalone diagnostic: run the real transcription pipeline on a video and
print every resulting caption word, flagging any that look like several
spoken words glued into one (the bug the Sarvam-merge fix targets). Lets you
verify the fix directly against a real clip without going through the UI.

Usage:
    python check_merge_fix.py path\\to\\video.mp4
"""
import argparse
import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import caption_ai  # noqa: E402 (must come after load_dotenv so API keys are set)


LONG_WORD_CHARS = 9  # same heuristic threshold as _detect_merged_matches


async def main(video_path: str, speech_language: str):
    print(f"Transcribing {video_path} ...\n")
    words, diagnostics = await caption_ai.transcribe_words(video_path, speech_language)
    print(f"diagnostics: {diagnostics}\n")
    words = await caption_ai.convert_to_hinglish(words)

    flagged = 0
    for word in words:
        is_long = len(word["text"]) >= LONG_WORD_CHARS or len(word["original"]) >= LONG_WORD_CHARS
        marker = "  <-- CHECK (looks like it could be multiple merged words)" if is_long else ""
        if is_long:
            flagged += 1
        print(f"{word['index']:>3}  {word['start']:6.2f}-{word['end']:6.2f}  "
              f"text={word['text']!r:28} original={word['original']!r}{marker}")

    print(f"\n{len(words)} words total, {flagged} flagged for manual review.")
    if flagged == 0:
        print("No suspiciously long words found - looks clean.")
    else:
        print("Check each flagged word above: if it reads as a real single long word, it's fine.")
        print("If it reads as multiple words with no space ('harcheezpekaam'), the merge is still happening.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", help="Path to an MP4/MOV video file")
    parser.add_argument("--language", default="auto", choices=["auto", "hi"], help="speech_language (default: auto)")
    args = parser.parse_args()
    if not Path(args.video).exists():
        print(f"File not found: {args.video}", file=sys.stderr)
        sys.exit(1)
    asyncio.run(main(args.video, args.language))
