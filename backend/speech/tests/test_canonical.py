import json
from pathlib import Path

import jsonschema

from speech.canonical import SCHEMA_ID, build_canonical, detect_script, romanize
from speech.export_schema import OUTPUT

WORDS = [{"index": 0, "original": "आज", "start": 0.1, "end": 0.4},
         {"index": 1, "original": "product", "start": 0.4, "end": 0.9},
         {"index": 2, "original": "வணக்கம்", "start": 0.9, "end": 1.4}]
DIAG = {"provider": "sarvam", "timing": "phrase+spread", "language_detected": "hi", "duration": 1.5,
        "chunks_total": 1, "chunks_used": 1, "unique_ratio": 1.0}


def test_scripts_are_detected():
    assert [detect_script(w["original"]) for w in WORDS] == ["Deva", "Latn", "Taml"]


def test_offline_romanization():
    assert romanize("आज") == "aaj"
    assert romanize("product") == "product"
    assert romanize("வணக்கம்").isascii()


def test_roman_and_native_display():
    roman = build_canonical(WORDS, DIAG, requested_language="auto", code_mix=True, output_script="roman")
    native = build_canonical(WORDS, DIAG, requested_language="auto", code_mix=True, output_script="native")
    assert [w.display for w in roman.words][:2] == ["aaj", "product"]
    assert native.words[0].display == "आज"
    assert roman.words[0].timing_confidence == "estimated"


def test_gpt_text_wins_over_offline_romanization():
    words = [dict(WORDS[0], text="aaj", emphasis="key", uncertain=True)]
    doc = build_canonical(words, DIAG, requested_language="hi", code_mix=True, output_script="roman")
    assert doc.words[0].emphasis == "key" and doc.words[0].uncertain


def test_document_matches_committed_schema():
    doc = build_canonical(WORDS, DIAG, requested_language="auto", code_mix=True, output_script="roman",
                          job_id="tx_1").model_dump(by_alias=True)
    assert doc["schema"] == SCHEMA_ID
    schema = json.loads(Path(OUTPUT).read_text(encoding="utf-8"))
    jsonschema.validate(doc, schema)
