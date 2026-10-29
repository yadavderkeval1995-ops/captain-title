# CLAUDE.md — Tadaaam

This file is the first thing an AI coding agent (Claude Code or any other) should
read before touching this repository. It tells you what the project is, how to
run it, how the code is laid out, which rules you must not break, and where the
deeper documentation lives.

If you read only one other file, read `docs/IN_DEPTH.md` before changing the
transcription pipeline or the caption renderer — both have non-obvious
invariants that previous agents have broken more than once.

---

## 1. What this project is (one paragraph)

**Tadaaam** (formerly "Captain Title"; the repo folder is still `captain-title`) is a speech-to-caption web app for short-form video creators
in India. A user uploads a short vertical video (MP4/MOV, up to 120 seconds and
120 MB) of Hindi, English, or mixed "Hinglish" speech. The backend transcribes
it word by word — **Sarvam AI decides the words**; OpenAI Whisper is used only
for word-level timecodes in the optional hybrid mode, never for the text —
converts Devanagari Hindi into Roman-script Hinglish ("aap kaise ho", not
"आप कैसे हो"), and groups the words into animated on-screen captions using one
of two fixed motion-graphic templates (**Street Glow**, **Doodle Marker** — the
only two that exist today; more will be added later). The
user edits text, timing, grouping, position and styling in a browser editor
with a live CSS preview, then exports an MP4 with the captions burned in by
FFmpeg/libass (or an SRT file). It currently runs **locally** on the owner's
Windows PC; only the frontend is deployed (Vercel), and it talks to the backend
on `http://localhost:8000`.

---

## 2. Documentation map

| File | Read it when |
| --- | --- |
| `CLAUDE.md` (this file) | Always, first. Operating rules for agents. |
| `docs/SUMMARY.md` | You need the 2-minute version. |
| `docs/DESCRIPTION.md` | You need a product description / repo blurb / pitch. |
| `docs/COMPREHENSIVE.md` | You need the full product + system picture: context, goals, users, features, architecture, workflows, data model, API, roadmap. |
| `docs/IN_DEPTH.md` | You are changing code. Module-by-module internals, algorithms, thresholds, render engine, preview/export parity contract, known root causes. |
| `docs/DECISIONS.md` | You are about to reverse or revisit a design choice. Every significant decision, why it was made, and what it cost. |
| `docs/TRACKER.md` | You need the current issue list, bug status, and prioritized backlog. |
| `docs/TSCAPS_INTEGRATION_PLAN.md` | You are working on the move to the tscaps engine/studio, the provider-agnostic Speech Service, or multilingual support. Proposed direction as of 2026-10-27 (D-039). |
| `memory/PRD.md` | Historical. The original Emergent-era product record (Aug 2026). Partly out of date — see DECISIONS.md. |
| `README.md` | Human-facing setup guide. |

---

## 3. Repository layout

```
captain-title/
├── CLAUDE.md                 ← you are here
├── README.md
├── vercel.json               ← used only if a Vercel project is rooted at the repo root
├── .vercelignore             ← keeps backend + test media out of Vercel uploads
├── docs/                     ← all long-form documentation
├── memory/PRD.md             ← original product record (historical)
├── backend/                  ← FastAPI app (Python 3.12, run from this folder)
│   ├── server.py             ← app entry: Mongo client, indexes, routers, CORS, startup job resume
│   ├── auth.py               ← email/password + Google OAuth, cookie sessions, current_user dependency
│   ├── caption_ai.py         ← v1 wrapper over speech/ (engine → provider), GPT Hinglish conversion, emphasis
│   ├── speech/               ← Speech Service v2 (Phase 1): provider protocol, registry + routing.json,
│   │                            pipeline (chunking, safety rails, timing), providers/{sarvam,openai_whisper,hybrid},
│   │                            canonical.py (tadaaam.transcript/v1), romanize.py, api.py (/api/v2/*), tests/
│   ├── scripts/eval_wer.py   ← WER/CER per provider on backend/eval/corpus.json
│   ├── captions.py           ← projects API, background job, grouping, ASS writer, FFmpeg render, media/download
│   ├── payments.py           ← Stripe checkout/webhook (inactive: Stripe unusable for an Indian business)
│   ├── storage_service.py    ← local-disk object storage (put_object/get_object)
│   ├── fonts/                ← bundled TTFs used by libass at export time
│   ├── tests/                ← HTTP integration tests (need a running backend)
│   ├── requirements.txt
│   ├── .env.example          ← copy to .env (never commit .env)
│   └── .venv/                ← local virtualenv (not committed)
├── frontend/                 ← React 19 CRA app (craco), Yarn 1
│   ├── vercel.json           ← SPA rewrite for the Vercel project rooted at frontend/
│   ├── src/App.js            ← router: / (auth), /editor, /payment/*
│   ├── src/App.css           ← ALL editor + caption-template CSS (preview side of parity)
│   ├── src/lib/api.js        ← axios instance; REACT_APP_BACKEND_URL (falls back to localhost:8000)
│   ├── src/lib/sfx.js        ← Web Audio synthesized SFX (mirrors backend _sfx_source_filter)
│   └── src/components/       ← UploadStage, CaptionStudio (the editor), ThemePanel, Timeline, ...
├── *.mp4 / *.wav             ← real test clips (see §9) — keep, they are the regression corpus
└── *-headers / *-user / *.json ← Emergent-era test artifacts (safe, no secrets; candidates for cleanup)
```

`frontend/captain-title/` (untracked) is an accidental duplicate copy of the
repo from Oct 20. Ignore it; never commit it.

---

## 4. How to run it (Windows, the owner's machine)

### Backend
```powershell
cd C:\Users\Keval\Documents\captain-title\backend
.\.venv\Scripts\uvicorn.exe server:app --reload --port 8000
```
- Needs MongoDB reachable at `MONGO_URL` from `backend/.env`.
- `--reload` watches `.py` files only — **restart after editing `.env`**.
- `load_dotenv` does not override variables already set in the Windows
  environment; an old `OPENAI_API_KEY` set system-wide silently wins over `.env`.
- Health check: `GET http://localhost:8000/api/health`; API docs at `/docs`.

### Frontend
```powershell
cd C:\Users\Keval\Documents\captain-title\frontend
yarn install        # Yarn 1 only — package.json "resolutions" is ignored by npm
yarn start          # http://localhost:3000
```
`frontend/.env` holds `REACT_APP_BACKEND_URL=http://localhost:8000`.

### Production-style build (what Vercel runs)
```bash
cd frontend && CI=true npx craco build   # CI=true turns lint warnings into errors, like Vercel
```

### Tests
`backend/tests/` are **HTTP integration tests** against a live server; they read
`REACT_APP_BACKEND_URL` from the environment and register throwaway users.
They call real Sarvam/OpenAI and cost money. Run selectively:
```bash
cd backend && REACT_APP_BACKEND_URL=http://localhost:8000 .venv/Scripts/python -m pytest tests/test_iter5_media_range.py -q
```
There is no unit-test suite and no frontend test suite yet (see TRACKER.md).

### Shell notes for agents
- The user's shell is PowerShell; the agent Bash tool is Git Bash. Use forward slashes.
- Printing Devanagari from Python on this console needs `-X utf8` (or
  `PYTHONIOENCODING=utf-8` without `-I`), otherwise `UnicodeEncodeError: 'charmap'`.
- FFmpeg comes from `imageio_ffmpeg.get_ffmpeg_exe()`; there is no system ffmpeg on PATH.
- Chrome is at `C:\Program Files\Google\Chrome\Application\chrome.exe` (used for
  headless preview screenshots in visual parity checks).

---

## 5. Environment variables

Backend (`backend/.env`):

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGO_URL`, `DB_NAME` | yes | MongoDB connection |
| `SARVAM_API_KEY` | yes | Sarvam speech-to-text (text, and phrase timestamps in Sarvam-only mode) |
| `SARVAM_STT_MODEL` | no (default `saaras:v4`) | Sarvam model id |
| `OPENAI_API_KEY` | only for the Whisper engine and GPT Hinglish | Whisper word timing; GPT Hinglish conversion + emphasis |
| `CAPTION_LLM_MODEL` | no (default `gpt-4o`) | Chat model for Hinglish conversion / emphasis |
| `LOCAL_STORAGE_DIR` | no (default `backend/storage_data`) | Where uploads, previews, renders live |
| `UNLIMITED_TESTING` | no | `true` = any video ≤120s processes without spending credits |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | no | Google sign-in (email/password works without) |
| `FRONTEND_URL` | no (default `http://localhost:3000`) | Where Google OAuth redirects back to |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | no | Payments (dormant) |

Frontend: `REACT_APP_BACKEND_URL` (build-time; falls back to `http://localhost:8000`).

**Never print, log, echo, or commit keys.** `.env` files are git-ignored. The
GitHub repo `yadavderkeval1995-ops/captain-title` is **public**.

---

## 6. Architecture in 30 lines

```
Browser (React editor, CSS live preview)
   │  axios, cookie session (session_token, SameSite=None; Secure)
   ▼
FastAPI (backend/server.py)
   ├── /api/auth/*        auth.py         users, user_sessions (Mongo)
   ├── /api/usage         captions.py     usage (credits)
   ├── /api/projects/*    captions.py     projects (Mongo) + storage_service (disk)
   │      POST /projects/process  → stores upload, inserts project{status:queued}, schedules job
   │      background job (asyncio task, same process):
   │          ffmpeg → 16 kHz mono WAV  ──┬─► transcribe_words(engine)   caption_ai.py
   │                                      │      → speech.pipeline.transcribe(provider)
   │                                      │      sarvam:  Sarvam text + phrase timestamps → spread to words
   │                                      │      whisper → provider "hybrid": Sarvam text on Whisper word timing
   │                                      ├─► convert_to_hinglish (GPT, offline fallback)
   │          ffmpeg → 720p VP9 WebM preview (parallel)
   │          project{status:ready, words[...]}
   │      PUT  /projects/{id}     save editor state (ProjectEdit)
   │      POST /projects/{id}/render → _write_ass (+ blur mask .ass files) → _render (ffmpeg/libass) → MP4
   │      GET  /projects/{id}/media (HTTP Range) | /download | /srt
   ├── /api/payments/*    payments.py     Stripe (dormant)
   └── /api/v2/*          speech/api.py   transcriptions (Mongo): POST /transcriptions → 202 {job_id};
                                          GET /transcriptions/{id} → Canonical Transcript; GET /providers, /languages
```

Everything runs in one Python process. There is no job queue, no worker, no
object store, no CDN. Jobs interrupted by a restart are resumed at startup
(`resume_pending_projects`).

---

## 7. The rules you must not break

### 7.1 Preview/export parity is the core invariant
The editor shows captions with **CSS in the browser**
(`CaptionStudio.jsx` + `App.css`). The export draws them with **libass inside
FFmpeg** (`captions.py::_write_ass` + `_render`). These are two independent
renderers that must produce the same picture. Every layout constant and every
grouping/line-break rule exists **twice** and must change **together**:

| Backend (`captions.py`) | Frontend |
| --- | --- |
| `THEMES` | `ThemePanel.jsx::templates`, `App.css` `.street-glow-*`, `.doodle-*` |
| `STREET_GLOW_LINE1_SIZE/LINE2_SIZE/GAP_PX` (72/44/-8) | `StreetGlowOverlay` literals `72`, `44`, `-8` |
| `_group_words_for_display` + per-theme `default_max_words`/`min_display` in `_write_ass` | `groupWordsForDisplay` |
| `_auto_line_breaks` / `_resolve_line_breaks` / `_split_rows` | `autoLineBreaks` / `splitIntoRows` |
| `POSITION_DEFAULTS` (top 14 / middle 50 / bottom 80 %) | `POSITION_DEFAULTS`, `TRANSFORM_Y_PRESETS` |
| `BOLD_CAPABLE_FONTS` | `isBoldCapableFont` |
| `_shadow_offset` | `shadowOffset` |
| `POP_IN_MS/POP_OUT_MS/POP_SCALE` | `.caption-overlay span.active` |
| `DEFAULT_EMPHASIZE_ACCENT` `#EAB308` | `.emphasize-accent`, `glowShadowFor` |
| `_sfx_source_filter` | `lib/sfx.js` |
| `WordEdit` field bounds (font_size 16–120, rotation ±45 …) | `setCaptionScale` clamps, sliders |

If you change one side, change the other in the same commit, and verify
visually (see §8). **Known, measured parity gaps exist today** — libass sizes
fonts by the OS/2 cell height while CSS sizes by em, so exported text is
~58 % (Anton) / ~71 % (Playfair) of the preview size. Details and the fix plan
are in `docs/IN_DEPTH.md §7` and `docs/TRACKER.md`. Do not "fix" sizes by
tweaking one side's constants by eye; fix the unit conversion.

### 7.2 Transcription safety rails stay on regardless of engine
Repetition/hallucination rejection (unique ratio, bigram ratio, n-gram
repeats), chunk-overlap de-duplication, `_normalize_word_timings`, and
"never let Devanagari leak into `word.text`" are product guarantees, not
tuning knobs. Keep them for any new engine.

### 7.3 `word.text` is always Roman; `word.original` is the engine's raw text
`word.text` is what Roman mode renders everywhere. It must never contain
Devanagari — every path into it goes through `_romanize_fallback`.
`word.original` keeps Sarvam's raw recognition (Devanagari for Hindi) and powers
the "native script" toggle and sentence-end detection (punctuation lives there).

### 7.4 `word.index` is a dense array position
After any insert/delete/split/merge, re-number `index` to `0..n-1`. Several
editor operations (delete, selection) match on `index`.

### 7.5 Credits are consumed only on success
`_run_caption_job` deducts usage only after the project reaches `ready`.
Re-listen never consumes a credit.

### 7.6 Errors must name their real cause
A provider key/credit failure must surface as that (see
`TranscriptionAuthError`), never as "audio may be unclear". Don't add bare
`except Exception: pass`; log with `logger.exception`.

### 7.7 Windows is the primary runtime
- FFmpeg filter args: never embed an absolute Windows path (the drive-letter
  colon breaks filtergraph parsing). `_render` runs FFmpeg with `cwd` = the temp
  dir and uses relative paths — follow that pattern.
- A temp directory cannot be deleted while a child process still has a file in
  it open. Await/gather background subprocess tasks before leaving a
  `TemporaryDirectory` block (see the preview task in `_run_caption_job`).

---

## 8. How to verify a change (do this, don't just reason)

- **Pipeline changes:** run `transcribe_words` + `convert_to_hinglish` on the
  real clips in the repo root (`hindi-hinglish-test.wav`, `toe-20-30-clean.wav`,
  `toe-protector-source.wav`) with `load_dotenv(backend/.env)`, print
  `start-end original -> text`. Then run `_run_caption_job` with a stub DB
  (pattern in `docs/IN_DEPTH.md §11`) to cover the full job.
- **Render changes:** generate an `.ass` with `_write_ass`, burn single frames
  with `ffmpeg -f lavfi -i color=... -vf subtitles=x.ass:fontsdir=<rel fonts>`,
  and compare against a headless-Chrome screenshot of the same caption markup
  using the **bundled** fonts via `@font-face`. Look at the images.
- **Speech service changes:** `python -X utf8 -m pytest speech/tests -n 0` (offline,
  no keys). Provider error mapping against real APIs with fake keys:
  `TADAAAM_NETWORK_TESTS=1` in front of the same command. Accuracy:
  `python -X utf8 scripts/eval_wer.py --providers sarvam hybrid`.
- **Frontend changes:** `CI=true npx craco build` must pass (Vercel uses CI=true).
- State what you verified and how. If you could not run something, say so.

---

## 9. Test corpus (repo root)

| File | What it is |
| --- | --- |
| `toe-protector-source.mp4/.wav` | The owner's real 37.78 s cricket toe-protector ad: fast Hinglish + music. Historical hallucination case ("YouTube protector"). Sarvam-only now yields 148 clean words. |
| `toe-20-30.wav`, `toe-20-30-clean.wav` | 10 s slice of the ad |
| `hindi-hinglish-test.mp4/.wav` | ~6 s clean Hindi/English sentence (15 words) |
| `flying-beast-source.mp4` | 64.66 s / 85.5 MB long-upload test (Cloudflare timeout era) |
| `captain-sample.mp4`, `captain-speech.wav`, `captain-rendered.mp4` | Early samples |
| `toe-preview.webm`, `toe-served.mp4` | Preview/served-media artifacts |

---

## 10. Git and deployment conventions

- Default branch on GitHub: `backup-before-pro-editor-redesign` (despite the
  name, it is the live default and Vercel's production branch).
- Working branch: `claude/caption-generator-website-w3wrn7`. Collaborator
  `DhawalDonny93` merges PRs into the default branch — fetch before pushing; never force-push.
- No global git identity is configured on the machine; previous commits use
  `git -c user.name=Claude -c user.email=noreply@anthropic.com commit ...`.
- Vercel project "captain-title" (team Tadaaam, Hobby) is rooted at `frontend/`,
  preset Create React App, env `REACT_APP_BACKEND_URL=http://localhost:8000`.
  Every push to the default branch redeploys. The backend is never deployed.
- Commit or push only when the owner asks.

---

## 11. Code style in this repo

- Python: plain functions, module-level constants in CAPS, `async` FastAPI
  handlers, blocking work wrapped in `asyncio.to_thread`. Pydantic v2 models for
  request bodies. Mongo projections always exclude `_id`.
- Comments are long and explain *why* (often citing the bug that motivated the
  code and the mirrored function on the other side). Match that density when
  editing nearby; keep new comments factual.
- React: function components, hooks, no state library; the editor state lives
  in `CaptionStudio` and is passed down as props. CSS is hand-written in
  `App.css` (Tailwind/shadcn exist but most editor UI does not use them).
- `data-testid` attributes are on most interactive elements; keep adding them.

---

## 12. Current state (2026-10-29) — read before starting work

- **Owner rules (2026-10-29):** the product is **Tadaaam** (D-040); **Sarvam
  decides the words, Whisper is timecodes only** (D-041 — never route text work
  to Whisper); only **two templates** exist (Street Glow, Doodle Marker).
- **Phase 1 of `docs/TSCAPS_INTEGRATION_PLAN.md` is built** (D-042, TRACKER X-01):
  `backend/speech/` + `/api/v2/*`. Remaining: the owner hand-corrects the
  3 draft references in `backend/eval/references/`, then the WER table is run.
- **Committed on `claude/caption-generator-website-w3wrn7` (2026-10-29, not yet
  pushed):** `43800cb` engine dropdown, `221ceb6` Speech Service v2 (includes the
  2026-10-27 Sarvam-only engine, auth errors, offline Hinglish fallback and
  temp-dir fix), `58b5a8f` rename to Tadaaam, then the docs commit.
- Left untracked on purpose: `backend/eval/references/*.draft.txt` (machine
  drafts — commit the hand-corrected `<stem>.txt` instead), `backend/backend.log`,
  `frontend/captain-title/`.
- The owner's OpenAI key is currently invalid (401). Sarvam-only mode works without it.
- Open high-priority items: Street Glow placement/size parity, caption grouping
  quality, the `palettes is not defined` crash on Street Glow emphasis edits.
  See `docs/TRACKER.md`.
- Several items in an earlier status table were reported as "implemented" but do
  **not exist in git** (DP grouping, width-fit safety net, Street Glow
  progressive reveal behind flags). Always confirm a claimed feature with `git grep`
  before building on it.
