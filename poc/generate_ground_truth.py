"""POC ground-truth generator. Calls the REAL, unmodified production
captions.py functions directly (no API/auth layer) to produce an exact
copy of what the production export pipeline generates for a Street Glow
project: the .ass files (main + shadow/glow masks), and the final burned
MP4. This is the reference everything else in this POC gets compared
against. Does not modify any backend file.

Usage: python3 generate_ground_truth.py
"""
import sys
import os
import shutil
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import captions  # noqa: E402

POC_DIR = Path(__file__).parent
OUT_DIR = POC_DIR / "ground_truth"
OUT_DIR.mkdir(exist_ok=True)

SOURCE_VIDEO_720 = (Path(__file__).parent / ".." / "backend" / "storage_data" / "captain-title" / "uploads"
                     / "user_556b1b843dee" / "c0e2c86bfd5d422c8144cdc07ab62a53.mp4").resolve()
# _render's filter_complex sizes the glow/shadow mask canvases to video_width
# x video_height but never itself resizes the source video stream to match -
# a 720x1280 source with video_width/height=1080x1920 would silently
# misalign the composited layers (a POC harness artifact, not a real app
# bug: production's uploaded video and its project.width/height already
# agree). Scaling the real test source up to the exact target resolution
# first keeps this an apples-to-apples full-resolution comparison.
SOURCE_VIDEO = OUT_DIR / "source_1080x1920.mp4"
import subprocess
subprocess.run([str(captions.FFMPEG), "-y", "-v", "error", "-i", str(SOURCE_VIDEO_720),
                "-vf", "scale=1080:1920", "-c:v", "libx264", "-crf", "18", "-c:a", "aac",
                str(SOURCE_VIDEO)], check=True)

# Realistic Hinglish word timing (same phrase used earlier this session to
# verify the grouping/spacing fixes) - two Street Glow lines' worth of
# words so both line1 (pop + glow) and line2 (slide-glide + shadow) are
# exercised, with animation still in progress at some of the comparison
# timestamps below (checking mid-animation frames, not just settled ones).
RAW_WORDS = ["jab", "aap", "practice", "mein", "hain", "tab", "aap", "har", "cheez", "pe", "kaam", "karein"]
words = []
t = 0.4
for i, text in enumerate(RAW_WORDS):
    start = t
    end = t + 0.34
    words.append({"index": i, "text": text, "original": text, "start": round(start, 3), "end": round(end, 3),
                  "emphasis": "support", "new_line": None, "pos_x": None, "pos_y": None})
    t = end + 0.03

captions._apply_theme_defaults(words, "street_glow")

ass_path = str(OUT_DIR / "captions.ass")
shadow_alpha = str(OUT_DIR / "shadow_alpha.ass")
shadow_color = str(OUT_DIR / "shadow_color.ass")
glow_alpha = str(OUT_DIR / "glow_alpha.ass")
glow_color = str(OUT_DIR / "glow_color.ass")

captions._write_ass(
    ass_path, words, "street_glow", "poppins",
    words_per_caption=None, caption_lines=1, caption_position="bottom",
    elements=None, script_mode="roman", bold=True, italic=False,
    outline_enabled=False, outline_width=2, outline_color="#000000",
    shadow_enabled=True, shadow_angle=0, shadow_distance=2,
    shadow_blur=captions.STREET_GLOW_SHADOW_BLUR, shadow_opacity=0.5, shadow_color="#000000",
    glow_enabled=False, glow_color=None, glow_blur=captions.STREET_GLOW_GLOW_BLUR, glow_opacity=0.6,
    background_enabled=False, background_color="#000000", background_opacity=0.6,
    shadow_alpha_path=shadow_alpha, shadow_color_path=shadow_color,
    glow_alpha_path=glow_alpha, glow_color_path=glow_color,
)
print("Wrote ASS files:")
for p in [ass_path, shadow_alpha, shadow_color, glow_alpha, glow_color]:
    print(" ", p, "exists" if os.path.exists(p) else "MISSING")

output_mp4 = str(OUT_DIR / "export.mp4")
captions._render(
    str(SOURCE_VIDEO), ass_path, output_mp4, str(captions.FONTS_DIR),
    audio_volume=100, audio_muted=False, brightness=0, contrast=100, saturation=100,
    quality="high", sfx_markers=[],
    shadow_alpha_path=shadow_alpha, shadow_color_path=shadow_color, shadow_blur=captions.STREET_GLOW_SHADOW_BLUR,
    glow_alpha_path=glow_alpha, glow_color_path=glow_color, glow_blur=captions.STREET_GLOW_GLOW_BLUR,
    video_width=1080, video_height=1920,
)
print("Wrote", output_mp4)

# Also copy the bundled fonts + source video into the POC dir so the
# browser-side prototype can load the IDENTICAL font files and source
# footage the export used (requirement #3: identical font files).
fonts_out = OUT_DIR / "fonts"
if fonts_out.exists():
    shutil.rmtree(fonts_out)
shutil.copytree(captions.FONTS_DIR, fonts_out)
shutil.copy(SOURCE_VIDEO, OUT_DIR / "source.mp4")

import json
with open(OUT_DIR / "words.json", "w") as f:
    json.dump(words, f, indent=2)
print("Done. Ground truth assets in", OUT_DIR)
