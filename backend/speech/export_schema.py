"""Writes the Canonical Transcript JSON Schema to /schemas, for the studio
(TypeScript types are generated from it in Phase 2).
Run from backend/:  python -m speech.export_schema"""
import json
from pathlib import Path

from speech.canonical import CanonicalTranscript

OUTPUT = Path(__file__).resolve().parents[2] / "schemas" / "tadaaam.transcript.v1.schema.json"

if __name__ == "__main__":
    schema = CanonicalTranscript.model_json_schema(by_alias=True)
    schema["$id"] = "tadaaam.transcript/v1"
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT}")
