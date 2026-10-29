# Tadaaam — Decision Log

*Version: 2026-10-27. Each entry records a decision, the context that forced
it, the alternatives considered, the consequences we accepted, and its current
status. Newest decisions are at the bottom of each section; the index lists
them all. Before reversing a decision, read its entry and add a new one that
supersedes it — never edit history silently.*

Status values: **Active** (in force), **Superseded** (replaced; see link),
**Proposed** (agreed direction, not built), **Open** (needs the owner's call).

---

## Index

| ID | Date | Decision | Status |
| --- | --- | --- | --- |
| D-001 | 2026-08-07 | Product scope: word-by-word Roman Hinglish captions, editable, burned-in MP4 | Active |
| D-002 | 2026-08-07 | Preserve spoken words; never paraphrase or translate | Active |
| D-003 | 2026-08-07 | FastAPI + MongoDB + React; modules split by concern | Active |
| D-004 | 2026-08-07 | Burn captions with FFmpeg + libass (ASS scripts) | Active |
| D-005 | 2026-08-07 | Upload limit 120 s / 120 MB, MP4/MOV only | Active |
| D-006 | 2026-08-07 | Credit model (free / ₹69 single / ₹399 Basic) and `UNLIMITED_TESTING` | Active (code) / Superseded (pricing, see D-030) |
| D-007 | 2026-08-07 | Stripe disabled rather than mocked; Razorpay preferred for India | Active / Open (provider) |
| D-008 | 2026-08 | Reject repetitive/hallucinated transcripts; flag uncertain words; Re-listen | Active |
| D-009 | 2026-08 | Background job + polling instead of a long request | Active |
| D-010 | 2026-08 | HTTP Range media endpoint + parallel WebM preview | Active |
| D-011 | 2026-09-16 | Leave Emergent; self-host with direct keys and local disk | Active |
| D-012 | 2026-09-17 | Yarn 1 for the frontend (npm ignores `resolutions`) | Active |
| D-013 | 2026-09-17 | gpt-4o as the default Hinglish model | Active (cost review pending) |
| D-014 | 2026-09–10 | Chunk audio ~20 s, snapped to silences, with lead-in and overlap priming | Active |
| D-015 | 2026-10-19 | Sarvam (Saaras) for text; Whisper only for word timing (hybrid) | Active as one engine (see D-029) |
| D-016 | 2026-10-19 | Global sequence alignment to stitch Sarvam text onto Whisper timing | Active |
| D-017 | 2026-10-19 | Own Google OAuth client instead of Emergent auth | Active |
| D-018 | 2026-10-19 | Captik-style editor layout and brand palette | Active |
| D-019 | 2026-10-19 | 3-tier emphasis (support/feature/key) from GPT | Active |
| D-020 | 2026-10-20 | Synthesized SFX in both editor and export (no licensed samples) | Active |
| D-021 | 2026-10-20 | Dual-script display (Roman `text` / native `original`) | Active |
| D-022 | 2026-10-21 | Real bold only for fonts that ship a bold face | Active |
| D-023 | 2026-10-22 | Common-word dictionary overrides GPT spelling (similarity-gated) | Active |
| D-024 | 2026-10-22 | Independent Outline/Shadow/Glow/Background layers; blur via FFmpeg gblur masks | Active |
| D-025 | 2026-10-22 | Let libass and CSS each use native multi-line layout (`\N`) | Active (re-examine with D-033) |
| D-026 | 2026-10-22 | Replace all templates with two fixed motion designs: Street Glow, Doodle Marker | Active |
| D-027 | 2026-10-24 | Doodle Marker is always one line, ≤ 3 words per cue | Active |
| D-028 | 2026-10-27 | Frontend on Vercel (root `frontend/`), backend stays local | Active |
| D-029 | 2026-10-27 | Speech-engine dropdown; Sarvam-only is the default | Active |
| D-030 | 2026-10-27 | Price by minutes, INR plans (Free/Creator/Pro/Team + pack) | Proposed |
| D-031 | 2026-10-27 | Offline Hinglish fallback (schwa deletion) when GPT is unavailable | Active |
| D-032 | 2026-10-27 | Provider credential failures abort the job with a named error | Active |
| D-033 | 2026-10-27 | Fix font-size unit conversion instead of tuning constants by eye | Proposed |
| D-034 | 2026-10-27 | Repeatable visual parity tests with approved baselines | Proposed |
| D-035 | 2026-10-27 | Keep two renderers for now; move to one template spec later | Proposed |
| D-036 | 2026-10-27 | Documentation set in repo (`CLAUDE.md` + `docs/`) | Active |
| D-037 | — | Real per-word timing for Sarvam text: forced alignment vs other engines | Open |
| D-038 | — | Where to host the backend when it leaves the PC | Open |
| D-039 | 2026-10-27 | Adopt tscaps (engine MIT + forked studio AGPL) as the front end; backend becomes a provider-agnostic multilingual Speech Service | Proposed (Phase 0 spike pending) |
| D-040 | 2026-10-29 | Product renamed to Tadaaam (repo folder, storage prefix and test ids unchanged) | Active |
| D-041 | 2026-10-29 | Sarvam decides the words; Whisper supplies timecodes only (provider `role`) | Active |
| D-042 | 2026-10-29 | Start at Phase 1 (backend Speech Service v2) before the tscaps spike | Active |

---

## Product decisions

### D-001 — Product scope
- **Context.** Brief: "generate creative font and mixed font captions after
  transcripting videos into hinglish, word to word".
- **Decision.** Output is (1) an editable caption preview, (2) a word-level
  timeline, (3) a styled downloadable MP4. SRT added later (2026-09-19).
- **Consequences.** The project is an *editor*, not just an API; preview/export
  parity becomes the central engineering problem (D-004, D-025, D-033).

### D-002 — Say exactly what was said
- **Context.** Creators want their own words; LLMs like to "improve" text.
- **Decision.** Preserve spoken words. Convert Hindi to Roman Hinglish without
  paraphrasing; correct only obvious, unambiguous ASR misspellings; keep English
  words unchanged; one output token per input word.
- **Consequences.** The GPT prompt is strict and index-based; dropped indices
  fall back to the source; word count never changes during conversion.

### D-005 — 120 s / 120 MB, MP4/MOV
- **Context.** Short-form focus; synchronous processing on one machine; cost control.
- **Decision.** Hard limits validated in browser and server.
- **Consequences.** Long-form is out of scope; a 2-minute cap will feel tight for
  podcasts (see D-030 for a per-plan cap proposal).

### D-006 — Credit model and testing switch
- **Decision (Emergent era).** Free: one video ≤ 45 s. Single pass ₹69 (≤ 45 s,
  max three purchases). Basic ₹399/month (10 videos ≤ 60 s). Credits deducted
  only on success. `UNLIMITED_TESTING=true` lets any ≤ 120 s video through.
- **Consequences.** Count-based pricing penalizes longer clips; superseded as a
  pricing strategy by D-030 but still what the code enforces.

### D-007 — Payments: no fake checkout; Razorpay for India
- **Context.** Stripe sandbox/account unavailable for business country IN.
- **Decision.** Keep Stripe code (signed webhooks, idempotent grants, status
  polling) but report checkout unavailable; never mock payments. Razorpay (≈ 2 %
  fee, works for Indian businesses) is the preferred route.
- **Status.** Open on provider choice and timing (owner not charging yet).

### D-018 — Captik-style editor
- **Context.** The owner wanted a professional editor feel; Captik's layout is familiar to creators.
- **Decision.** Left icon rail + panel, centre 9:16 canvas, right tabbed style
  panel, bottom multi-lane timeline, per-word "FOR THIS MOMENT" popover;
  Cherry Red / Roma Red on black.
- **Consequences.** Large single component (`CaptionStudio.jsx`); many
  interactions to keep in sync with the export.

### D-026 — Two fixed motion-graphic templates
- **Context.** Many skinnable themes (Viral, Cinematic, Minimal, Podcast, later
  6 more incl. 4 Hindi) looked generic and multiplied parity work.
- **Decision.** Replace all of them with two complete designs that own font,
  colour and motion: **Street Glow** (line-based headline/subline) and
  **Doodle Marker** (word-based highlighter/loop). Per-word colour/size are
  ignored by Street Glow.
- **Consequences.** Fewer, better designs; older saved projects with unknown
  themes fall back to the Street Glow path; customization (issue #12) must be
  designed per template rather than generic.

### D-027 — Doodle Marker single line
- **Decision.** Always one line, max 3 words per cue; the preview shrinks the row
  to fit (min 45 %).
- **Consequences.** Long English loanwords can shrink text noticeably (issue #5).
  The export applies **no** fit scale (verified: no fit logic in `captions.py`)
  and wrapping is off (WrapStyle 2), so an over-wide Doodle line that the
  preview shrinks will run past the frame edges in the MP4 (TRACKER P-07).

### D-030 — Price by minutes (proposed)
- **Context.** Cost scales with audio minutes (≈ ₹0.5–1.9/min), not videos.
- **Proposal.** Free 3 min/month (watermark, 60 s cap); Creator ₹299/month,
  30 min (3 min cap); Pro ₹799, 120 min (10 min cap); Team ₹1,999, 400 min,
  3 seats; ₹49 pack = 5 min; overage ₹9 (Creator) / ₹7 (Pro) per minute.
  Margins ≥ 60 % at full use on today's pipeline. Source:
  https://claude.ai/artifact/DhiTaqHdRMUZYKrLiFuNqS
- **Needs.** UsageLedger (minutes), plans as data, Razorpay, watermark export.
- **Open questions.** Free tier size; GST-inclusive display; whether Sarvam-only
  becomes the default for paid plans (cost drops to ≈ ₹0.55/min with gpt-4o-mini).

---

## Speech and language decisions

### D-008 — Honest transcripts
- **Context.** Whisper hallucinated "YouTube protector" repeatedly over music in
  the owner's real ad.
- **Decision.** Reject chunks/transcripts that are repetitive (unique ratio,
  dominant bigram, repeated 4-grams); mark `uncertain` words; offer Re-listen;
  show the raw engine transcript in the UI.
- **Consequences.** Some legitimate repetitive speech (chants, lists) can be
  rejected; thresholds are deliberately conservative.

### D-013 — gpt-4o for Hinglish
- **Decision.** `CAPTION_LLM_MODEL` default `gpt-4o` (quality over cost).
- **Consequences.** ≈ ₹0.9/min — about half the hybrid pipeline's cost.
  Candidate change: gpt-4o-mini (≈ ₹0.05/min) after a quality comparison.

### D-014 — Chunking strategy
- **History.** 10 s chunks → one 120 s request (drift) → 30 s → ~20 s snapped to
  silences (Sarvam's 30 s cap) with a 0.5 s silence lead-in for chunk 0 and
  1.5 s real-audio overlap priming for later chunks, carried-forward context
  (Whisper prompt / Sarvam keyterms), protected no-speech window.
- **Consequences.** Robust boundaries; sequential processing (context order).

### D-015 — Hybrid: Sarvam text + Whisper timing
- **Context.** Sarvam recognizes Hindi/Hinglish far better than Whisper, but its
  REST API returns no per-word timestamps; Whisper gives word timestamps but
  worse words.
- **Decision.** Use each for what it is good at and stitch them.
- **Consequences.** Two paid calls per chunk; complex alignment; dependency on
  an OpenAI key. Now one of two engines (D-029).

### D-016 — Global alignment for stitching
- **Decision.** Needleman–Wunsch with fuzzy similarity; Sarvam-only words
  interpolated; Whisper-only words dropped as hallucinations; Sarvam run-on
  merges detected and split back to Whisper's segmentation.
- **Consequences.** Good results on real clips; the most intricate code in the
  repo; timing gaps interpolated evenly.

### D-019 — Three emphasis tiers
- **Decision.** support / feature / key from GPT, with target frequencies
  (key ≈ 1 in 10–15; feature 15–20 %); `important` kept for older UI.
- **Consequences.** Doodle Marker decorations depend on tiers; without GPT
  everything is support (no decorations).

### D-021 — Dual script
- **Decision.** Keep Sarvam's raw recognition in `word.original` and the Roman
  form in `word.text`; a project-level toggle chooses which renders/exports.
- **Consequences.** Devanagari needs Devanagari-capable fonts; non-capable
  template fonts fall back to Noto Sans Devanagari in export.

### D-023 — Dictionary over GPT for common words
- **Context.** GPT wrote wrong Roman spellings directly ("maim" for मैं, "apa" for आप).
- **Decision.** For ≈ 200 high-frequency words, a fixed spelling wins when GPT's
  answer is empty, Devanagari, or similar (≥ 0.5) to it; a very different GPT
  answer is treated as a deliberate context correction and kept.

### D-029 — Speech-engine dropdown; Sarvam-only default
- **Context (2026-10-27).** The owner's OpenAI key was invalid; he uses Whisper
  rarely and wants to stress-test Sarvam alone.
- **Decision.** Upload screen offers *Sarvam · no OpenAI key needed* (default)
  and *Whisper timing + Sarvam text · needs OpenAI key*. Stored per project as
  `stt_engine`; Re-listen reuses it. Sarvam-only uses Sarvam's phrase timestamps
  (`with_timestamps=True`) and spreads each phrase over its words by length.
- **Alternatives.** Forced alignment (D-037); ElevenLabs/Deepgram/AssemblyAI;
  local faster-whisper.
- **Consequences.** Works with no OpenAI; ≈ ₹0.49/min; word timing approximate
  inside phrases (good enough for phrase-level templates like Street Glow).
- **Evidence.** 38 s ad → 148 clean words in ≈ 6 s; full job ready in ≈ 27 s.

### D-031 — Offline Hinglish fallback
- **Decision.** If GPT fails, every word goes through the dictionary + an
  improved rule-based romanizer (Hindi schwa deletion via virama insertion,
  aa/ee/oo, nasal n, ड़→r) instead of failing the video.
- **Consequences.** Readable Hinglish without any LLM; emphasis all support;
  `reassign_emphasis` still requires GPT.

### D-032 — Name the real failure
- **Context.** A 401 from OpenAI on every chunk was swallowed and surfaced as
  "audio may be unclear"; a Windows temp-dir `PermissionError` then masked even that.
- **Decision.** `TranscriptionAuthError` for any provider credential/credit
  failure aborts the job with a message naming the provider and the fix; the
  preview task is always awaited before the temp dir is removed.

### D-037 — Real word timing for Sarvam text (open)
- **Options.** (a) Local forced alignment (WhisperX / wav2vec2 Hindi CTC): free,
  accurate, adds a ~1 GB model and CPU time. (b) Another engine with native word
  timestamps (ElevenLabs Scribe ≈ ₹0.32/min, Deepgram Nova-3 ≈ ₹0.46/min) — Hindi
  quality must be verified. (c) Keep Whisper hybrid when a key exists.
- **Recommendation.** (a), evaluated on the corpus against the hybrid.

---

## Engineering decisions

### D-003 — Stack and module split
- FastAPI (async) + Motor/MongoDB (schemaless project documents that grow with
  editor features) + React (CRA/craco). Backend split: `auth`, `caption_ai`
  (speech/LLM), `captions` (projects, layout, render), `payments`, `storage_service`.
- Consequence: `captions.py` (~1,700 lines) mixes API, layout and rendering — a
  future split into `layout.py` / `ass_writer.py` / `render.py` is advisable.

### D-004 — FFmpeg + libass for export
- **Why.** Mature, free, handles fonts/animation/positioning, runs everywhere;
  ASS supports per-word tags, moves, fades, transforms and vector drawings.
- **Cost.** A second renderer to keep in sync with CSS (D-025, D-033, D-035).

### D-009 / D-010 — Async jobs, Range media
- Jobs as in-process asyncio tasks with progress fields and startup resume
  (avoided Cloudflare 100 s timeouts in the Emergent era). Media served with
  HTTP Range and a parallel 720p VP9 WebM preview for smooth seeking.

### D-011 — Self-hosting
- Direct OpenAI/Sarvam keys, local disk storage behind a tiny put/get interface
  (swap for S3/R2 later), no platform lock-in.

### D-012 — Yarn 1
- `package.json` `resolutions` pins transitive deps to dodge an
  `ajv`/`ajv-keywords` crash in `react-scripts`; npm ignores `resolutions`.

### D-017 — Own Google OAuth
- Replaced Emergent-hosted auth; needs `GOOGLE_*` env and matching redirect URIs.

### D-020 — Synthesized SFX
- No licensed samples reachable during development; each SFX type is
  synthesized identically by Web Audio (editor) and FFmpeg lavfi (export).

### D-022 — Real bold only
- Bold requested only for Poppins and Caveat (bundled with real bold faces);
  avoids libass emboss vs browser synthesis mismatch. (Remaining violation:
  Street Glow line 1 inherits `font-weight:800` in CSS — fix under D-033.)

### D-024 — Styling layers with real blur
- Outline crisp in the main ASS; Shadow and Glow rendered as alpha+colour mask
  scripts, Gaussian-blurred by FFmpeg `gblur` (σ = blur × width/1080 × 1.1,
  measured against CSS), merged and overlaid under the text. Background uses
  ASS BorderStyle 3 and is exclusive with the others.

### D-025 — Native multi-line layout
- Rows of a caption are one Dialogue joined with `\N`, letting libass stack
  lines with font metrics, while CSS uses a calibrated line-height (1.47).
  The calibration was performed while libass font sizes were in different units
  from CSS (D-033); re-calibrate after that fix.

### D-028 — Vercel for the frontend only
- **Context.** Owner wanted to stop opening the local dev server.
- **Decision.** Vercel project rooted at `frontend/`, CRA preset,
  `REACT_APP_BACKEND_URL=http://localhost:8000`, SPA rewrite in
  `frontend/vercel.json`; the default branch auto-deploys. Root `vercel.json` and
  `.vercelignore` exist for a repo-root alternative. Backend not deployable on
  Vercel (long FFmpeg jobs, in-process tasks, local files).
- **Consequences.** The hosted UI works only where the backend runs; a tunnel is
  needed for other devices.

### D-033 — Fix the unit, not the constants (proposed)
- **Evidence.** libass `\fs` = OS/2 win cell height; CSS = em. Export text is
  ≈ 58 % (Anton) / ≈ 71 % (Playfair) of the preview's size; preview Anton is
  faux-bold; preview loads Google Fonts copies.
- **Decision.** Convert CSS px → ASS `\fs` per font with its real metrics; remove
  inherited weights; serve bundled fonts to the preview; then retune design
  constants with both renderers agreeing; place Street Glow lines by baseline.

### D-034 — Visual parity tests (proposed)
- Headless Chrome screenshot of the preview markup with bundled fonts vs an
  FFmpeg-burned frame from `_write_ass`, per template × word patterns; approved
  baseline images committed; CI-style script fails on box/pixel drift.
  Prevents "previously approved designs getting reopened".

### D-035 — Two renderers now, one spec later (proposed)
- Short term: keep CSS + libass, enforce with D-034. Medium term: a template
  spec (JSON: fonts, sizes, colours, line rules, animations) consumed by both;
  or render the preview from the export engine (libass compiled to WASM /
  server-rendered frames). Decide when adding the third template.

### D-036 — Documentation in the repo
- `CLAUDE.md` (agent rules) + `docs/` (summary, description, comprehensive,
  in-depth, decisions, tracker), so a new developer or a fresh agent account can
  pick the project up without the chat history.

### D-039 — Build on tscaps (proposed)
- **Context.** The owner identified https://github.com/francozanardi/tscaps as
  "step one" for the product. It renders captions as DOM/CSS for both preview
  and export (one renderer), ships a mature editor, ~40 CSS templates, splitters,
  taggers, script-aware font stacks and bidi. Its open-source build only has
  in-browser Whisper (weak on Hindi/Hinglish) and no LLM tagging.
- **Decision (proposed).** Option C in `docs/TSCAPS_INTEGRATION_PLAN.md`: fork
  `apps/studio` (AGPL-3.0) as Tadaaam Studio for now, embed
  `@tscaps/engine` (MIT), inject our transcriber through the studio's
  `ConfigurableTranscriber` hook, and refactor the FastAPI backend into a
  provider-agnostic Speech Service (Sarvam for words, Whisper for timing only,
  any future provider via a registry and routing table — see D-041). Keep proprietary logic in the backend; choose
  AGPL publication vs engine-only UI at the commercial gate.
- **Supersedes on completion.** D-004 (libass export), D-025, D-033, D-034's
  libass half, D-035 — all made moot by a single renderer.
- **Gate.** Phase 0 spike: Hinglish and Devanagari projects render and export
  correctly through the tscaps engine on the owner's PC.

### D-038 — Backend hosting (open)
- Options when needed: a small VPS (≈ ₹2,000/month) or a container platform
  (Render/Railway/Fly.io) with MongoDB Atlas and S3/R2 storage, plus a job queue.
  Not needed while the product is personal and local.

### D-040 — Product name: Tadaaam (2026-10-29)
- The owner renamed the product from "Captain Title" to **Tadaaam**. Docs,
  user-visible UI copy, the API title/health response, download filenames and
  new identifiers (schema `tadaaam.transcript/v1`, logger `tadaaam.*`) use the
  new name.
- **Not renamed** (to avoid breaking data or tests): the repo/folder
  `captain-title`, storage prefix `APP_NAME = "captain-title"` (existing
  uploads live under it), `data-testid` values, and existing logger names.

### D-041 — Sarvam decides the words; Whisper is timing only (2026-10-29)
- **Owner clarification.** Sarvam (saaras) is Tadaaam's speech-recognition
  AI. OpenAI Whisper is used only for word-level timecodes (the hybrid mode);
  its text is discarded. Sarvam-only (phrase timestamps spread to words) is the
  default; the owner rarely uses Whisper.
- **Encoded in code.** Provider capabilities carry a `role`: `sarvam` = `text`,
  `openai-whisper` = `timing`, `hybrid` = `text+timing`. The router never
  sends a transcription to a `timing`-only provider; Whisper can only be
  reached explicitly (for inspecting timing) or through `hybrid`.
- **Future.** Other recognisers (ElevenLabs, Deepgram, …) and forced aligners
  (MMS/WhisperX) plug in beside Sarvam; the evaluation script decides whether
  any of them beats Sarvam for a language.

### D-042 — Start with Phase 1 (Speech Service v2) before the tscaps spike (2026-10-29)
- **Context.** The owner chose to start the tscaps plan at Phase 1. Phase 1 is
  backend-only and useful whether or not tscaps is adopted.
- **Decision.** Build `backend/speech/` (provider protocol, registry, routing
  file, pipeline, Canonical Transcript, `/api/v2/*`). Keep v1 endpoints and
  the current editor working unchanged; `caption_ai.transcribe_words` is now a
  thin wrapper over the pipeline.
- **v2 jobs** live in the `transcriptions` collection; their audio sits in a
  temp dir, so a backend restart marks running jobs failed (resubmit). No
  credits are consumed by v2 yet (usage/auth integration is Phase 2).
- **Verified.** Same output as before on the toe-protector clip (148 words,
  identical repetition metrics); HTTP checks of all v2 endpoints.
