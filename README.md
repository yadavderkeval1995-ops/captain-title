# Captain Title

A word-by-word Hinglish caption generator and editor: upload a short video, get
an auto-transcribed, word-timed caption track you can restyle and re-time, then
burn it into an exported MP4. Auth, usage limits, and Stripe-based paid plans
(single video pass / monthly Basic) are already wired up for turning this into
a subscription product later.

## Stack

- **Backend**: FastAPI + MongoDB (Motor), FFmpeg for audio extraction and
  subtitle rendering, OpenAI Whisper for transcription and GPT for the
  Hindi → Hinglish conversion pass.
- **Frontend**: React 19 + Tailwind + Radix UI, three-zone editor (tools /
  preview / transcript) with a bottom word timeline.
- **Storage**: local disk by default (`backend/storage_data/`), swap for S3
  or similar before going multi-user.

## Local setup

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in MONGO_URL and OPENAI_API_KEY
uvicorn server:app --reload --port 8000
```

You need a MongoDB instance (local `mongod`, or a free MongoDB Atlas cluster)
and an [OpenAI API key](https://platform.openai.com/api-keys) — Whisper
transcription and the Hinglish conversion step both call OpenAI directly.

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

Email/password sign-in works out of the box. The "Continue with Google" button
redirects to Emergent's hosted OAuth flow and only works if you're running on
the Emergent platform — swap it for your own Google OAuth client when you're
ready for real users.

### Optional: payments

`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` are unset by default — the app
runs fine without them, `/api/payments/catalog` just reports checkout as
unavailable until you add Stripe test keys.
