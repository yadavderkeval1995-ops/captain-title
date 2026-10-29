# Tadaaam

A word-by-word Hinglish caption generator and editor: upload a short video, get
an auto-transcribed, word-timed caption track you can restyle and re-time, then
burn it into an exported MP4. Auth, usage limits, and Stripe-based paid plans
(single video pass / monthly Basic) are already wired up for turning this into
a subscription product later.

**Documentation:** start with [`CLAUDE.md`](CLAUDE.md) (rules for agents and
developers), then [`docs/SUMMARY.md`](docs/SUMMARY.md). Full picture:
[`docs/COMPREHENSIVE.md`](docs/COMPREHENSIVE.md) · internals:
[`docs/IN_DEPTH.md`](docs/IN_DEPTH.md) · why things are this way:
[`docs/DECISIONS.md`](docs/DECISIONS.md) · open work:
[`docs/TRACKER.md`](docs/TRACKER.md) · blurbs:
[`docs/DESCRIPTION.md`](docs/DESCRIPTION.md).

## Stack

- **Backend**: FastAPI + MongoDB (Motor), FFmpeg for audio extraction and
  subtitle rendering. Transcription is a hybrid: Sarvam AI (Saaras) recognizes
  *what* was said (much more accurate than Whisper for Hindi/Hinglish), while
  Whisper supplies the per-word *timing* (Sarvam's REST API doesn't return
  word-level timestamps) - the two are stitched together. GPT handles the
  Hindi → Hinglish conversion pass.
- **Frontend**: React 19 + Tailwind + Radix UI. A Captik-style editor: a left
  icon rail (Media / Audio / Text / Elements / Captions / Adjustment / AI
  tools) switches the left panel's content, a center 9:16 preview, a right
  panel tabbed Templates / Customize / Text for caption styling, and a
  bottom word timeline. Cherry Red / Roma Red gradient brand palette over
  black/white.
- **Storage**: local disk by default (`backend/storage_data/`), swap for S3
  or similar before going multi-user.

## Editor panels

- **Captions** - the word-by-word transcript: edit text inline, see
  uncertain words flagged, trigger a Re-listen.
- **Media** - read-only source info (resolution, duration, file size, format).
- **Audio** - a 0-200% volume slider and mute toggle for the original audio,
  applied in the exported render via ffmpeg's `volume` filter.
- **Elements** - a curated sticker/symbol picker; each one is draggable and
  resizable on the canvas and gets its own color/size/timing.
- **Text** - free-typed text layers (titles, labels), same drag/resize/timing
  controls as Elements, plus a font picker.
- **Adjustment** - brightness/contrast/saturation, baked into the export via
  ffmpeg's `eq` filter *before* the caption burn-in, so captions and stickers
  stay full-strength regardless of grading.
- **AI tools** - a local filler-word scan (um, matlab, basically, toh...)
  with one-click or bulk removal, and "Re-run AI emphasis" to re-tag which
  words get Key/Feature/Support styling after you've hand-edited the text.

## Local setup

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in MONGO_URL, SARVAM_API_KEY, and OPENAI_API_KEY
uvicorn server:app --reload --port 8000
```

You need a MongoDB instance (local `mongod`, or a free MongoDB Atlas cluster),
a [Sarvam AI API key](https://dashboard.sarvam.ai) for speech recognition, and
an [OpenAI API key](https://platform.openai.com/api-keys) for Whisper's
word-level timing and the Hinglish conversion step.

### Frontend

```bash
cd frontend
corepack enable          # one-time, gives you the pinned Yarn version below
yarn install              # use Yarn, not npm — package.json's "resolutions"
                           # field (which pins a bunch of transitive deps to
                           # avoid a broken ajv/ajv-keywords combo in
                           # react-scripts) is a Yarn-only feature and is
                           # silently ignored by npm
cp .env.example .env      # point REACT_APP_BACKEND_URL at the backend
yarn start
```

Email/password sign-in works out of the box. "Continue with Google" needs
your own Google OAuth client (free, a few minutes to set up):

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth 2.0 Client ID** of type **Web application**.
2. Under **Authorized JavaScript origins**, add your frontend's URL (e.g.
   `http://localhost:3000`).
3. Under **Authorized redirect URIs**, add
   `http://localhost:8000/api/auth/google/callback` (must match
   `GOOGLE_REDIRECT_URI` below exactly).
4. Copy the generated Client ID and Client Secret into `backend/.env`:
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

Without those set, the Google button shows a friendly error and email/password
still works fine.

### Optional: payments

`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` are unset by default — the app
runs fine without them, `/api/payments/catalog` just reports checkout as
unavailable until you add Stripe test keys.
