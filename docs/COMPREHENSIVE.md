# Tadaaam — Comprehensive Project Document

*Version: 2026-10-27. Owner: Keval (`yadavderkeval1995-ops`). Audience: anyone —
human or AI agent — who needs the full picture of this project without having
been part of building it. For code-level internals see `docs/IN_DEPTH.md`; for
the reasoning behind each choice see `docs/DECISIONS.md`; for the live issue
list see `docs/TRACKER.md`.*

---

## Contents

1. Context and history
2. The problem
3. The end goal and principles
4. Users and use cases
5. Product: what exists today
6. User workflows (step by step)
7. System architecture
8. The transcription workflow
9. The Hinglish conversion workflow
10. The caption layout and template workflow
11. The editor
12. The export workflow
13. Data model
14. API reference
15. Accounts, usage limits and payments
16. Storage and media
17. Configuration
18. Running, deploying and operating
19. Cost model and pricing
20. Quality: testing and verification
21. Known problems and risks
22. Roadmap: features we can add
23. Glossary

---

## 1. Context and history

### 1.1 Origin (August 2026, Emergent platform)

The project began on **2026-08-05** on the Emergent agent platform
(`emergent.sh`; commits authored by `emergent-agent-e1`). The original brief,
verbatim:

> "hey you are caption generator and your name is captain title, i want you to
> generate creative font and mixed font captions after transcripting videos into
> hinglish, word to word, and do creative fonts and colour and gradients"

The Emergent build (recorded in `memory/PRD.md`) delivered:

- Email/password and Emergent-hosted Google login.
- A Whisper → GPT pipeline (OpenAI `whisper-1` and a GPT model via Emergent's
  "universal key") producing timed, Roman-Hinglish words with an important-word flag.
- Emergent Object Storage for uploads and renders.
- An editor with four themes (Viral, Cinematic, Minimal, Podcast), transcript
  editing, a word timeline, save/render/download.
- Free/one-off/Basic credits and Stripe code (Stripe sandbox was unavailable for
  business country IN, so checkout was disabled rather than faked).
- A run of fixes driven by the owner's real ad video (`toe-protector-source.mp4`),
  where forced-Hindi Whisper hallucinated "YouTube protector" over music:
  adaptive chunking, no-speech filtering, repetition rejection, an `uncertain`
  word flag and a **Re-listen** button.
- A background job with progress polling (to avoid Cloudflare timeouts on
  60–120 s uploads), and HTTP Range + WebM previews for smooth seeking.

Artifacts of that era remain in the repo root (`*-headers`, `*-user`,
`*-result.json`, `test_reports/`, `.emergent/`, `.gitconfig`).

### 1.2 Self-hosting (September 2026)

On **2026-09-16** the backend was decoupled from Emergent for personal,
self-hosted use: the universal key was replaced by a direct OpenAI key, Emergent
storage by local disk (`storage_service.py`), and later (2026-10-19) Emergent
OAuth by a real Google OAuth client. Frontend installs moved from npm to Yarn to
fix an `ajv`/`ajv-keywords` crash in `react-scripts`.

### 1.3 Sarvam and the pro editor (October 2026)

Between 2026-10-17 and 2026-10-24 (working branch
`claude/caption-generator-website-w3wrn7`, built with Claude Code):

- Transcription moved to **Sarvam AI** (Saaras) for text, with Whisper kept only
  for per-word timing — the "hybrid" pipeline.
- Chunking was rebuilt: ~20 s chunks snapped to silences, real-audio overlap
  priming, carried-forward context (Whisper prompt / Sarvam keyterms).
- The editor was redesigned after **Captik** (a commercial caption app): left
  icon rail, center 9:16 canvas, right style panel, a three-lane timeline,
  a "FOR THIS MOMENT" per-word popover, kinetic animations, SFX markers,
  dual-script display, stickers and text layers.
- Styling grew into independent Outline / Shadow / Glow / Background layers
  with real Gaussian blur in the export.
- Many templates were added and then **all replaced** (2026-10-22) by two fixed
  motion-graphic designs: **Street Glow** and **Doodle Marker**.
- A series of preview/export parity fixes, Hindi romanization fixes, and a
  Sarvam word-merge fix that turned out to be a CSS whitespace bug.
- A collaborator (`DhawalDonny93`) merged PR #4 into the default branch on 2026-10-23.

### 1.4 This session (2026-10-27)

- A pricing analysis was written (https://claude.ai/artifact/DhiTaqHdRMUZYKrLiFuNqS).
- The frontend was deployed to **Vercel** from GitHub (project rooted at `frontend/`).
- The owner's OpenAI key turned out to be invalid. Two hidden bugs made that hard to see;
  both were fixed.
- A **Speech Engine dropdown** was added: Sarvam-only (default, no OpenAI) vs
  Whisper timing + Sarvam text. Sarvam-only uses Sarvam's phrase-level
  timestamps. When GPT is unavailable, an improved offline romanizer is used.
- The Street Glow placement problem was investigated with real render/screenshot
  comparisons; the root cause (font-size unit mismatch + preview faux-bold) was
  measured but not yet fixed.
- This documentation set was written.

---

## 2. The problem

1. **Language.** Indian creators mostly speak Hinglish. Captions are expected in
   *Roman* script, spelled the way people text ("kya", "hain", "nahin"), with
   English words left as English. Speech engines return Devanagari for Hindi,
   or translate, or anglicize badly.
2. **Recognition quality.** Generic models (Whisper) hallucinate on Hindi over
   music, repeat phrases, and mangle code-mixed words. India-first models
   (Sarvam) recognize Hinglish far better but don't return per-word timestamps.
3. **Timing.** Word-by-word captions need per-word start/end times; phrase-level
   times produce captions that drift or flash.
4. **Design.** The captions that perform on Reels are designed: two-tone
   headline/subline lockups, highlighter wipes, pops. Doing that by hand per
   video is slow.
5. **Fidelity.** What the creator approves in the editor must be exactly what
   the exported video shows.

---

## 3. The end goal and principles

### 3.1 End goal

A **dependable, cheap, local-first Hinglish captioning studio** that the owner
uses daily for his own videos, whose editor preview is pixel-faithful to the
export, and which can later become a paid product for Indian creators
(minute-based plans priced in INR).

### 3.2 Near-term goal (stated by the owner)

Run everything **locally** (no production deployment yet), stress-test the
Sarvam pipeline on real videos, and fix the caption-design issues so approved
designs stay approved.

### 3.3 Principles

- **Say exactly what was said.** Never paraphrase, translate, reorder or add
  words. Correct only unambiguous ASR spelling errors.
- **Roman Hinglish is the default output**; native Devanagari is an option.
- **Honest uncertainty.** Flag uncertain words; reject repetitive/hallucinated
  chunks rather than show them; name the real cause of failures.
- **Preview = export.** One layout, two renderers kept in lockstep; verify by
  looking at real frames.
- **Local-first and cheap.** Prefer engines and steps that cost little per
  minute and degrade gracefully when a paid API is unavailable.
- **Designed, not skinned.** Templates are complete motion designs with their
  own fonts, colours and animation, not generic colour swaps.

---

## 4. Users and use cases

| Persona | Need | Typical clip |
| --- | --- | --- |
| Short-form creator (primary; the owner) | Fast, accurate Hinglish captions in a viral style | 15–90 s talking head / product ad |
| Podcast/video editor | Readable captions for many clips, quick fixes | 30–120 s podcast cut |
| Solo brand/product seller | Product ad with brand names spelled right | 30–60 s ad over music |

Use cases: caption a new reel; fix a mis-heard brand name; restyle all
captions; move captions out of the way of on-screen text; add a sound effect on
a punchline; export for Instagram (MP4) or YouTube (SRT).

---

## 5. Product: what exists today

### 5.1 Feature inventory

**Upload & processing**
- MP4/MOV, ≤ 120 MB, ≤ 120 s (validated client-side and server-side).
- Speech Engine dropdown: *Sarvam* (default) or *Whisper timing + Sarvam text*.
- Speech Mode buttons: *Adaptive Hinglish* (auto language) or *Hindi only*.
- Background processing with live progress labels ("Preparing audio" →
  "Listening word by word" → "Creating Roman Hinglish" → "Captions ready").
- Jobs survive a backend restart (resumed on startup).

**Transcript**
- Word list grouped into readable cards; raw "what the engine heard" transcript
  visible; uncertain words flagged.
- Inline text edits; per-word popover (double-click / right-click): edit text,
  toggle a line break before the word, split a word, set emphasis tier.
- Re-listen: re-run transcription for the project (no credit used).
- Script toggle: Roman Hinglish (`word.text`) or native script (`word.original`).

**Captions & templates**
- Two templates: Street Glow, Doodle Marker (details in §10).
- Words-per-caption (Auto or 1–8), caption lines (1/2), position preset
  (top/middle/bottom), per-caption drag, scale, rotation, "apply to all", reset.
- Manual caption split ("Split at playhead", split before a word) and merge
  ("merge up").
- Per-word "FOR THIS MOMENT" popover: text, line break, merge with previous/next,
  kinetic animation (pulse/pop/scale/box/wobble — preview only), accent
  emphasize (exported), add SFX at the word.

**Styling (project-wide)**
- Font (10 bundled families), Bold/Italic (real bold only where a bold face exists).
- Outline (width, colour), Shadow (angle, distance, blur, opacity, colour),
  Glow (colour or "word colour", blur, opacity), Background box (colour,
  opacity; mutually exclusive with outline/shadow/glow).
- Safe-zone overlay toggle for platform UI areas.

**Other layers**
- Elements: 12 Unicode stickers (★ ♥ ✓ ✗ ➤ ⚡ ☀ ☁ ♪ ✦ ❄ ⚑), timed, positioned,
  sized, coloured, front/behind captions.
- Text layers: free text with a font choice, same controls.
- SFX markers: whoosh, bass drop, pop, cash, shutter (synthesized; identical in
  editor and export).
- Audio: volume 0–200 %, mute. Adjustment: brightness, contrast, saturation.

**AI tools**
- Filler-word scan (English + Hinglish fillers like "um", "matlab",
  "basically") with one-click or bulk removal (local, free).
- Re-run AI emphasis (GPT re-tags support/feature/key on edited text).

**Export**
- MP4 render (High: x264 medium CRF 17; Draft: veryfast CRF 26; AAC 192k),
  at the source's resolution, 5-minute timeout.
- SRT download (one cue per word).

**Accounts**
- Email/password; Google sign-in (needs own OAuth client); 7-day sessions.
- Usage display and paywall dialog (credits model; see §15).

### 5.2 What does not exist yet (commonly assumed)

- No list of past projects / project history (a project is only reachable from
  the session that created it, by id).
- No trimming, no VTT, no transparent-overlay export, no brand kits, no custom
  font upload, no team accounts, no job queue, no cloud storage.
- No automated visual regression tests; no unit tests.
- "DP caption grouping", "width-fit safety net" and "Street Glow progressive
  reveal behind flags" were reported in an earlier status table but are **not
  in the code** (verified 2026-10-27 across all branches).

---

## 6. User workflows (step by step)

### 6.1 Sign in
1. Open the app (`/`). `App.js` calls `GET /api/auth/me`; with a valid session
   cookie it redirects to `/editor`.
2. Otherwise the AuthScreen offers register / login (email + password ≥ 8
   chars) or "Continue with Google" (`GET /api/auth/google/login` → Google →
   `/api/auth/google/callback` → cookie set → redirect to `FRONTEND_URL/editor`).

### 6.2 Create captions
1. On `/editor` with no open project, **UploadStage** shows the dropzone, the
   Speech Engine dropdown and the Speech Mode buttons.
2. Choosing a file probes its duration in the browser (rejects > 120 s).
3. **Generate Hinglish captions** posts multipart `file`, `theme=street_glow`,
   `speech_language`, `stt_engine` to `POST /api/projects/process`.
4. The server validates, measures duration/resolution with FFmpeg, checks the
   user's entitlement (402 → paywall), stores the file, inserts the project
   with `status: queued`, schedules the background job and returns the project.
5. The page polls `GET /api/projects/{id}` every 2.5 s, showing `progress` and
   `processing_label`, until `ready` (opens the editor) or `failed` (toast with
   `error_message`).

### 6.3 Edit
1. The editor loads the project; the video plays from `GET /media` (WebM
   preview if built, else the source) with Range requests.
2. The live caption overlay follows the playhead (polled every animation frame
   while playing).
3. Edits change local React state only; **Save** (`PUT /api/projects/{id}`)
   persists the whole editor state.

### 6.4 Export
1. **Export/Render** saves first (`PUT`), then `POST /render` (client timeout
   330 s > server 300 s).
2. The server writes the ASS script and mask scripts, runs FFmpeg, stores the
   MP4, sets `status: rendered`, returns a download URL.
3. **Download** fetches `GET /download` as a blob. **SRT** saves, then fetches
   `GET /srt`.

### 6.5 Re-listen
`POST /retranscribe {speech_language, stt_engine?}` resets words and re-queues
the job (engine defaults to the project's own); the editor polls until done.

### 6.6 AI emphasis
`POST /ai/emphasis` → GPT re-tags tiers on the current text → colours/sizes
re-baked from the template → words returned and saved.

---

## 7. System architecture

```
┌──────────────────────────── Browser ────────────────────────────┐
│ React 19 SPA (CRA/craco)                                          │
│  App.js router ─ AuthScreen ─ EditorPage ─┬─ UploadStage           │
│                                            └─ CaptionStudio (editor)│
│  CSS live preview (App.css)   Web Audio SFX (lib/sfx.js)           │
└───────────────┬──────────────────────────────────────────────────┘
                │ HTTPS (Vercel) or http://localhost:3000 → http://localhost:8000
                │ axios withCredentials, cookie "session_token"
┌───────────────▼──────────────── FastAPI (one process) ───────────┐
│ server.py: CORS (any origin, credentials), routers, Mongo indexes │
│ auth.py      /api/auth/*      bcrypt, sessions, Google OAuth       │
│ captions.py  /api/usage, /api/projects/*                          │
│   ├─ background job (asyncio task): audio → transcribe → Hinglish │
│   ├─ grouping + ASS writer + FFmpeg render                        │
│   └─ media (Range), download, SRT                                 │
│ caption_ai.py  Sarvam / Whisper / alignment / GPT / romanizer     │
│ payments.py  /api/payments/*  Stripe (dormant)                    │
│ storage_service.py  local disk                                    │
└───────┬───────────────┬───────────────┬───────────────┬──────────┘
        │               │               │               │
   MongoDB         Sarvam API      OpenAI API      FFmpeg (imageio-ffmpeg,
   (Motor)      (speech-to-text)  (Whisper, GPT)   libass, x264, VP9)
```

Key properties:

- **Single process, no queue.** Background jobs are `asyncio.create_task`s; an
  in-memory `active_jobs` set prevents duplicate scheduling; on startup,
  `resume_pending_projects` re-schedules up to 100 `queued`/`processing` projects.
- **Blocking work off the event loop.** FFmpeg calls and file I/O run via
  `asyncio.to_thread`.
- **Stateless frontend.** All persisted state is the project document; the
  editor holds a working copy until Save.
- **Two renderers.** The browser renders captions with CSS for the preview;
  libass renders them for the export. See §10 and `IN_DEPTH.md §7`.

---

## 8. The transcription workflow

```
source video ──ffmpeg──► speech.wav (mono, 16 kHz, PCM s16le)
                         │
                         ├─ silencedetect (-35 dB, ≥ 0.3 s) → pause midpoints
                         ├─ chunk boundaries every ~20 s, snapped to a pause within ±2 s
                         └─ chunk files:
                              chunk 0: 0.5 s of silence + audio
                              chunk k: 1.5 s of the previous chunk's tail (priming) + audio
for each chunk:
   engine = "sarvam":
       Sarvam saaras:v4, mode=codemix, with_timestamps=true, keyterms=recent words
       → phrase timestamps → each phrase's span shared among its words by length
   engine = "whisper":
       Whisper whisper-1 verbose_json word timestamps (prompt = recent words)
       → drop late segments with no_speech_prob ≥ 0.65; trust if avg_logprob > -1.45
       Sarvam text (no timestamps)
       → global alignment (Needleman-Wunsch, fuzzy similarity) of Whisper words vs Sarvam words
       → Sarvam's words placed on Whisper's timing; Sarvam-only words interpolated;
         Whisper-only words dropped as likely hallucinations; Sarvam run-on merges split back
   reject chunk if repetitive (≥12 tokens and unique ratio < .24 or top bigram > 30 %, or a 4-gram ×3)
   shift to absolute time; drop words inside the priming overlap
   carry the last 40 words forward as context
join chunks → normalize timings (monotonic, ≥ 60 ms, no overlap) → overall repetition check
```

Engine comparison:

| | Sarvam-only (default) | Whisper timing + Sarvam text |
| --- | --- | --- |
| Needs | `SARVAM_API_KEY` | `SARVAM_API_KEY` + working `OPENAI_API_KEY` |
| Word text | Sarvam | Sarvam (aligned onto Whisper slots) |
| Word timing | Estimated inside each Sarvam phrase (proportional to word length) | Whisper's real per-word timestamps |
| Cost/min (approx.) | ₹0.49 | ₹0.49 + ₹0.53 |
| Failure modes | Timing drift inside long phrases | Whisper hallucination/merges; key/credit problems |
| Measured | 38 s ad → 148 words in ~6 s, no repetition | Historically good timing; currently untested (invalid key) |

Errors: a rejected key or exhausted account at either provider raises
`TranscriptionAuthError` and the project fails with that exact message.

---

## 9. The Hinglish conversion workflow

1. All words are sent once to GPT (`CAPTION_LLM_MODEL`, default `gpt-4o`,
   temperature 0) as `index: original` lines with strict instructions: keep one
   token per index, never paraphrase/merge/reorder, keep English as is, correct
   only obvious ASR spelling errors, return `{index, text, emphasis, uncertain}`.
2. For each word, the final `text` is chosen with this precedence:
   1. a **common-word dictionary** (≈ 200 high-frequency Hindi words → their one
      accepted spelling: है→hai, हैं→hain, आप→aap, नहीं→nahin, लिए→liye …) when
      GPT's answer is empty, Devanagari, or close (similarity ≥ 0.5) to it;
   2. GPT's text;
   3. the raw word —
   and the result always passes through the **offline romanizer**, so Devanagari
   can never reach `word.text`.
3. If GPT fails entirely (bad key, no credit, invalid JSON), every word goes
   through the dictionary + offline romanizer, with `emphasis = support`.
   The offline romanizer applies Hindi **schwa deletion** (आज→aaj, अगर→agar,
   करवाना→karvaana, जानना→jaanna), long-vowel doubling (aa/ee/oo except word-final),
   nasal handling (दोस्तों→doston, कहाँ→kahaan) and ड़/ढ़ → r/rh.
4. Emphasis tiers: **key** ≈ 1 word in 10–15 (the punch: number, strong verb,
   brand), **feature** ≈ 15–20 % (secondary notable), **support** the rest.
   `important = emphasis != support` is kept for older UI.

---

## 10. The caption layout and template workflow

### 10.1 Grouping words into captions
Greedy, left to right (`_group_words_for_display` ↔ `groupWordsForDisplay`):
a group grows while all hold — fewer than `max_words` words; previous word does
not end a sentence (`. ! ? । ॥` in `word.original`); gap to the next word
< 0.4 s; and (unless a fixed words-per-caption is set) the group has been on
screen < `min_display`. Manual overrides: `new_caption: true` forces a new group
at that word, `false` forces it into the previous group.

| Template | max words (Auto) | min display |
| --- | --- | --- |
| Street Glow | 6 | 1.5 s |
| Doodle Marker | 3 | 1.5 s |

### 10.2 Street Glow (line-based)
- Splits each group into two lines at the word midpoint (`ceil(n/2)`), unless a
  word's `new_line` overrides.
- **Line 1 (headline):** Anton, UPPERCASE, red `#FF2E2E`, 72 px (1080-wide
  canvas units), red neon glow (blur 10, opacity 0.85); pops in (scale to 108 %
  over 160 ms, back to 100 % by 240 ms).
- **Line 2 (subline):** Playfair Display SemiBold Italic, white, 44 px, soft
  black shadow (blur 3, opacity 0.55); glides up 18 px over 220 ms with a fade.
- Lines stacked with a −8 px gap; each line horizontally centred on the caption
  anchor. Ignores per-word colour/size and the project's Shadow/Glow panel —
  the template owns its look.

### 10.3 Doodle Marker (word-based)
- Caveat 56 px for every word; single line (3 words max; the preview shrinks the
  row to fit 84 % of the frame width, down to 45 %).
- `key` words: black text on a yellow `#FACC15` highlighter pill revealed left
  to right (180 ms; 6 stepped frames in export).
- `feature` words: a red `#EF4444` hand-drawn pencil loop drawn around the
  word (220 ms; 6 stepped frames in export). `support` words are plain white.
- Decorations depend on emphasis tiers, which come from GPT. When GPT is
  unavailable every word is `support`, so Doodle Marker shows no pills or loops
  until tiers are set by hand (word popover) or by "Re-run AI emphasis".

### 10.4 Placement
Caption centre = the group's first word's `pos_x/pos_y` if set (dragged), else
the project's preset: top 14 %, middle 50 %, bottom 80 % of the frame height,
50 % width. Rotation is per caption (first word), ±45°.

---

## 11. The editor

Layout (Captik-inspired):

- **Header:** project name, usage, pricing, logout.
- **Left rail:** Media · Audio · Text · Elements · Captions · Adjustment · AI tools.
  Each switches the left panel (Captions = TranscriptPanel).
- **Centre:** 9:16 video frame sized to the available area; caption overlay;
  sticker/text overlays; safe-zone overlay; resize handles; drag to move.
- **Right panel (ThemePanel), tabs:** Templates · Customize (layout + Outline/
  Shadow/Glow/Background) · Text (selected word) · Transform (position, scale,
  rotation, apply to all, reset).
- **Bottom timeline:** controls (play, split at playhead, words/lines mode,
  zoom, SFX palette), ruler, a captions lane, a filmstrip lane (thumbnail every
  ~2.5 s), a waveform lane (real decoded audio, with a synthetic fallback).
- **Command bar:** Save, render quality, Export, Download, SRT.
- **Moment popover:** opens next to the clicked word anywhere.

`previewScale = frameWidth / 1080` converts the export's 1080-wide canvas units
to preview pixels.

---

## 12. The export workflow

1. Write `captions.ass` (PlayRes 1080×1920, WrapStyle 2): one Dialogue per
   caption group (generic path) or one per line (Street Glow), plus element
   overlays, plus Doodle decorations.
2. Write up to four mask scripts (shadow alpha/colour, glow alpha/colour).
3. FFmpeg filter graph: colour grade (`eq`) → glow layer (masks rendered on
   black, Gaussian-blurred with `gblur`, merged with `alphamerge`, overlaid) →
   shadow layer → burn the main ASS with `subtitles` (fonts from
   `backend/fonts`) → x264. Audio: volume, plus each SFX synthesized with
   `lavfi` sources, panned, delayed and mixed (`amix normalize=0`).
4. Store the MP4 under `renders/`, set `render_path`, `status: rendered`.

---

## 13. Data model (MongoDB)

| Collection | Key fields | Indexes |
| --- | --- | --- |
| `users` | `user_id` (`user_<12 hex>`), `email` (lower-case), `name`, `picture`, `plan`, `password_hash` (bcrypt; absent for Google-only), `created_at` | `email` unique |
| `user_sessions` | `session_token` (40-byte urlsafe), `user_id`, `created_at`, `expires_at` (+7 days) | `session_token` unique; TTL on `expires_at` |
| `usage` | `user_id`, `free_remaining` (starts 1), `oneoff_credits`, `oneoff_purchase_count`, `basic_credits`, `subscription_active`, `videos_created` | `user_id` unique |
| `projects` | see below | `(user_id, created_at desc)` |
| `payment_transactions` | `session_id`, `user_id`, `package_id`, `status`, `payment_status`, timestamps | `session_id` unique |

**Project document** (`project_<12 hex>`):

- Identity: `project_id`, `user_id`, `name` (original filename), `created_at`, `updated_at`.
- Source: `duration`, `width`, `height`, `size_bytes`, `source_path`, `content_type`,
  `preview_path`, `preview_content_type`, `render_path`.
- Processing: `status` (`queued` → `processing` → `ready` | `failed`; `rendered`
  after export), `progress` (0–100), `processing_label`, `error_message`,
  `speech_language` (`auto`|`hi`), `stt_engine` (`sarvam`|`whisper`),
  `transcription_mode`, `transcription_quality` (diagnostics), `credit_type`,
  `source_transcript` (space-joined `original` words).
- Caption settings: `theme`, `font_id`, `words_per_caption` (null = auto),
  `caption_lines`, `caption_position`, `script_mode` (`roman`|`native`).
- Style: `bold`, `italic`, `outline_*`, `shadow_*`, `glow_*`, `background_*`.
- Video: `audio_volume`, `audio_muted`, `brightness`, `contrast`, `saturation`,
  `render_quality`.
- Layers: `words[]`, `elements[]`, `sfx_markers[]`.

**Word:** `index`, `text` (Roman), `original` (engine raw), `start`, `end` (s),
`emphasis` (`support`|`feature`|`key`), `important`, `uncertain`, `color`,
`font_size` (16–120), `pos_x`/`pos_y` (0–100 % or null), `rotation` (±45 or
null), `new_line` (tri-state), `new_caption` (tri-state), `box_width`/
`box_height` (editor only), `kinetic` (editor only), `emphasize`.

**Element:** `id`, `kind` (`sticker`|`text`), `char`, `font_id`, `color`,
`font_size` (20–280), `start`, `end`, `pos_x`, `pos_y`, `layer` (`front`|`behind`).

**SFX marker:** `id`, `type` (`whoosh`|`bass_drop`|`pop`|`cash`|`shutter`), `time`, `word_index`.

---

## 14. API reference

All under `/api`. Auth = session cookie `session_token` (or `Authorization:
Bearer <token>`; register/login also return `X-Session-Token`).

| Method & path | Auth | Purpose |
| --- | --- | --- |
| GET `/health` | – | Liveness |
| POST `/auth/register` | – | `{email, password, name?}` → user + cookie (409 if exists) |
| POST `/auth/login` | – | `{email, password}` → user + cookie |
| GET `/auth/google/login` | – | Redirect to Google consent |
| GET `/auth/google/callback` | – | OAuth code exchange → cookie → redirect to frontend |
| GET `/auth/me` | ✓ | Current user |
| POST `/auth/logout` | ✓ | Delete session, clear cookie |
| GET `/usage` | ✓ | Credits + `unlimited_testing` + plan list |
| POST `/projects/process` | ✓ | Multipart: `file`, `theme`, `font_id`, `speech_language`, `stt_engine` → queued project (400/402/413/415/422/503) |
| GET `/projects/{id}` | ✓ | Project (hides `user_id`, `source_path`, `credit_type`, `content_type`) |
| PUT `/projects/{id}` | ✓ | Save full editor state (`ProjectEdit`) |
| POST `/projects/{id}/retranscribe` | ✓ | `{speech_language, stt_engine?}` → re-queue |
| POST `/projects/{id}/ai/emphasis` | ✓ | GPT re-tag tiers → `{words}` (502 on AI failure) |
| POST `/projects/{id}/render` | ✓ | Burn-in export → `{download_url}` |
| GET `/projects/{id}/media` | ✓ | Preview/source bytes, HTTP Range (206/416) |
| GET `/projects/{id}/download` | ✓ | Rendered MP4 attachment |
| GET `/projects/{id}/srt` | ✓ | SRT attachment |
| GET `/payments/catalog` | – | Packages + `available` |
| POST `/payments/checkout` | ✓ | Stripe Checkout session (503 without Stripe) |
| GET `/payments/status/{session_id}` | – | Poll/grant |
| POST `/payments/stripe/webhook` | signature | Grant on `checkout.session.completed` |

---

## 15. Accounts, usage limits and payments

Entitlement on upload (`_entitlement`), first match wins:

1. `UNLIMITED_TESTING=true` and duration ≤ 120 s → `testing` (only
   `videos_created` increments).
2. ≤ 45 s and `free_remaining` > 0 → `free`.
3. ≤ 45 s and `oneoff_credits` > 0 → `oneoff`.
4. ≤ 60 s and `basic_credits` > 0 → `basic`.
5. Otherwise 402.

Credits are deducted only when the job succeeds. Packages coded today:
`single_45` (₹69, one 45 s video, max 3 purchases) and `basic_monthly`
(₹399/month, 10 × 60 s). Stripe Checkout + webhook + idempotent grants are
implemented but Stripe cannot be used by an Indian business account; checkout
reports unavailable without `STRIPE_SECRET_KEY`. Planned: Razorpay, minute-based
plans (see §19).

---

## 16. Storage and media

- `storage_service.put_object(path, bytes, content_type)` writes
  `LOCAL_STORAGE_DIR/path` plus a `path.meta` sidecar holding the content type;
  `get_object` reads both. Paths: `captain-title/uploads/<user>/<uuid>.<ext>`,
  `captain-title/previews/<user>/<uuid>.webm`, `captain-title/renders/<user>/<uuid>.mp4`.
- Files are read fully into memory for every request (fine for ≤ 120 MB; not for scale).
- The browser preview is a 720-wide VP9/Opus WebM (realtime preset), built in
  parallel with transcription; `/media` prefers it.

---

## 17. Configuration

See `CLAUDE.md §5` for the variable table. Notable defaults: Sarvam model
`saaras:v4`; GPT model `gpt-4o`; storage `backend/storage_data`; frontend
backend URL `http://localhost:8000`.

---

## 18. Running, deploying and operating

### 18.1 Local (the supported mode)
- Backend: `backend\.venv\Scripts\uvicorn.exe server:app --reload --port 8000`.
- Frontend: `yarn start` in `frontend/` (port 3000).
- MongoDB local or Atlas.

### 18.2 Vercel (frontend only)
- Vercel project "captain-title" (team Tadaaam, Hobby), imported from GitHub,
  **Root Directory = `frontend`**, preset Create React App,
  `REACT_APP_BACKEND_URL=http://localhost:8000`.
- `frontend/vercel.json` rewrites every path to `index.html` (BrowserRouter
  routes survive refresh).
- Deploys on every push to the default branch `backup-before-pro-editor-redesign`.
- Works only on the machine running the backend. Chrome asks to allow access to
  devices on the local network; allow it. Cookies are `SameSite=None; Secure`,
  which Chrome accepts for `localhost`.
- For phones/other machines: expose the backend through a tunnel
  (e.g. `cloudflared tunnel --url http://localhost:8000`), set
  `REACT_APP_BACKEND_URL` to the tunnel URL, redeploy. Google OAuth would also
  need the new redirect URI.

### 18.3 Why the backend is not on Vercel
FFmpeg renders up to 5 minutes, background jobs live in-process, files are on
local disk, and the bundle exceeds serverless limits. A container host (Render,
Railway, Fly.io, a VPS) is the path when needed.

### 18.4 Operating notes
- Restart the backend after changing `.env`.
- A Windows-level `OPENAI_API_KEY` overrides `.env`.
- Logs go to the console (`captain-title.*` loggers); `backend/backend.log` is a stray local file.

---

## 19. Cost model and pricing

Approximate AI cost per minute of audio (USD at ₹88/$):

| Step | Cost/min |
| --- | --- |
| Sarvam speech-to-text | ₹0.49 (₹0.38 on Business tier) |
| Whisper timing (Whisper engine only) | ₹0.53 |
| GPT-4o Hinglish + emphasis | ≈ ₹0.90 (≈ ₹0.05 with gpt-4o-mini) |
| Render / storage | ₹0 locally |

So: Sarvam-only + gpt-4o-mini ≈ ₹0.55/min; the full hybrid with gpt-4o ≈ ₹1.9/min.

Proposed pricing (from the pricing doc, not yet implemented): Free 3 min/month
with watermark; Creator ₹299/month (30 min); Pro ₹799/month (120 min); Team
₹1,999/month (400 min, 3 seats); ₹49 one-off 5-minute pack; overage ₹7–9/min.
Margins stay above 60 % even at full usage. Full analysis:
https://claude.ai/artifact/DhiTaqHdRMUZYKrLiFuNqS

---

## 20. Quality: testing and verification

- `backend/tests/` (Emergent era): ~57 HTTP integration tests across six files —
  core backend flow, Hindi/unlimited mode, the Toe Protector regressions,
  async job flow, Range/media. They require a running backend and real API keys.
- Verification practice that works (used 2026-10-27):
  - pipeline: run `transcribe_words` on the repo clips and read the timed output;
  - job: run `_run_caption_job` against a stub DB;
  - render: burn frames with `_write_ass` + FFmpeg; screenshot the CSS preview
    in headless Chrome with the bundled fonts; compare side by side; measure ink
    bounding boxes with Pillow.
- Missing: unit tests for grouping/line breaks/alignment/romanizer, an
  evaluation set with reference transcripts and WER, approved visual baselines,
  frontend tests. See TRACKER.md.

---

## 21. Known problems and risks

Summarized (details and status in TRACKER.md; root causes in IN_DEPTH.md):

1. Street Glow red/white placement inconsistent; preview/export font-size unit
   mismatch (export ≈ 58 % / 71 % of preview size); preview faux-bold Anton;
   preview uses Google Fonts copies of the bundled fonts.
2. Greedy grouping can split Hindi phrases awkwardly (e.g. separating a verb
   from its auxiliary "kar / rahe hain").
3. Sarvam-only word timing is an estimate within each phrase.
4. Accuracy not systematically evaluated.
5. Manual edit sequences (split + merge + regroup) not fully verified.
6. Two renderers per template → scaling cost and drift risk.
7. `palettes is not defined` crash on Street Glow emphasis edits.
8. No project history; projects are effectively lost when the tab closes.
9. Kinetic animations and explicit box sizes are preview-only; Doodle Marker's
   shrink-to-fit is preview-only too, so an over-wide line can run off the
   frame in the export.
10. SRT is one word per cue (fine for some uses, not for YouTube readability).
11. Single-process jobs; a crash mid-render loses the render.
12. Public repo with test media; no secrets committed (verified).

---

## 22. Roadmap: features we can add

### 22.1 Fix and harden (now)
- Font-size unit conversion in the ASS writer (OS/2 win metrics → `\fs`);
  remove inherited `font-weight:800` from Street Glow line 1; serve bundled
  fonts to the preview with `@font-face`.
- Visual parity harness with approved baseline PNGs per template × word
  pattern; fail on pixel/box drift.
- Fix `palettes` crash; unit tests for grouping, line breaks, romanizer, alignment.
- Project history: `GET /api/projects` list + reopen.

### 22.2 Accuracy and timing
- **Forced alignment** of Sarvam's text to the audio locally (WhisperX /
  wav2vec2 Hindi CTC) → real per-word timing without OpenAI.
- Sarvam `translit` mode as a second Roman-text source.
- A Glossary per user (brand names, recurring words) fed as Sarvam keyterms.
- Evaluation set + WER/CER + romanization accuracy report per engine.
- Alternative engines behind the same dropdown: ElevenLabs Scribe, Deepgram
  Nova-3, local faster-whisper.

### 22.3 Caption quality
- Phrase-aware grouping (DP over break costs: pauses, punctuation,
  verb+auxiliary, postposition attachment, width balance between lines).
- Width-balanced Street Glow line split (by measured width, not word count).
- A single template spec (JSON) consumed by both renderers (or render the
  preview from the same engine) to remove dual implementations.
- More templates once the spec exists; per-template colour customization that
  respects the design.

### 22.4 Editor
- Undo/redo, keyboard shortcuts, trim, speaker labels, find & replace, bulk
  style by tier, autosave.

### 22.5 Export
- VTT, grouped SRT, transparent overlay (ProRes 4444 / WebM alpha), 1080p/4K
  choices, burn-in progress reporting, watermark for Free.

### 22.6 Product
- Razorpay; minute-based UsageLedger; plans as data; brand kits; teams;
  translation to English subtitles; auto emoji; B-roll suggestions; mobile
  upload flow; hosted backend (container) with S3/R2 storage and a job queue.

### 22.7 New entities to support the above
Job, MediaAsset, TranscriptVersion, Export, StylePreset/BrandKit, Glossary,
UsageLedger, Plan/Subscription, Workspace/Member.

---

## 23. Glossary

| Term | Meaning |
| --- | --- |
| Hinglish | Hindi–English code-mixed speech/writing; here, Roman-script output |
| Roman / native | `word.text` (Roman Hinglish) vs `word.original` (engine's raw, often Devanagari) |
| Sarvam / Saaras | Indian speech AI provider / its speech-to-text model (`saaras:v4`) |
| codemix mode | Sarvam mode that keeps English words in Latin script within Hindi output |
| Whisper | OpenAI speech model (`whisper-1`), used here for word timestamps |
| Chunk | ~20 s slice of audio sent to the engines |
| Priming / overlap | Previous chunk's last 1.5 s prepended for context, then discarded |
| Group / caption / cue | Words shown together on screen at once |
| Line / row | One horizontal line within a group |
| Tier | Emphasis level: support, feature, key |
| ASS / libass | Advanced SubStation Alpha subtitle format / the library FFmpeg uses to draw it |
| `\fs` | ASS font-size tag (libass treats it as the font's full cell height) |
| Parity | The preview and the export showing the same picture |
| Street Glow / Doodle Marker | The two caption templates |
| Re-listen | Re-run transcription on an existing project |
| Captik | Commercial caption editor that the UI layout imitates |
| Emergent | The agent platform the project started on |
