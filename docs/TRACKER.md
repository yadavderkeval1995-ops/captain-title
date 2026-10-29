# Tadaaam — Tracker

*Version: 2026-10-27. The single list of open problems, bugs and planned
work. Update the Status column and the "Last verified" date whenever you touch
an item, and record how you verified it. Never mark something Done without
pointing at the commit and the check you ran.*

Priority: **P0** blocks daily use · **P1** high · **P2** medium · **P3** later.
Status: Open · In progress · Done (commit) · Monitoring · Blocked · Proposed.

---

## 1. Owner's issue list (13 items), reconciled with the code

The owner's status table (shared 2026-10-27) is reproduced with a **Verified
state** column from checking the repository on 2026-10-27. Where the two differ,
trust the verified column.

| # | Issue | Owner's status | Priority | Verified state (2026-10-27) | Next action |
| --- | --- | --- | --- | --- | --- |
| 1 | Red and white text placement (Street Glow): some word combinations look disconnected, others overlap | Open | High | Open. Root causes measured: (a) libass `\fs` vs CSS em → export text ≈ 58 % (Anton) / 71 % (Playfair) of preview; (b) preview Anton faux-bold (inherited `font-weight:800`); (c) preview uses Google Fonts, export bundled TTFs; (d) −8 px gap tuned on preview boxes; (e) lines split by word count, not width; (f) ascender vs x-height words. See IN_DEPTH §7. | P-01 → P-04 |
| 2 | Caption grouping splits Hindi/Hinglish phrases awkwardly | "Improved with DP grouping" | High | **DP grouping does not exist** in any branch. Grouping is the greedy rule (max words, 0.4 s gap, sentence end, 1.5 s min display). | Q-01 |
| 3 | Preview vs export grouping differed | Fixed | High | Grouping logic is mirrored line-for-line (Python/JS). Broader visual parity **not** fixed: see #1 and P-07. | P-05, T-01 |
| 4 | Word-by-word reveal in sync without shifting position | Monitoring | — | Street Glow reveals per **line** (pop + glide), not per word. Doodle reveals pills/loops at each word's start. No word-level reveal for Street Glow exists (see #10). | Monitor after P-01 |
| 5 | Long words force font shrinking | "Width-fit safety net implemented" | Medium | Only the **preview** shrinks Doodle rows (canvas measure, min 45 %). **No width-fit in export**, none for Street Glow. | P-07, Q-03 |
| 6 | Red/white lines independently centred, including during reveal | Monitoring | — | Both lines use `\an5` at the same x in export and a centred flex column in preview → centred. Verified visually for static frames. | Keep in visual baselines |
| 7 | Hindi/Hinglish transcription accuracy | High | High | Pipeline works on corpus; no reference transcripts or WER. Sarvam-only engine added 2026-10-27 (148 clean words on the 38 s ad). | A-01, A-02 |
| 8 | Manual split/merge/edit preserves timing and styling | Medium | Medium | Basic flows exist; complex sequences unverified; `palettes` crash (B-01) in emphasis editing on Street Glow. | B-01, E-01 |
| 9 | Preview playback and scrubbing performance | Medium | Medium | rAF polling while playing; WebM preview + Range. No profiling on low-end devices. | E-04 |
| 10 | Street Glow progressive reveal behind flags | "Pending final approval" | High | **No flags and no progressive-reveal code exist** in any branch. Needs to be built (after P-01). | R-01 |
| 11 | Template scalability (two implementations per template) | Architectural risk | — | Confirmed. | D-035 / S-01 |
| 12 | Basic colour customization without breaking template design | Planned | — | Street Glow ignores per-word colour by design; no customization surface. | S-02 |
| 13 | Testing discipline: repeatable visual tests | Partially improved | High | No committed visual tests or baselines. Probe scripts exist only in a scratchpad (recipes in IN_DEPTH §11.3). | T-01 |

---

## 2. Bugs

| ID | Pri | Bug | Repro | Root cause / notes | Status |
| --- | --- | --- | --- | --- | --- |
| B-01 | P1 | Editor crash `palettes is not defined` | Street Glow project → Captions panel → double-click (or right-click) a word → pick an emphasis tier | `CaptionStudio.setWordEmphasis` non-tiered branch uses `palettes[theme]`, removed when templates were replaced (D-026). Fix: for non-tiered themes set `emphasis`/`important` only. | Open |
| B-02 | P2 | SRT has one cue per word | Download SRT | `_write_srt` iterates words, not groups. Offer grouped SRT (by `_group_words_for_display`). | Open |
| B-03 | P2 | Kinetic animations and explicit box sizes are preview-only | Set kinetic "pop" → export | No ASS equivalent implemented; documented in `WordEdit` comments. | Open (by design for now) |
| B-04 | P3 | Stray untracked files | `git status` | `backend/backend.log`, `frontend/captain-title/` (duplicate repo copy). Delete or ignore. | Open |
| B-05 | P3 | `fonttools` installed in venv but not in requirements | — | Installed 2026-10-27 for metric measurement. Add to requirements if P-01 uses it, else uninstall. | Open |
| B-06 | P2 | Re-listen UI always sends `speech_language: "auto"` | Hindi-only project → Re-listen | `CaptionStudio.relisten` hardcodes `auto`; should reuse the project's mode (engine already reused server-side). | Open |
| B-07 | P3 | Upload page footer says "UNLIMITED TESTING · 120 SEC" regardless of env | — | Static copy in `UploadStage`. Use `/usage.unlimited_testing`. | Open |

---

## 3. Parity and rendering work

| ID | Pri | Item | Detail | Status |
| --- | --- | --- | --- | --- |
| P-01 | P0 | ASS font-size unit conversion | `\fs = css_px × (usWinAscent+usWinDescent)/unitsPerEm` per bundled font; apply to all `\fs` emissions. | Proposed (D-033) |
| P-02 | P0 | Remove preview faux-bold on Street Glow line 1 | `font-weight:400` on `.street-glow-line1`; audit inherited weights. | Proposed |
| P-03 | P1 | Same font files in preview and export | Serve `backend/fonts` via `@font-face`; drop Google Fonts for those families. | Proposed |
| P-04 | P1 | Street Glow baseline-based line placement + retune gap | Place line 2 baseline at a fixed offset below line 1 baseline in both renderers; retune by eye with parity. | Proposed |
| P-05 | P1 | Re-calibrate `NATIVE_LINE_HEIGHT` (1.47) after P-01 | It was calibrated against mismatched units. | Proposed |
| P-06 | P2 | Width-balanced Street Glow line split | Choose split by measured widths + phrase-friendly breaks, not `ceil(n/2)`. | Proposed |
| P-07 | P1 | Width-fit in export (Doodle; any single-line template) | Mirror preview `doodleFitScale` via `\fscx\fscy` using PIL measurement (after P-01). | Open |

---

## 4. Testing

| ID | Pri | Item | Status |
| --- | --- | --- | --- |
| T-01 | P0 | Visual parity harness in `backend/tests/visual/`: cases (1/3/6 words, long English, ascender/no-ascender, Devanagari, 2-line) × templates; preview screenshot (headless Chrome, bundled fonts) + export frame; approved baselines; drift report. | Proposed (D-034) |
| T-02 | P1 | Unit tests: grouping (shared JSON vectors for Python+JS), line breaks, `_align_words`, `_stitch_chunk`, `_spread_words`, `_delete_schwas`/romanizer, repetition metrics. | Open |
| T-03 | P2 | Frontend tests for editor operations (split/merge/regroup/save payload). | Open |
| T-04 | P3 | Make integration tests runnable without paid APIs (record/replay fixtures). | Open |

---

## 5. Accuracy and speech

| ID | Pri | Item | Status |
| --- | --- | --- | --- |
| A-01 | P1 | Evaluation set: hand-correct transcripts for the corpus clips (Roman Hinglish + word times for a subset). | Open |
| A-02 | P1 | Script computing WER/CER and romanization match per engine; compare Sarvam-only vs hybrid. | Open |
| A-03 | P1 | Forced alignment for Sarvam text (WhisperX / wav2vec2 Hindi) → real word timing without OpenAI. | Open (D-037) |
| A-04 | P2 | Per-user Glossary → Sarvam keyterms. | Open |
| A-05 | P2 | Try gpt-4o-mini for conversion; compare quality vs gpt-4o. | Open |
| A-06 | P3 | Additional engines (ElevenLabs Scribe, Deepgram Nova-3, local faster-whisper) behind the dropdown. | Open |
| A-07 | P2 | Emphasis without GPT (heuristics: numbers, brand/English nouns, sentence-final verbs) so Doodle decorations work offline. | Open |

---

## 6. Caption quality and templates

| ID | Pri | Item | Status |
| --- | --- | --- | --- |
| Q-01 | P1 | Phrase-aware grouping (DP over break costs: pause, punctuation, verb+auxiliary, postpositions, width, duration). Implement in Python and JS with shared vectors. | Open |
| Q-02 | P2 | Min/max on-screen durations per template; avoid flashes < 0.5 s. | Open |
| Q-03 | P2 | Long-word strategy per template (shrink limits, hyphen-less break rules). | Open |
| R-01 | P1 | Street Glow progressive (word-level) reveal — build after P-01, behind a project/template flag, with baselines. | Open |
| S-01 | P2 | Template spec (JSON) consumed by both renderers. | Proposed (D-035) |
| S-02 | P2 | Template-safe colour customization (e.g. Street Glow accent colour pairs). | Open |

---

## 7. Editor and product

| ID | Pri | Item | Status |
| --- | --- | --- | --- |
| E-01 | P1 | Verify complex edit sequences (split → merge → regroup → save → export) end to end. | Open |
| E-02 | P1 | Project history: `GET /api/projects` + list/reopen UI. | Open |
| E-03 | P2 | Undo/redo; keyboard shortcuts; autosave. | Open |
| E-04 | P2 | Performance profiling (long videos, low-end laptops, mobile Safari). | Open |
| E-05 | P2 | Trim; grouped SRT/VTT; transparent overlay export; watermark (Free). | Open |
| M-01 | P2 | Minute-based UsageLedger + plans as data (D-030). | Proposed |
| M-02 | P2 | Razorpay checkout + webhook. | Open (D-007) |
| O-01 | P3 | Hosted backend (container + Atlas + S3/R2 + job queue). | Open (D-038) |
| O-02 | P3 | Tighten CORS, rate limiting before any hosting. | Open |
| X-00 | P0 | **tscaps integration Phase 0 spike** (see `docs/TSCAPS_INTEGRATION_PLAN.md` §10 and Appendix D). If adopted, items #1, #3, #11, P-01…P-07 and T-01's libass half are superseded by the single DOM/CSS renderer. | Deferred (D-042: Phase 1 first) |
| X-01 | P0 | **Phase 1 — Speech Service v2** (`backend/speech/`, `/api/v2/*`). Done: provider protocol + `role`, registry + `routing.json`, Sarvam / Whisper-timing / Hybrid providers, pipeline, Canonical Transcript + JSON Schema, v2 endpoints, tests, WER script. Left: owner hand-corrects 3 references (`backend/eval/references/*.draft.txt` → `<stem>.txt`), then run `scripts/eval_wer.py`; hybrid row needs a valid OpenAI key. | In progress (2026-10-29) |

---

## 8. Done log

| Date | Item | Commit | How verified |
| --- | --- | --- | --- |
| 2026-10-29 | Phase 1 Speech Service v2 (X-01, except references/WER table) | 221ceb6 | `pytest speech/tests` 25 passed; `TADAAAM_NETWORK_TESTS=1` contract 6 passed; toe-protector 148 words / identical metrics via v1 wrapper; v2 POST/GET/providers/languages over HTTP (roman + native, 404 for other user, 400 for bad language) |
| 2026-10-29 | Rename to Tadaaam in docs, UI copy, API title, download filenames | 58b5a8f (docs: docs commit) | `grep` for old name in docs/UI; frontend build |
| 2026-10-27 | Vercel deploy config (root + `frontend/vercel.json`), API URL fallback | 68576da, a6506a9 | `CI=true craco build`; pushed to both branches |
| 2026-10-27 | `TranscriptionAuthError` (named provider failures) | 221ceb6 | Stub-DB job with a fake key → failed with the OpenAI message |
| 2026-10-27 | Windows temp-dir cleanup fix (await preview task) | 221ceb6 | Same run: no `PermissionError` |
| 2026-10-27 | Speech Engine dropdown; Sarvam-only engine with phrase timestamps | 43800cb (UI), 221ceb6 (backend) | 3 corpus clips transcribed; 38 s ad → 148 words; full job `ready` in 27 s; frontend build passes |
| 2026-10-27 | Offline Hinglish fallback with schwa deletion + dictionary additions | 221ceb6 | 25-word romanizer check; corpus output reviewed |
| 2026-10-27 | Documentation set (`CLAUDE.md`, `docs/*`) | docs commit (2026-10-29) | — |
| 2026-10-24 | Doodle Marker single line, 3 words per cue | 1f4d872 | (prior session) |
| 2026-10-24 | Glued words fixed (CSS whitespace) + word spacing | d6588fa, 9febc36 | (prior session) |
| 2026-10-23 | Sarvam run-on word merge detection | 04eb454 | (prior session) |
| 2026-10-22 | Two fixed templates replace all others | cdcf5bf | (prior session) |
