"""Devanagari -> Roman Hinglish romanization that works offline: a
dictionary of the highest-frequency Hindi words plus OPTITRANS
transliteration with Hindi schwa deletion. Used whenever GPT is unavailable
or leaves a word in Devanagari."""
import re

from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate

_DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")

# indic_transliteration's schemes (OPTITRANS/ITRANS/HK all included) are
# literal Sanskrit-style transliterations, not Hindi-phonetic romanization -
# they render anusvara (ं) as "m" (a Sanskrit convention) instead of Hindi's
# nasalized "n" (हैं -> "haim", not "hain"), and never apply Hindi's
# word-final schwa deletion, so a word like आप keeps its silent trailing
# vowel (-> "apa", not "aap"). These are exactly the highest-frequency words
# in ordinary Hindi speech - pronouns, the copula, negation, common verbs
# and postpositions - so when GPT returns raw Devanagari for a word instead
# of its own natural Hinglish spelling (the case _romanize_fallback below
# exists for), it's far more likely to land on one of these than an obscure
# word. A small lookup table of their real spelling fixes the overwhelming
# majority of visibly-wrong output without needing a full phonetic rewrite
# of the transliteration engine itself.
_COMMON_HINDI_ROMANIZATIONS = {
    "है": "hai", "हैं": "hain", "था": "tha", "थी": "thi", "थे": "the",
    "हूं": "hoon", "हूँ": "hoon", "हो": "ho", "होगा": "hoga", "होगी": "hogi",
    "होंगे": "honge", "होना": "hona", "रहा": "raha", "रही": "rahi", "रहे": "rahe",
    "मैं": "main", "मुझे": "mujhe", "मुझको": "mujhko", "मेरा": "mera", "मेरी": "meri",
    "मेरे": "mere", "हम": "hum", "हमें": "hamein", "हमारा": "hamara", "हमारी": "hamari",
    "हमारे": "hamare", "तू": "tu", "तुझे": "tujhe", "तेरा": "tera", "तुम": "tum",
    "तुम्हें": "tumhein", "तुम्हारा": "tumhara", "आप": "aap", "आपका": "aapka",
    "आपकी": "aapki", "आपके": "aapke", "आपको": "aapko", "वह": "woh", "वो": "woh",
    "उसे": "use", "उसका": "uska", "उसकी": "uski", "उसके": "uske",
    "ये": "ye", "यह": "yeh", "इसे": "ise", "इसका": "iska", "इसकी": "iski", "इसके": "iske",
    "वे": "ve", "उन्हें": "unhein", "उनका": "unka", "उनकी": "unki", "उनके": "unke",
    "नहीं": "nahin", "मत": "mat", "ना": "na",
    "क्या": "kya", "कौन": "kaun", "कहाँ": "kahan", "कहां": "kahan", "कब": "kab",
    "क्यों": "kyun", "कैसे": "kaise", "कितना": "kitna", "कितनी": "kitni", "कितने": "kitne",
    "और": "aur", "या": "ya", "लेकिन": "lekin", "पर": "par", "भी": "bhi", "तो": "to",
    "ही": "hi", "जो": "jo", "कि": "ki", "से": "se", "को": "ko", "का": "ka",
    "की": "ki", "के": "ke", "में": "mein", "पे": "pe", "तक": "tak", "साथ": "saath",
    "बिना": "bina", "लिए": "liye", "लिये": "liye", "काफी": "kaafi", "काफ़ी": "kaafi",
    "कीजिए": "kijiye", "दीजिए": "dijiye", "जाइए": "jaiye", "आइए": "aaiye", "चाहते": "chahte",
    "करना": "karna", "करता": "karta", "करती": "karti", "करते": "karte", "किया": "kiya",
    "कर": "kar", "करो": "karo", "करें": "karein", "करूंगा": "karunga",
    "जाना": "jana", "जाता": "jata", "जाती": "jati", "जाते": "jate", "गया": "gaya",
    "गयी": "gayi", "गई": "gai", "गए": "gaye", "जाओ": "jao",
    "आना": "aana", "आता": "aata", "आती": "aati", "आते": "aate", "आया": "aaya",
    "आई": "aai", "आए": "aaye",
    "देना": "dena", "देता": "deta", "दिया": "diya", "लेना": "lena", "लेता": "leta",
    "लिया": "liya", "कहना": "kehna", "कहा": "kaha",
    "सुनना": "sunna", "सुना": "suna", "देखना": "dekhna", "देखा": "dekha", "देखो": "dekho",
    "समझना": "samajhna", "समझा": "samjha", "चाहिए": "chahiye", "चाहता": "chahta",
    "चाहती": "chahti", "सकता": "sakta", "सकती": "sakti", "सकते": "sakte",
    "मिलना": "milna", "मिला": "mila", "रखना": "rakhna", "रखा": "rakha",
    "बहुत": "bahut", "अच्छा": "accha", "अच्छी": "acchi", "अच्छे": "acche",
    "बड़ा": "bada", "बड़ी": "badi", "छोटा": "chota", "नया": "naya",
    "सब": "sab", "सभी": "sabhi", "कुछ": "kuch", "कोई": "koi", "हर": "har",
    "अपना": "apna", "अपनी": "apni", "अपने": "apne", "खुद": "khud",
    "एक": "ek", "दो": "do", "तीन": "teen",
    "ऐसा": "aisa", "ऐसी": "aisi", "ऐसे": "aise", "वैसा": "vaisa", "वैसी": "vaisi",
    "जैसा": "jaisa", "जैसी": "jaisi", "जैसे": "jaise", "कैसा": "kaisa", "कैसी": "kaisi",
    "थोड़ा": "thoda", "थोड़ी": "thodi", "ज्यादा": "zyada", "ज़्यादा": "zyada",
    "शायद": "shayad", "ज़रूर": "zaroor", "जरूर": "zaroor", "यार": "yaar",
    "अभी": "abhi", "फिर": "phir", "सच": "sach", "झूठ": "jhooth", "पता": "pata",
    "समय": "samay", "वक़्त": "waqt", "वक्त": "waqt", "बात": "baat", "काम": "kaam",
    "दिन": "din", "रात": "raat", "घर": "ghar", "यहाँ": "yahan", "यहां": "yahan",
    "वहाँ": "wahan", "वहां": "wahan",
}


_DEVANAGARI_CONSONANT_RE = re.compile(r"[क-हक़-य़]")
_DEVANAGARI_MATRA_RE = re.compile(r"[ा-ौॢॣ]")
_VIRAMA, _NUKTA = "्", "़"


def _delete_schwas(word):
    """Mark Hindi's silent inherent "a" with a virama before transliterating,
    so आज reads "aaj" (not "aja") and करवाना "karvaana" (not "karavaana"):
    a word-final schwa is always dropped, and a medial one is dropped when
    the syllables on both sides still carry a vowel (scanning right to left,
    the standard schwa-deletion rule)."""
    units = []  # [index of the consonant's last char, "schwa" | "vowel" | "dead"]
    i = 0
    while i < len(word):
        if _DEVANAGARI_CONSONANT_RE.match(word[i]):
            j = i + 1
            if j < len(word) and word[j] == _NUKTA:
                j += 1
            if j < len(word) and word[j] == _VIRAMA:
                units.append([j - 1, "dead"])
                i = j + 1
            elif j < len(word) and _DEVANAGARI_MATRA_RE.match(word[j]):
                units.append([j - 1, "vowel"])
                i = j + 1
            else:
                units.append([j - 1, "schwa"])
                i = j
            continue
        if "अ" <= word[i] <= "औ":
            units.append([i, "vowel"])
        i += 1
    if len(units) < 2:
        return word
    silent = set()
    if units[-1][1] == "schwa":
        silent.add(len(units) - 1)
        units[-1][1] = "dead"
    for k in range(len(units) - 2, 0, -1):
        if units[k][1] == "schwa" and units[k - 1][1] != "dead" and units[k + 1][1] != "dead":
            silent.add(k)
            units[k][1] = "dead"
    chars = list(word)
    for k in sorted(silent, reverse=True):
        chars.insert(units[k][0] + 1, _VIRAMA)
    return "".join(chars)


def _hinglish_transliterate(word):
    """Devanagari -> everyday Roman Hinglish spelling: schwa deletion, long
    vowels doubled (aa/ee/oo, single at the end of a word), nasals as "n",
    ड़/ढ़ as r/rh."""
    text = transliterate(_delete_schwas(word), sanscript.DEVANAGARI, sanscript.OPTITRANS)
    text = text.replace(".Dh", "rh").replace(".D", "r").replace(".N", "n").replace("M", "n")
    text = re.sub(r"A(?=\W*$)", "a", text)
    text = re.sub(r"I(?=\W*$)", "i", text)
    text = re.sub(r"U(?=\W*$)", "u", text)
    return text.replace("A", "aa").replace("I", "ee").replace("U", "oo").lower()


def _romanize_fallback(text):
    """Best-effort algorithmic Devanagari->Roman transliteration, used ONLY
    when GPT drops a word's index or returns no usable text for it (see
    convert_to_hinglish below). Without this, that fallback used to be the
    word's own raw `original` text verbatim - which is genuine Devanagari
    for Hindi/mixed speech - silently leaking native script into word.text,
    the field "Roman Hinglish" mode renders everywhere (editor, Timeline,
    export). Algorithmic transliteration reads rougher than GPT's own
    natural Hinglish spelling, but it guarantees word.text is never
    Devanagari, which GPT dropping an index must never compromise.
    _COMMON_HINDI_ROMANIZATIONS is checked first, since those are the words
    the raw transliteration scheme gets most visibly wrong."""
    if not text or not _DEVANAGARI_RE.search(text):
        return text
    cleaned = text.replace("।", ".").replace("॥", ".")
    stripped = cleaned.rstrip(".,!?\"'")
    natural = _COMMON_HINDI_ROMANIZATIONS.get(stripped)
    if natural is not None:
        return natural + cleaned[len(stripped):]
    return " ".join(_hinglish_transliterate(part) for part in cleaned.split())


def _common_hindi_spelling(original_text):
    """Looks _COMMON_HINDI_ROMANIZATIONS up directly against a word's raw
    ASR source text (word.original, always Devanagari for Hindi speech) -
    checked BEFORE GPT's own chosen romanization, not just as a fallback for
    when GPT leaves a word in Devanagari. GPT can just as easily write its
    OWN wrong spelling directly in Roman script (e.g. "maim" for मैं,
    "maam"/"isa" and other near-misses) as it can skip romanizing a word
    entirely - that output never contains Devanagari, so _romanize_fallback
    above never even sees it to correct it. These are the highest-frequency
    words in ordinary Hindi speech, so forcing their one unambiguous
    spelling - regardless of what GPT happened to output - costs nothing
    and fixes the mistake GPT itself makes most often, without touching how
    any other, more context-dependent word gets romanized."""
    if not original_text:
        return None
    cleaned = original_text.strip()
    stripped = cleaned.rstrip(".,!?\"'।॥")
    natural = _COMMON_HINDI_ROMANIZATIONS.get(stripped)
    if natural is None:
        return None
    trailing = cleaned[len(stripped):].replace("।", ".").replace("॥", ".")
    return natural + trailing
