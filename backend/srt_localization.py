import asyncio
import base64
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

from openai import OpenAI


STYLE_GUIDANCE = {
    "gen-z": "Modern conversational Hindi with selective current Hinglish. Youthful and effortless, never forced or meme-heavy.",
    "cinematic": "Mainstream cinematic Hindi: concise, emotionally precise, memorable, and dramatic without becoming theatrical.",
    "urdu-touch": "Natural spoken Hindi with a restrained Urdu touch: graceful cadence and emotional vocabulary, always clear and scene-appropriate.",
}
TIMECODE = re.compile(r"^(?P<start>\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(?P<end>\d{1,2}:\d{2}:\d{2}[,.]\d{3})")


def _client():
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Missing required environment variable: OPENAI_API_KEY")
    return OpenAI(api_key=key)


def parse_srt(content):
    normalized = content.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        raise ValueError("The English SRT is empty")
    cues = []
    for position, block in enumerate(re.split(r"\n\s*\n", normalized), 1):
        lines = [line.rstrip() for line in block.split("\n")]
        if len(lines) < 3:
            raise ValueError(f"Subtitle block {position} is incomplete")
        try:
            index = int(lines[0].strip())
        except ValueError as exc:
            raise ValueError(f"Subtitle block {position} has an invalid index") from exc
        match = TIMECODE.match(lines[1].strip())
        text = "\n".join(lines[2:]).strip()
        if not match or not text:
            raise ValueError(f"Subtitle block {position} is invalid")
        start = match.group("start").replace(".", ","); end = match.group("end").replace(".", ",")
        cues.append({"index": index, "start": start, "end": end, "text": text})
    if len({cue["index"] for cue in cues}) != len(cues):
        raise ValueError("Subtitle indexes must be unique")
    return cues


def build_srt(cues, translation_key="translated_text"):
    blocks = []
    for cue in cues:
        text = str(cue.get(translation_key, "")).strip()
        if not text:
            raise ValueError(f"Subtitle {cue['index']} has no Hindi translation")
        blocks.append(f"{cue['index']}\n{cue['start']} --> {cue['end']}\n{text}")
    return "\n\n".join(blocks) + "\n"


def _seconds(timecode):
    hours, minutes, rest = timecode.split(":"); seconds, millis = rest.split(",")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def _duration(cue):
    return max(.5, _seconds(cue["end"]) - _seconds(cue["start"]))


def representative_cues(cues, limit=8):
    if len(cues) <= limit:
        return cues
    best_start, best_score = 0, -1
    for start in range(len(cues) - limit + 1):
        window = cues[start:start + limit]; text = " ".join(cue["text"] for cue in window)
        score = min(500, len(text)) + 45 * sum(mark in text for mark in ("?", "!", "…", "..."))
        if score > best_score:
            best_start, best_score = start, score
    return cues[best_start:best_start + limit]


def _extract_frames(video_path, cues, output_dir):
    from imageio_ffmpeg import get_ffmpeg_exe
    ffmpeg = get_ffmpeg_exe(); frames = []
    sample = cues if len(cues) <= 24 else [cues[round(i * (len(cues)-1) / 23)] for i in range(24)]
    for position, cue in enumerate(sample):
        at = (_seconds(cue["start"]) + _seconds(cue["end"])) / 2
        output = Path(output_dir) / f"frame-{position:02d}.jpg"
        result = subprocess.run([ffmpeg, "-y", "-ss", str(at), "-i", video_path, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-q:v", "5", str(output)], capture_output=True)
        if result.returncode == 0 and output.exists():
            frames.append((at, output))
    return frames


def _extract_json(text):
    cleaned = text.strip().replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}|\[[\s\S]*\]", cleaned)
        if not match: raise ValueError("AI returned unreadable JSON")
        return json.loads(match.group(0))


def _scene_context_sync(video_path, cues):
    with tempfile.TemporaryDirectory() as temp:
        frames = _extract_frames(video_path, cues, temp)
        if not frames:
            return {"summary": "", "moments": [], "warnings": ["Video frames could not be analyzed"]}
        content = [{"type": "text", "text": "Analyze these ordered video frames as soft context for Hindi subtitle localization. Describe only visible action, facial emotion, setting, relationships or power dynamics when evident, and tonal shifts. Do not identify people or invent off-screen facts. Return strict JSON: {\"summary\":\"concise story tone\",\"moments\":[{\"time\":number,\"context\":\"visible evidence\",\"confidence\":\"high|medium|low\"}]}"}]
        for time_seconds, path in frames:
            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
            content.extend([{"type": "text", "text": f"Frame at {time_seconds:.2f} seconds"}, {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}", "detail": "low"}}])
        response = _client().chat.completions.create(model=os.environ.get("OPENAI_VISION_MODEL", os.environ.get("OPENAI_TEXT_MODEL", "gpt-4.1")), messages=[{"role": "system", "content": "You are a careful film-scene analyst."}, {"role": "user", "content": content}], max_tokens=1800, temperature=.1)
        payload = _extract_json(response.choices[0].message.content or "")
        return {"summary": str(payload.get("summary", "")), "moments": payload.get("moments", []), "warnings": []}


async def analyze_scene(video_path, cues):
    return await asyncio.to_thread(_scene_context_sync, video_path, cues)


def _cue_payload(cues, scene):
    moments = [item for item in scene.get("moments", []) if item.get("context")]
    output = []
    for cue in cues:
        midpoint = (_seconds(cue["start"]) + _seconds(cue["end"])) / 2
        nearest = min(moments, key=lambda item: abs(float(item.get("time", 0)) - midpoint)) if moments else None
        output.append({"index": cue["index"], "english": cue["text"], "duration_seconds": round(_duration(cue), 2), "max_devanagari_chars": max(12, min(84, round(_duration(cue) * 16))), "visual_context": str(nearest.get("context", ""))[:400] if nearest and abs(float(nearest.get("time", 0)) - midpoint) <= 12 else ""})
    return output


def _styles_sync(cues, scene):
    sample = representative_cues(cues); payload = _cue_payload(sample, scene)
    instructions = "You are an expert Indian subtitle localization editor. English SRT text carries source meaning; video observations are supporting evidence only. Write natural Devanagari Hindi, preserve intent, relationships, pronouns, humor, subtext, and emotional progression, and fit each cue duration. Never invent facts. Return strict JSON."
    prompt = "Create exactly three treatments of the representative scene in this order: gen-z, cinematic, urdu-touch. Each treatment: {style,label,rationale,translations:[{index,translated_text}]}. Preserve every index exactly once.\n" + "\n".join(f"{key}: {value}" for key, value in STYLE_GUIDANCE.items()) + f"\nOverall visible tone: {scene.get('summary','')}\nCUES:\n{json.dumps(payload, ensure_ascii=False)}"
    response = _client().chat.completions.create(model=os.environ.get("OPENAI_TEXT_MODEL", "gpt-4.1"), messages=[{"role":"system","content":instructions},{"role":"user","content":prompt}], max_tokens=2600, temperature=.35)
    samples = _extract_json(response.choices[0].message.content or "")
    if isinstance(samples, dict): samples = samples.get("samples", [])
    expected = ["gen-z", "cinematic", "urdu-touch"]
    if [sample.get("style") for sample in samples] != expected: raise ValueError("Style samples were incomplete")
    indexes = [cue["index"] for cue in sample]
    for item in samples:
        if [entry.get("index") for entry in item.get("translations", [])] != indexes: raise ValueError("A style sample changed subtitle indexes")
    return sample, samples


async def create_style_samples(cues, scene):
    return await asyncio.to_thread(_styles_sync, cues, scene)


def _translate_sync(cues, scene, style, style_brief, project_guide):
    payload = _cue_payload(cues, scene)
    system = "You are an expert Indian subtitle localization editor. Adapt English bridge subtitles into human Devanagari Hindi. Preserve meaning, actions, tense, negation, relationships, names, pronouns, humor, subtext, emotional progression, and recurring character voice. Treat visual context as soft evidence only and never override clear English meaning. Fit exact cue durations by tightening redundancy before meaning. Return strict JSON {translations:[{index,translated_text}]}."
    prompt = f"APPROVED STYLE: {STYLE_GUIDANCE[style]}\nBLEND NOTE: {style_brief or 'none'}\nPROJECT GUIDE: {project_guide or 'Keep terminology, pronouns, and register consistent.'}\nVISIBLE TONE: {scene.get('summary','')}\nTranslate every cue exactly once in order. Do not merge or omit cues.\n{json.dumps(payload, ensure_ascii=False)}"
    response = _client().chat.completions.create(model=os.environ.get("OPENAI_TEXT_MODEL", "gpt-4.1"), messages=[{"role":"system","content":system},{"role":"user","content":prompt}], max_tokens=max(3000, len(cues) * 55), temperature=.25)
    result = _extract_json(response.choices[0].message.content or ""); translations = result.get("translations", result if isinstance(result,list) else [])
    if [item.get("index") for item in translations] != [cue["index"] for cue in cues]: raise ValueError("Full translation changed subtitle indexes")
    by_index = {item["index"]: str(item["translated_text"]).strip() for item in translations}
    return [{**cue, "translated_text": by_index[cue["index"]]} for cue in cues]


async def translate_full(cues, scene, style, style_brief="", project_guide=""):
    return await asyncio.to_thread(_translate_sync, cues, scene, style, style_brief, project_guide)
