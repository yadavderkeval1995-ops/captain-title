# Tadaaam — Description

Ready-to-use descriptions of the project at several lengths, for the GitHub
repo, a portfolio, a pitch, an onboarding message, or an AI agent's context.
All of them describe the product as it exists on 2026-10-27.

---

## GitHub "About" line (≤ 350 chars)

Hinglish caption generator for short-form video: transcribes Hindi/English
speech word by word (Sarvam AI, optional Whisper timing), converts it to Roman
Hinglish, and lets you style, edit and burn animated captions into an MP4.
FastAPI + MongoDB + FFmpeg/libass backend, React editor.

## One-liner

Upload a Hinglish reel, get word-timed Roman-Hinglish captions in a designed
animated template, edit them, export the MP4.

## Elevator pitch (≈ 60 words)

Indian creators talk in Hinglish, but caption tools either output Devanagari,
mistranslate, or time words badly. Tadaaam listens with Sarvam's
India-first speech model, writes exactly what was said in the Roman Hinglish
creators actually type, and animates it in polished templates. Edit any word,
then export a ready-to-post video — at an AI cost of under ₹2 per minute.

## Short description (≈ 150 words)

Tadaaam is a speech-to-caption web app built for Hindi/English
code-mixed ("Hinglish") short-form video. A creator uploads an MP4 or MOV up to
two minutes long. The backend extracts the audio, splits it at natural pauses,
and transcribes it with Sarvam AI's Saaras model in code-mix mode — optionally
combined with OpenAI Whisper for precise per-word timing. GPT (or an offline
romanizer when GPT is unavailable) converts Devanagari to natural Roman
Hinglish and marks the punchiest words. The words are grouped into on-screen
captions using one of two motion-graphic templates, Street Glow and Doodle
Marker. In the browser editor the creator sees a live preview, fixes words,
re-times and regroups captions, moves and styles them, adds stickers, text and
sound effects, and exports an MP4 with the captions burned in by FFmpeg, or an
SRT file.

## Long description (for onboarding a new developer or agent)

**Problem.** Most of India's short-form creators speak Hinglish — Hindi
sentences full of English words. Generic speech-to-text either returns Hindi in
Devanagari script (which most creators do not use for captions), translates
instead of transcribing, mangles the English loanwords, or gives poor
word-level timing. Professional caption looks (bold animated words, two-tone
headlines, highlighter effects) require hand work in a pro editor.

**Product.** Tadaaam automates that whole chain for videos up to 120 s:

1. *Listen* — FFmpeg extracts 16 kHz mono audio; the audio is cut into ~20 s
   chunks at detected silences (Sarvam accepts at most 30 s per request), each
   chunk primed with real overlapping audio from the previous chunk for
   context. Sarvam returns the words; in Whisper mode, Whisper returns
   word-level timestamps and a global sequence alignment stitches Sarvam's more
   accurate words onto Whisper's timing. Repetition/hallucination detectors
   reject bad chunks.
2. *Write* — each word becomes Roman Hinglish (`hain`, `aap`, `kya`), English
   words stay as spoken, and every word gets an emphasis tier
   (support / feature / key).
3. *Style* — words are grouped into captions and drawn in a fixed template:
   Street Glow (a red, glowing, condensed uppercase headline line that pops in,
   and a white italic serif subline that glides up) or Doodle Marker
   (hand-written words, key words wiped in on a yellow highlighter pill, a red
   pencil loop drawn around others).
4. *Edit* — a three-zone editor (tools/transcript on the left, 9:16 preview in
   the middle, style panels on the right, multi-lane timeline at the bottom).
5. *Export* — the same caption layout is written as an ASS subtitle script and
   burned into the video by libass inside FFmpeg, with smooth Gaussian-blurred
   shadows and glows composited from mask layers, colour grading, volume and
   synthesized SFX.

**Stack.** Python 3.12 / FastAPI / Motor (MongoDB) / imageio-ffmpeg /
Pillow / sarvamai / openai / indic-transliteration on the backend; React 19
(Create React App via craco), axios, Radix/shadcn primitives, Phosphor icons,
hand-written CSS on the frontend. Storage is the local disk. Runs on Windows.

**Status.** Personal tool in active development; local-first. Frontend
deployed on Vercel for convenience; backend runs on the owner's PC. Payment
plumbing exists but is dormant until an Indian payment provider (Razorpay) is
wired in.

**Name.** "Tadaaam" is a play on "caption title"; the original brief
was "you are a caption generator and your name is Tadaaam".

## Keywords

Hinglish captions, Hindi subtitles, Roman Hindi, code-mixed speech recognition,
Sarvam AI, Saaras, Whisper, word-level timestamps, short-form video, Reels,
YouTube Shorts, burned-in subtitles, ASS/libass, FFmpeg, caption templates,
creator tools, India.
