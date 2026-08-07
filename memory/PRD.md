# Captain Title — Product Requirements Record

## Original problem statement
“hey you are caption generator and your name is captain title, i want you to generate creative font and mixed font captions after transcripting videos into hinglish, word to word, and do creative fonts and colour and gradients”

## Product decisions
- Output: editable caption preview, word-level timeline, styled downloadable MP4.
- Language: preserve spoken words; convert Hindi into Roman Hinglish without paraphrasing.
- Styles: Viral, Cinematic, Minimal, Podcast; automatically emphasize important words.
- Limits: source upload up to 120 seconds. Free: one video up to 45 seconds. Single pass: ₹69 for one 45-second video, up to three purchases. Basic: ₹399/month for ten videos up to 60 seconds.
- Accounts: Google social login plus email/password.
- AI: OpenAI `whisper-1` and `gpt-5.6-terra` through the Emergent universal key.

## User personas
- Short-form creator producing Reels, Shorts, and social clips.
- Podcast/video editor who needs fast, readable Hinglish captions.
- Solo creator who wants polished typography without learning a pro editing suite.

## Architecture decisions
- React editor with protected routes, responsive three-zone workspace, live video overlay, transcript editor, and word timeline.
- FastAPI API split into authentication, AI captioning, storage, rendering, and payments modules.
- MongoDB stores users, seven-day sessions, usage entitlements, projects, words, and payment transactions; API responses exclude Mongo `_id`.
- Emergent Object Storage owns source/rendered media; downloads are authorization-gated through FastAPI.
- `imageio-ffmpeg` supplies a portable FFmpeg binary for audio extraction and server-side subtitle burn-in.
- Stripe code uses server-owned lookup keys, signed webhooks, idempotent entitlement grants, and status polling when credentials become available.

## Static core requirements
1. Secure account creation and login.
2. MP4/MOV upload with duration/type validation.
3. Real transcription and indexed Roman-Hinglish conversion.
4. Editable transcript, per-word timing, color, size, and emphasis.
5. Four caption themes and live synchronized preview.
6. Save, render, and download final MP4.
7. Enforce free, one-off, and Basic usage rules.
8. Checkout must grant credits only after confirmed payment.

## Implemented
### 2026-08-07
- Built email/password sessions and Emergent Google OAuth callback integration.
- Built real Whisper → GPT Hinglish pipeline with timed words and important-word detection.
- Built object-storage-backed uploads, project ownership, live media, MP4 rendering, and download.
- Built editor UI: four themes, transcript edits, font size, color, emphasis, synchronized preview, timeline, save and render controls.
- Built free-credit and paid-credit entitlement model plus pricing/paywall UI.
- Built Stripe Checkout/webhook/status code; claimable Stripe sandbox provisioning is externally unavailable for business country `IN`, so live checkout is intentionally disabled rather than mocked.
- Verified 16/16 full-stack checks, including real AI, storage, render, download, ownership isolation, and second-video paywall.

## Prioritized backlog
### P0
- Select a supported payment route for India: Razorpay, or Stripe with a supported business-country setup; then activate catalog checkout.

### P1
- Move long 60-second caption generation into a background job with progress polling to remove ingress timeout risk.
- Complete a human Google OAuth sign-in acceptance check with a real Google account.
- Add creator project history so prior caption sessions can be reopened.

### P2
- Add in-editor trimming for 60–120 second source videos.
- Add custom font upload/licensing controls and more caption motion presets.
- Add SRT/VTT export and reusable brand kits.

## Next tasks
1. Confirm the India payment provider and activate real checkout.
2. Add background processing progress and project history.
3. Add trim controls and subtitle-file exports.