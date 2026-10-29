"""Accuracy table for speech providers on the evaluation corpus.

References are hand-corrected Roman Hinglish transcripts, one per clip, in
backend/eval/references/<clip-stem>.txt. Clips are listed in
backend/eval/corpus.json.

Run from backend/:
  python -X utf8 scripts/eval_wer.py --draft              # write <stem>.draft.txt from Sarvam, to hand-correct
  python -X utf8 scripts/eval_wer.py                      # WER/CER per provider x clip
  python -X utf8 scripts/eval_wer.py --providers sarvam hybrid
"""
import argparse
import asyncio
import json
import re
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

from captions import _extract_audio  # noqa: E402
from speech.canonical import build_canonical  # noqa: E402
from speech.pipeline import transcribe  # noqa: E402

EVAL_DIR = BACKEND / "eval"
REFERENCES = EVAL_DIR / "references"


def normalize(text: str) -> list[str]:
    return re.sub(r"[^\w\s']", " ", text.lower()).split()


def edit_distance(a: list, b: list) -> int:
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        current = [i]
        for j, right in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left != right)))
        previous = current
    return previous[-1]


def wer(reference: str, hypothesis: str) -> float:
    ref = normalize(reference)
    return edit_distance(ref, normalize(hypothesis)) / max(1, len(ref))


def cer(reference: str, hypothesis: str) -> float:
    ref = " ".join(normalize(reference))
    return edit_distance(list(ref), list(" ".join(normalize(hypothesis)))) / max(1, len(ref))


async def run_clip(clip: Path, provider: str, language: str | None) -> tuple[str, dict]:
    with tempfile.TemporaryDirectory() as temp:
        wav = str(Path(temp) / "speech.wav")
        _extract_audio(str(clip), wav)
        words, diagnostics = await transcribe(wav, language, True, provider)
    doc = build_canonical(words, diagnostics, requested_language=language or "auto", code_mix=True,
                          output_script="roman")
    return " ".join(word.display for word in doc.words), diagnostics


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--providers", nargs="+", default=["sarvam"])
    parser.add_argument("--draft", action="store_true", help="write draft references from the first provider")
    args = parser.parse_args()
    corpus = json.loads((EVAL_DIR / "corpus.json").read_text(encoding="utf-8"))
    REFERENCES.mkdir(parents=True, exist_ok=True)
    rows, results = [], []
    for item in corpus["clips"]:
        clip = (EVAL_DIR / item["path"]).resolve()
        stem = Path(item["path"]).stem
        reference_file = REFERENCES / f"{stem}.txt"
        for provider in args.providers:
            try:
                hypothesis, diagnostics = await run_clip(clip, provider, item.get("language"))
            except Exception as exc:  # one failing provider shouldn't hide the others
                rows.append(f"| {stem} | {provider} | error: {exc} | | |")
                continue
            if args.draft:
                (REFERENCES / f"{stem}.draft.txt").write_text(hypothesis + "\n", encoding="utf-8")
                print(f"draft written: {stem}.draft.txt (correct it by hand, save as {stem}.txt)")
                break
            if not reference_file.exists():
                rows.append(f"| {stem} | {provider} | no reference yet | | |")
                continue
            reference = reference_file.read_text(encoding="utf-8")
            scores = {"wer": round(wer(reference, hypothesis), 3), "cer": round(cer(reference, hypothesis), 3)}
            results.append({"clip": stem, "provider": provider, **scores, "cost_inr": diagnostics.get("cost_inr")})
            rows.append(f"| {stem} | {provider} | {scores['wer']:.1%} | {scores['cer']:.1%} | "
                        f"{diagnostics.get('cost_inr')} |")
    if not args.draft:
        print("| Clip | Provider | WER | CER | Cost INR |\n| --- | --- | --- | --- | --- |")
        print("\n".join(rows))
        (EVAL_DIR / "results.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
