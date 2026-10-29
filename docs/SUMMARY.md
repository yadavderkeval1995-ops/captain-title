# Tadaaam — Summary

*As of 2026-10-27. Owner: Keval (GitHub `yadavderkeval1995-ops`). Two-minute read.*

## What it is

Tadaaam turns a short vertical video with Hindi, English, or mixed
"Hinglish" speech into **word-timed, animated, Roman-script Hinglish captions**,
lets the creator fix and restyle them in a browser editor, and exports an MP4
with the captions burned in (or an SRT file).

Example: the speaker says "आज हम एक नया video बना रहे हैं". Tadaaam
shows "aaj hum ek naya video bana rahe hain" on screen, with each phrase popping
in on time in a designed template.

## Who it is for

Short-form creators in India (Reels, YouTube Shorts) who speak Hinglish and
want viral-style captions without learning Premiere/CapCut, and editors who
caption many clips a week. The first user is the owner, captioning his own videos.

## Where it stands

| Area | State |
| --- | --- |
| Runs | Locally on the owner's Windows PC. Backend: FastAPI + MongoDB on `localhost:8000`. Frontend: React, also deployed to Vercel (talks to the local backend). |
| Transcription | **Sarvam AI** (Saaras v4, code-mix mode) is the speech-recognition AI and always decides the words; Whisper only ever supplies timecodes. Two engines selectable at upload: *Sarvam-only* (default, no OpenAI needed; word timing estimated from phrase timestamps) and *Whisper timing + Sarvam text* (precise word timing, needs an OpenAI key). |
| Hinglish | GPT (`gpt-4o`) converts Devanagari to natural Roman Hinglish and tags emphasis; if GPT is unavailable, an offline rule-based romanizer (with Hindi schwa deletion) takes over. |
| Templates | Two fixed motion designs: **Street Glow** (red condensed headline + white italic subline) and **Doodle Marker** (handwritten words with yellow highlighter pills and red pencil loops). |
| Editor | Transcript panel, word timeline with waveform/filmstrip, per-word edit/split/merge, caption split/merge, drag/scale/rotate captions, outline/shadow/glow/background styling, stickers, text layers, SFX markers, color grading, AI filler-word removal, native-script toggle. |
| Export | FFmpeg + libass burn-in at source resolution (high or draft quality), SRT (one cue per word). |
| Accounts & money | Email/password + Google sign-in work. Credit model coded (free / ₹69 single / ₹399 Basic) but bypassed by `UNLIMITED_TESTING`. Stripe code exists but is unusable for an Indian business — Razorpay is the planned route. |
| Tests | HTTP integration tests from the Emergent era; no unit tests, no automated visual regression yet. |

## The end goal

A reliable, cheap, local-first Hinglish captioning tool that the owner can use
on his own videos every day, whose preview **exactly** matches its export,
and which can later become a paid product (minute-based pricing in INR,
target AI cost ≈ ₹0.5–2 per minute of video).

## Top problems right now

1. **Street Glow placement and size parity** — red/white lines look disconnected
   in some word combinations and overlap in others; measured root cause: the
   export draws text at ~58 % (Anton) / ~71 % (Playfair) of the preview's size
   because libass and CSS interpret font size differently, plus a faux-bold
   Anton in the preview only.
2. **Caption grouping quality** for Hindi/Hinglish phrases (greedy grouping; no
   phrase awareness).
3. **Transcription accuracy** has no systematic evaluation set or metric.
4. **Two renderers** (CSS and libass) must be kept in sync by hand for every template.
5. **No repeatable visual tests**, so approved designs regress.
6. A crash: editing a word's emphasis tier while on Street Glow throws
   `palettes is not defined`.

## Immediate next steps

1. Commit the 2026-10-27 work (engine dropdown, Sarvam-only path, offline
   Hinglish fallback, error clarity, Windows cleanup fix, these docs).
2. Fix font-size unit conversion in the ASS writer; remove the preview faux-bold;
   serve the bundled fonts to the preview. Re-check Street Glow placement.
3. Build the headless visual-parity harness into `backend/tests/visual/` with
   approved baseline images.
4. Add a small labelled Hinglish evaluation set (the repo's real clips) and a
   word-error-rate script; compare Sarvam-only vs Whisper+Sarvam.
5. Fix the `palettes` crash; add project history (list/reopen projects).

## Key documents

- `CLAUDE.md` — rules for agents working in the repo
- `docs/COMPREHENSIVE.md` — the full picture
- `docs/IN_DEPTH.md` — internals for engineers
- `docs/DECISIONS.md` — why things are the way they are
- `docs/TRACKER.md` — issues and backlog
- Pricing analysis (claude.ai doc): https://claude.ai/artifact/DhiTaqHdRMUZYKrLiFuNqS
