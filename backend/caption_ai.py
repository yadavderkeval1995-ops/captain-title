import json
import logging
import os
import re
from difflib import SequenceMatcher

from openai import AsyncOpenAI

from speech.errors import ProviderAuthError
from speech.pipeline import transcribe
from speech.romanize import _DEVANAGARI_RE, _common_hindi_spelling, _romanize_fallback

logger = logging.getLogger("captain-title.caption_ai")
# The v1 project flow's engine choice, mapped onto speech providers.
# "sarvam": Sarvam alone - its text plus its phrase-level timestamps, no
# OpenAI call at all. "whisper": Sarvam's text placed on Whisper's word-level
# timing (the hybrid provider) - needs a working OpenAI key. Sarvam decides
# the words either way; Whisper only ever supplies timecodes.
STT_ENGINES = {"sarvam", "whisper"}
_ENGINE_PROVIDERS = {"sarvam": "sarvam", "whisper": "hybrid"}
# Kept under its old name for captions.py's error mapping.
TranscriptionAuthError = ProviderAuthError


async def transcribe_words(audio_path: str, speech_language: str = "auto", engine: str = "sarvam"):
    return await transcribe(audio_path, language="hi" if speech_language == "hi" else None, code_mix=True,
                            provider_id=_ENGINE_PROVIDERS[engine])


async def convert_to_hinglish(words: list[dict], context: str = ""):
    numbered = "\n".join(f"{word['index']}: {word['original']}" for word in words)
    system = (
        "You convert Hindi or mixed Hindi-English speech to exact Roman Hinglish captions. "
        "Correct only obvious phonetic ASR spelling errors when the intended Hindi or English word is unambiguous from context. "
        "Never paraphrase, omit, merge, reorder, or add words, and keep one output token per input index. Return only a JSON array. Each item must be "
        "{\"index\": integer, \"text\": romanized_word, \"emphasis\": \"support\"|\"feature\"|\"key\", \"uncertain\": boolean}. Keep existing English words unchanged. "
        "Set uncertain=true when the ASR source word or surrounding phrase is nonsensical and cannot be corrected confidently. "
        "Emphasis is a 3-tier read of how a professional caption editor would highlight each word: "
        "\"key\" is the single punchiest word in a short phrase - a number, a strong verb/adjective, a brand or product name, "
        "the emotional peak of what's being said. Use it sparingly, roughly 1 word in every 10-15. "
        "\"feature\" is a secondary notable word worth a visual lift but not the main punch - another name, quantity, or "
        "descriptive word. Use it for roughly 15-20 percent of words. Every other word (articles, connectors, filler) is \"support\"."
    )
    context_line = f"Video context only for resolving product terms: {context}\n" if context else ""
    try:
        client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        response = await client.chat.completions.create(
            model=os.environ.get("CAPTION_LLM_MODEL", "gpt-4o"), temperature=0,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": f"{context_line}Convert these indexed words:\n{numbered}"}])
        raw = (response.choices[0].message.content or "").strip()
        match = re.search(r"\[[\s\S]*\]", raw)
        if not match:
            raise ValueError("Hinglish conversion did not return valid JSON")
        converted = {int(item["index"]): item for item in json.loads(match.group(0))}
    except Exception:
        # No usable GPT (bad key, no credit, bad JSON): every word goes
        # through the offline dictionary/transliteration path below with
        # "support" emphasis - rougher spelling, but the video still finishes.
        logger.exception("GPT Hinglish conversion failed; using offline romanization")
        converted = {}
    missing = set(range(len(words))) - set(converted)
    if missing and converted:
        # GPT occasionally drops a handful of indices from a long JSON
        # response instead of returning every one as instructed. Falling
        # back to the original source text for just those words (handled
        # below) beats failing the whole video over a partial response.
        logger.warning("Hinglish conversion dropped %d/%d word indices", len(missing), len(words))
    for word in words:
        item = converted.get(word["index"], {})
        # Precedence: (1) _common_hindi_spelling checked against the real
        # ASR source - GPT can misspell one of these high-frequency words in
        # Roman script just as easily as it can leave it in Devanagari (e.g.
        # writing "maim" for मैं directly), and that output never contains
        # Devanagari for _romanize_fallback below to ever catch and correct.
        # It only overrides GPT's own answer when that answer is a close
        # match to the dictionary spelling (a SequenceMatcher ratio - cheap,
        # no extra dependency - comfortably separates "maim"/"main" at .75
        # or "apa"/"aap" at .67 from an unrelated word GPT deliberately
        # substituted, which scores under .4 in practice): GPT is explicitly
        # instructed to correct genuine ASR mishearings from context, and a
        # wildly different answer means it did exactly that, which must
        # still win over a fixed dictionary entry keyed only on the raw,
        # possibly-mis-heard ASR source. (2) Otherwise, GPT's own chosen
        # text, or the raw source text if GPT dropped this index - routed
        # through _romanize_fallback unconditionally (a no-op for text
        # that's already Roman) so Devanagari GPT hands back instead of
        # romanizing never leaks into word.text, the field every part of the
        # app (transcript, canvas, Timeline, export) treats as pure-Roman
        # Hinglish.
        gpt_text = str(item.get("text") or "").strip()
        common = _common_hindi_spelling(word["original"])
        if common is not None and (not gpt_text or _DEVANAGARI_RE.search(gpt_text)
                                    or SequenceMatcher(None, gpt_text.lower(), common.lower()).ratio() >= 0.5):
            word["text"] = common
        else:
            word["text"] = _romanize_fallback(gpt_text or word["original"])
        emphasis = item.get("emphasis")
        if emphasis not in {"support", "feature", "key"}:
            emphasis = "support"
        word["emphasis"] = emphasis
        # Kept for templates/UI built around a simple on/off emphasis flag.
        word["important"] = emphasis != "support"
        word["uncertain"] = bool(item.get("uncertain", False))
    return words


async def reassign_emphasis(words: list[dict], context: str = ""):
    """Re-run just the 3-tier emphasis read (not the Hinglish romanization)
    against the *current* caption text, leaving text/uncertain untouched -
    for re-tagging after the user hand-edits words, when the original
    emphasis assigned at generation time no longer matches what's on screen."""
    numbered = "\n".join(f"{word['index']}: {word['text']}" for word in words)
    system = (
        "You are a professional caption editor deciding which words in a short-form video caption "
        "deserve visual emphasis. Return only a JSON array, one item per input index: "
        "{\"index\": integer, \"emphasis\": \"support\"|\"feature\"|\"key\"}. "
        "\"key\" is the single punchiest word in a short phrase - a number, a strong verb/adjective, a brand or "
        "product name, the emotional peak of what's being said. Use it sparingly, roughly 1 word in every 10-15. "
        "\"feature\" is a secondary notable word worth a visual lift but not the main punch - another name, "
        "quantity, or descriptive word. Use it for roughly 15-20 percent of words. "
        "Every other word (articles, connectors, filler) is \"support\"."
    )
    client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
    context_line = f"Video context only for resolving product terms: {context}\n" if context else ""
    response = await client.chat.completions.create(
        model=os.environ.get("CAPTION_LLM_MODEL", "gpt-4o"), temperature=0,
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": f"{context_line}Assign emphasis to these indexed words:\n{numbered}"}])
    raw = (response.choices[0].message.content or "").strip()
    match = re.search(r"\[[\s\S]*\]", raw)
    if not match:
        raise ValueError("Emphasis re-assignment did not return valid JSON")
    converted = {int(item["index"]): item for item in json.loads(match.group(0))}
    for word in words:
        item = converted.get(word["index"], {})
        emphasis = item.get("emphasis")
        if emphasis not in {"support", "feature", "key"}:
            emphasis = word.get("emphasis", "support")
        word["emphasis"] = emphasis
        word["important"] = emphasis != "support"
    return words
