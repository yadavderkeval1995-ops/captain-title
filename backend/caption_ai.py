import json
import os
import re
import uuid

from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage
from emergentintegrations.llm.openai import OpenAISpeechToText


def _as_dict(value):
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    return value.__dict__ if hasattr(value, "__dict__") else {}


async def transcribe_words(audio_path: str):
    stt = OpenAISpeechToText(api_key=os.environ["EMERGENT_LLM_KEY"])
    with open(audio_path, "rb") as audio:
        response = await stt.transcribe(
            file=audio, model="whisper-1", response_format="verbose_json",
            temperature=0.0, timestamp_granularities=["word", "segment"])
    data = _as_dict(response)
    source_words = getattr(response, "words", None) or data.get("words") or []
    words = []
    for index, item in enumerate(source_words):
        item = _as_dict(item)
        text = (item.get("word") or item.get("text") or "").strip()
        if text:
            words.append({"index": index, "original": text, "text": text,
                          "start": float(item.get("start", 0)),
                          "end": float(item.get("end", item.get("start", 0) + .35))})
    if not words:
        segments = getattr(response, "segments", None) or data.get("segments") or []
        index = 0
        for raw_segment in segments:
            segment = _as_dict(raw_segment)
            tokens = re.findall(r"[^\s]+", str(segment.get("text", "")).strip())
            if not tokens:
                continue
            start = float(segment.get("start", 0)); end = float(segment.get("end", start + .5))
            step = max(.08, (end - start) / len(tokens))
            for offset, text in enumerate(tokens):
                words.append({"index": index, "original": text, "text": text,
                              "start": round(start + offset * step, 3),
                              "end": round(min(end, start + (offset + 1) * step), 3)})
                index += 1
    if not words:
        raise ValueError("Whisper returned no spoken words")
    return words


async def convert_to_hinglish(words: list[dict]):
    numbered = "\n".join(f"{word['index']}: {word['original']}" for word in words)
    system = (
        "You convert Hindi or mixed Hindi-English speech to exact Roman Hinglish captions. "
        "Never paraphrase, omit, merge, or add words. Return only a JSON array. Each item must be "
        "{\"index\": integer, \"text\": romanized_word, \"important\": boolean}. Keep existing English words unchanged. "
        "Mark at most 20 percent as important, choosing emotionally strong or key meaning words."
    )
    chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=f"caption-{uuid.uuid4()}",
                   system_message=system).with_model("openai", "gpt-5.6-terra")
    chunks = []
    async for event in chat.stream_message(UserMessage(text=f"Convert these indexed words:\n{numbered}")):
        if isinstance(event, TextDelta):
            chunks.append(event.content)
        elif isinstance(event, StreamDone):
            break
    raw = "".join(chunks).strip()
    match = re.search(r"\[[\s\S]*\]", raw)
    if not match:
        raise ValueError("Hinglish conversion did not return valid JSON")
    converted = {int(item["index"]): item for item in json.loads(match.group(0))}
    if len(converted) < max(1, int(len(words) * .8)):
        raise ValueError("Hinglish conversion did not preserve enough words")
    for word in words:
        item = converted.get(word["index"], {})
        word["text"] = str(item.get("text") or word["original"]).strip()
        word["important"] = bool(item.get("important", False))
    return words