# Captain Title

Captain Title is a full-stack SaaS video caption editor focused on Hindi and Hinglish creator workflows. It accepts short MP4 or MOV videos, generates word-timed captions, converts Hindi speech into Roman Hinglish, provides a browser-based caption editor, and renders a downloadable captioned MP4.

## Current status

The main product journey is implemented and suitable for controlled beta testing. Production deployment still requires environment configuration, durable background jobs, infrastructure monitoring, and completion of the release checklist below.

## Architecture

- Frontend: React 19, Create React App/CRACO, React Router, Radix UI, Tailwind CSS
- Backend: FastAPI, MongoDB via Motor, FFmpeg, Stripe
- AI: word-level speech transcription followed by Hinglish conversion
- Storage: object storage accessed through the configured integration proxy

## Main user journey

1. Register, sign in with email, or use Google authentication.
2. Upload an MP4 or MOV video up to the configured duration and size limits.
3. Track asynchronous transcription and Hinglish conversion progress.
4. Edit caption phrases, timing, typography, templates, fonts, and presets.
5. Preview the captions, save changes, render the final video, and download the MP4.
6. Purchase one-off or subscription credits when Stripe is configured.

## Repository layout

- backend: FastAPI application, AI pipeline, storage, payments, and integration tests
- frontend: React application and caption-editor components
- design_guidelines.json: UI direction and component guidelines
- backend/tests: API and media-pipeline test suites

## Local development

### Prerequisites

- Python 3.11+
- Node.js 20+
- Yarn 1.22
- MongoDB
- FFmpeg (the backend also uses the binary supplied by imageio-ffmpeg)
- Access to the configured AI and object-storage services

### Backend

Create backend/.env from backend/.env.example and supply the required values. Then install dependencies and run FastAPI:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.server:app --reload --host 0.0.0.0 --port 8000
```

The backend currently imports modules relative to the backend working directory in its original runtime. If launching from the repository root causes import errors, run Uvicorn from backend:

```bash
cd backend
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

Create frontend/.env from frontend/.env.example, then:

```bash
cd frontend
yarn install
yarn start
```

The frontend defaults to http://localhost:3000. Set REACT_APP_BACKEND_URL to the backend origin without the /api suffix.

## Required production configuration

- MONGO_URL and DB_NAME
- EMERGENT_LLM_KEY or replacement AI-provider configuration
- INTEGRATION_PROXY_URL when not using the default integration service
- FRONTEND_URL as the canonical HTTPS frontend origin
- CORS_ORIGINS as a comma-separated allowlist when more than one frontend origin is required
- STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to enable payments
- Stripe prices with lookup keys captain_single_45_inr and captain_basic_monthly_inr

EXPOSE_SESSION_TOKEN_HEADER is intended only for legacy integration-test environments. Do not enable it in production; browser authentication uses the secure HttpOnly session cookie.

UNLIMITED_TESTING bypasses normal credit limits for videos up to 120 seconds. Do not enable it in production.

## Testing

The backend test suites are integration-oriented and expect a running deployed API through REACT_APP_BACKEND_URL. Some suites also require real AI, storage, media fixtures, seeded users, or Stripe configuration.

```bash
cd backend
pytest -n 0 tests/test_captain_backend.py
```

Build the frontend with:

```bash
cd frontend
yarn build
```

GitHub Actions performs static Python compilation and a frontend production build. Full media-pipeline tests should run in a protected staging environment with the required credentials and fixtures.

## Release checklist

- Configure production frontend and CORS origins.
- Configure MongoDB, AI, object storage, and Stripe secrets outside Git.
- Replace process-local background tasks with a durable queue and worker.
- Move rendering to a worker with bounded concurrency and job status tracking.
- Stream media ranges directly from object storage instead of loading full objects into memory.
- Run authenticated end-to-end tests in staging, including cross-user access checks.
- Add observability for API errors, transcription failures, render duration, queue depth, and payment webhooks.
- Review and remove generated media/test artifacts from Git history if they are not intentional fixtures.
- Validate privacy, retention, deletion, billing, and subscription-renewal behavior before public launch.

## Security notes

- Never commit .env files, API keys, Stripe secrets, storage keys, session tokens, test cookies, or user media.
- Keep FRONTEND_URL and CORS_ORIGINS restricted to trusted origins.
- Payment status is scoped to the authenticated transaction owner.
- Checkout redirects use the configured frontend origin in production.
- Uploaded files require additional malware/content validation before an unrestricted public launch.
