# Tadaaam — In-Depth Engineering Guide

*Version: 2026-10-27. Audience: engineers and AI coding agents about to change
the code. This document explains how each part works internally, the exact
thresholds and constants, why they exist, the invariants you must keep, the
known root causes of current problems, and recipes for verifying changes.
Line numbers drift; search by function name.*

---

## Contents

1. Process model and startup
2. Authentication internals
3. Upload and the background job
4. Audio chunking
5. Engine A — Sarvam-only
6. Engine B — Whisper timing + Sarvam text
7. Preview/export parity: the contract, the measured gaps, the fix plan
8. Hinglish conversion and the offline romanizer
9. Caption grouping and line breaking
10. The ASS writer and the FFmpeg render
11. Verification recipes (copy-paste)
12. Frontend internals (CaptionStudio and friends)
13. Error handling conventions
14. Performance characteristics
15. Security notes
16. How to: add a template / add an engine / change grouping
17. Root-cause notes from past bugs (do not reintroduce)

---

## 1. Process model and startup

`backend/server.py`:

1. `load_dotenv(backend/.env)` **before** importing the routers (the routers
   read env at call time, but `caption_ai`/`captions` import SDKs at import time).
   `load_dotenv` does not override existing process env vars.
2. Creates one `AsyncIOMotorClient(MONGO_URL)`; `db = client[DB_NAME]`;
   `app.state.db = db` — handlers reach the DB via `request.app.state.db`.
3. `lifespan` creates indexes (users.email unique; user_sessions.session_token
   unique; TTL on user_sessions.expires_at; projects (user_id, created_at desc);
   usage.user_id unique; payment_transactions.session_id unique), initializes
   storage, and calls `resume_pending_projects(db)` which re-schedules any
   project still `queued`/`processing` (max 100) — this is what makes jobs
   survive `--reload` restarts.
4. CORS: `allow_origin_regex=r"https?://.*"` with credentials — any origin may
   call with cookies. Acceptable for a local tool; tighten before hosting.

There is exactly one process. Background work = `asyncio.create_task`. The
module-level `active_jobs: set[str]` prevents scheduling the same project twice
in one process.

---

## 2. Authentication internals (`auth.py`)

- Passwords: bcrypt (`bcrypt.hashpw`, 8–72 chars enforced by Pydantic; bcrypt
  truncates at 72 bytes).
- Sessions: `secrets.token_urlsafe(40)` stored in `user_sessions` with a 7-day
  `expires_at` (TTL index deletes expired rows; `current_user` also checks expiry
  and normalizes naive/str datetimes).
- Token sources: cookie `session_token` first, else `Authorization: Bearer`.
- Cookie: `httponly, secure, samesite=none, max_age=604800, path=/`. `secure`
  + `samesite=none` are required for the cross-site Vercel → localhost setup;
  browsers accept `Secure` cookies on `http://localhost`.
- Google OAuth: authorization-code flow with the app's own client
  (`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`); token exchange and userinfo fetch run
  in a thread (`requests`). Users are matched by lower-cased email; a Google
  login can attach to an existing email/password account. Redirects to
  `FRONTEND_URL/editor` with the cookie set; failures redirect to
  `FRONTEND_URL/?google_error=denied|failed|not_configured`.
- `_ensure_usage` upserts a usage row with `free_remaining: 1` on first login/register.

---

## 3. Upload and the background job (`captions.py`)

### 3.1 `POST /api/projects/process`
Validation order: theme ∈ THEMES → font ∈ FONTS → speech_language ∈ {hi, auto}
→ stt_engine ∈ STT_ENGINES → suffix ∈ {.mp4, .mov} (415) → size ≤ 120 MB (413)
→ FFmpeg-readable (422) → duration ≤ 120 s (422) → entitlement (402) → store
(503 on failure). Duration and resolution come from parsing `ffmpeg -i x -f
null -` stderr (`Duration:` and the first `Video: ... WxH`). The project document
is inserted with all editor defaults (see COMPREHENSIVE §13) and
`status: queued, progress: 5`, then `schedule_caption_job(db, id, consume_credit=True)`.

### 3.2 `_run_caption_job(db, project_id, consume_credit)`
```
status=processing, progress=12 "Preparing audio"
bytes = get_object(source_path)
with TemporaryDirectory() as temp:
    write source; ffmpeg → speech.wav (mono, 16 kHz, s16le)
    preview_task = to_thread(_create_browser_preview)      # parallel 720p VP9 WebM
    try:
        progress=28 "Listening word by word"
        words, diagnostics = transcribe_words(wav, speech_language, stt_engine)
        progress=78 "Creating Roman Hinglish"
        words = convert_to_hinglish(words, project name as context)
    finally:
        preview_bytes = gather(preview_task, return_exceptions=True)[0]   # see §17.9
    store preview if bytes
_apply_theme_defaults(words, theme)                          # bake colour/size by tier
status=ready, progress=100 "Captions ready", words, source_transcript, diagnostics
deduct credit (only now, only if consume_credit)
except → status=failed with a user-facing message:
    TranscriptionAuthError → its own message (names the provider and the fix)
    "trustworthy transcript" → "No trustworthy transcript was found…"
    anything else → "Caption processing could not finish. Please try Re-listen."
finally: active_jobs.discard(id)
```

---

## 4. Audio chunking (`caption_ai.py`)

Why chunk at all: Sarvam's REST API caps a request at **30 s** of audio, and
long single requests to Whisper drift in timestamp accuracy. Why not fixed
cuts: cutting through a word loses or duplicates it.

- `_silence_midpoints(wav, noise_db=-35, min_gap=0.3)`: runs FFmpeg
  `silencedetect` and returns the midpoint of each detected pause.
- `_chunk_boundaries(total, silences, seconds=20, snap_window=2.0)`: from the
  cursor, the target is cursor+20 s; pick a silence midpoint within
  [target−2, target+2]; else cut at the target.
- `_split_wav(wav, out_dir, seconds=20, snap_window=2.0, overlap_seconds=1.5)`
  writes each chunk as its own WAV:
  - chunk 0: **0.5 s of digital silence** prepended (Whisper tends to fumble the
    first moment of any buffer; the lead-in absorbs that).
  - chunk k>0: the previous **1.5 s of real audio** prepended (acoustic context
    for both engines).
  - returns `(path, offset, content_start)` where `offset = start − prefix_duration`
    (add to chunk-relative times to get absolute times) and `content_start` is
    where new content begins.
  - Worst case per chunk: 22 s + 1.5 s = 23.5 s < 30 s cap.
- After recognition, words whose absolute start < `content_start − 0.05` are
  dropped (they were re-recognized from the overlap).
- Context carry-over: the last 40 recognized words → Whisper `prompt` (≤ 800
  chars) and Sarvam `keyterms` (commas/semicolons stripped — Sarvam rejects any
  keyterm containing `,`/`;`; de-duplicated).

---

## 5. Engine A — Sarvam-only (`engine="sarvam"`, default)

1. `_sarvam_pass(chunk, language_code, keyterms, with_timestamps=True)`:
   `AsyncSarvamAI.speech_to_text.transcribe(model=SARVAM_STT_MODEL or
   "saaras:v4", mode="codemix", language_code="unknown"|"hi-IN", keyterms,
   with_timestamps=True)`. Unauthorized/Forbidden/PaymentRequired →
   `TranscriptionAuthError`. Other exceptions → log and skip the chunk.
2. Response: `transcript` plus `timestamps` = parallel lists `words` (actually
   **phrase** strings — Sarvam's own docs: "sentence/phrase segments, not
   individual words"), `start_time_seconds`, `end_time_seconds`.
3. `_sarvam_timed_words(response, chunk_duration)`: for each phrase,
   `_spread_words(phrase, start, max(end, start+0.05))` splits the phrase into
   tokens and divides its span **proportionally to `len(token)+2`** (the +2 gives
   short function words like "hai" a readable minimum). No timestamps →
   the whole transcript is spread across the chunk.
4. Then the shared tail: repetition check, offset, overlap drop, context carry.

Characteristics: one API call per chunk, fast (≈ 3–4 s per 10–30 s chunk), no
OpenAI. Timing inside a phrase is an estimate; phrase boundaries are real.
Measured 2026-10-27 on `toe-protector-source.wav` (37.8 s): 2 chunks, 148 words,
unique ratio 0.615, no repetition, ≈ 6 s transcription.

Improvement path: forced alignment of Sarvam's phrase text to the audio
(wav2vec2 Hindi CTC or WhisperX alignment) would give real per-word timing at
zero API cost (TRACKER B-ALIGN).

---

## 6. Engine B — Whisper timing + Sarvam text (`engine="whisper"`)

### 6.1 Whisper pass
`client.audio.transcriptions.create(model="whisper-1",
response_format="verbose_json", timestamp_granularities=["word"],
temperature=0, language="hi" only in Hindi mode, prompt=context)`.
`AuthenticationError`/`PermissionDeniedError` → `TranscriptionAuthError`.

### 6.2 `_build_whisper_candidate(response, skip_before)`
- Builds `{original, start, end}` words from `response.words`.
- Drops segments that start ≥ `skip_before + 1.0` s with `no_speech_prob ≥ 0.65`
  (the protected region — lead-in or priming audio, plus 1 s — is never dropped,
  because Whisper reports inflated no-speech probability right after a buffer
  start).
- `average_logprob` over accepted segments; `trustworthy = words and avg > -1.45`.
- Untrustworthy or empty → chunk skipped.

### 6.3 Alignment `_align_words(whisper_tokens, sarvam_tokens)`
Global (Needleman–Wunsch) alignment:
- match score = `SequenceMatcher(a, b).ratio() − 0.4` (similar words score
  positive, dissimilar negative);
- gap penalty for skipping either side;
- traceback yields ops: `match(i,j)`, `skip_whisper(i)`, `skip_sarvam(j)`.

### 6.4 Merge detection `_detect_merged_matches`
On fast Hindi, Sarvam sometimes returns several spoken words as **one token**.
A match is flagged as a merge when the Sarvam token is ≥ 9 chars **and** ≥ 2.3×
the matched Whisper token's length **and** it is bracketed by `skip_whisper`
ops. For flagged matches the Whisper word's text is used (correctly segmented).

### 6.5 Stitch `_stitch_chunk(whisper_words, sarvam_text)`
- `match` → Sarvam text on Whisper timing (or Whisper text if merge-flagged).
- `skip_sarvam` runs → `_emit_interpolated`: spread pending Sarvam words evenly
  between the previous end and the next Whisper start.
- `skip_whisper` → normally dropped (Whisper-only = likely hallucination),
  except words adjacent to a merge, which keep their Whisper text/timing.
- If Sarvam fails for a chunk, Whisper's words are used as-is.

---

## 7. Preview/export parity: the contract, the measured gaps, the fix plan

### 7.1 The contract
The browser preview (CSS) and the export (libass) are separate renderers. Each
shared concept is implemented twice (table in `CLAUDE.md §7.1`). Canvas units:
all sizes/positions are authored for a **1080×1920** canvas; the ASS script uses
`PlayResX: 1080, PlayResY: 1920`; the preview multiplies by
`previewScale = frameWidth / 1080`.

### 7.2 Measured gaps (2026-10-27)
Method: Street Glow groups rendered through the real `_write_ass` → FFmpeg
frame at 1080×1920; the same markup + `App.css` rules screenshotted in headless
Chrome at 1080×1920 with the **bundled** TTFs; ink bounding boxes measured with
Pillow.

| Observation | Export (libass) | Preview (CSS) | Cause |
| --- | --- | --- | --- |
| Anton (line 1) cap height at "72" | 35 px | ≈ 62 px | libass `\fs` = font's OS/2 **win cell height** (usWinAscent+usWinDescent = 3550/2048 = 1.733 em) → em = 72/1.733 = 41.5 px. CSS font-size = em = 72 px. Export ≈ **58 %** of preview. |
| Playfair (line 2) at "44" | em ≈ 31.2 px | em = 44 px | Cell = (1159+251)/1000 = 1.41 em → export ≈ **71 %**. |
| Anton weight | Regular | Synthetic bold | `.caption-overlay { font-weight:800 }` is inherited by `.street-glow-line1`; Anton has one weight, so the browser fakes bold. |
| Fonts | `backend/fonts/*.ttf` | Google Fonts CSS import | Different files/versions; metrics can differ. |
| Line overlap | Lines separate with a visible gap | Lines touch/overlap | The −8 px gap was tuned against the (bigger) CSS boxes. |
| Red/white "disconnected vs overlapping" | Depends on word lengths | Same | Lines split by **word count** (`ceil(n/2)`), not width; uppercase condensed vs lowercase italic produce very different widths (e.g. "CONSISTENT REHNA" / "zaroori"). Line-2 ascenders (k, t, h, l) visually reach toward line 1 while x-height-only words ("aur mein") leave a gap. |

The generic (non-Street-Glow) path has the same `\fs` semantics for every font
(Poppins, Caveat …); earlier "calibrations" (e.g. `NATIVE_LINE_HEIGHT = 1.47`)
were tuned around this mismatch rather than fixing it.

### 7.3 Fix plan (not yet implemented)
1. `_ass_font_size(family, css_px) = round(css_px × (winAscent+winDescent)/unitsPerEm)`,
   metrics read once per bundled font (fontTools, or a 20-line OS/2 table
   reader to avoid a dependency). Apply to every `\fs` emission (Street Glow
   lines, generic words, emphasize bump, elements, Doodle). Keep `_measure_text_width`
   at CSS px (PIL sizes by em, which is then consistent).
2. Set `font-weight:400` on `.street-glow-line1` (and audit other inherited weights).
3. Serve `backend/fonts` to the frontend (static route or copy into `public/fonts`)
   with `@font-face`, and drop the Google Fonts import for those families.
4. Re-derive line placement from **baselines**: place line 2's baseline a fixed
   distance below line 1's baseline (in both renderers) rather than stacking boxes.
5. Re-measure; then tune design constants (gap, sizes) by eye with both renderers agreeing.
6. Width-balanced line split for Street Glow (choose the split index minimizing
   |width1·k − width2| using measured widths, constrained to phrase-friendly breaks).
7. Freeze baselines in the visual harness (§11.3).

---

## 8. Hinglish conversion and the offline romanizer

### 8.1 `convert_to_hinglish(words, context)`
- One GPT call for the whole transcript (`index: original` lines). Response
  parsed by locating the first `[...]` JSON array.
- Any exception (auth, network, bad JSON) → logged, `converted = {}` → offline path.
- Dropped indices (GPT skipping a few) are tolerated and logged.
- Per word: `common = _common_hindi_spelling(original)`; if `common` and (GPT
  text empty, or contains Devanagari, or `SequenceMatcher(gpt, common) ≥ 0.5`)
  → `common`; else `_romanize_fallback(gpt_text or original)`.
  The 0.5 threshold separates GPT's near-miss spellings ("maim"/"main" .75,
  "apa"/"aap" .67) from deliberate context corrections (< .4 in practice).
- `emphasis` validated to {support, feature, key}; `important`, `uncertain` set.

### 8.2 `_COMMON_HINDI_ROMANIZATIONS`
≈ 200 entries: copulas (है hai, हैं hain, था tha …), pronouns, question words,
connectors/postpositions (और aur, में mein, से se, के ke …), frequent verbs
(करना karna, जाना jana, चाहिए chahiye …), adjectives, numbers, and (2026-10-27)
लिए liye, काफी kaafi, कीजिए kijiye, दीजिए dijiye, जाइए jaiye, आइए aaiye, चाहते chahte.
Matching strips trailing punctuation (`.,!?"'।॥`) and re-attaches it (danda → ".").

### 8.3 `_romanize_fallback` → `_hinglish_transliterate`
For any token containing Devanagari:
1. `_delete_schwas(word)` parses the word into units: consonant (+nukta) with
   inherent schwa / with a vowel sign / with virama (dead); independent vowels.
   - The **final** schwa is always silent.
   - Scanning right to left, a **medial** schwa is silent when the units on both
     sides still carry a vowel (Ohala's rule, simplified).
   - Silent schwas are marked by inserting a virama (्), so the transliterator
     emits no "a".
2. `indic_transliteration` DEVANAGARI → OPTITRANS.
3. Post-rules: `.Dh`→rh, `.D`→r (ड़/ढ़), `.N`→n (chandrabindu), `M`→n (anusvara);
   word-final `A/I/U` → a/i/u; remaining `A/I/U` → aa/ee/oo; lower-case.

Examples (verified): आज aaj · अगर agar · दोस्तों doston · करवाना karvaana ·
जानना jaanna · ठीक theek · बहुत bahut · समझना samajhna · बचपन bachpan ·
कमरा kamra · खराब kharaab · आसान aasaan · लगाना lagaana · जिसके jiske.
Known imperfections: some long-vowel spellings differ from common texting
("kharaab" vs "kharab"), फ without nukta → "ph".

### 8.4 `reassign_emphasis(words, context)`
Same GPT pattern, tiers only, against current `text`; unknown tiers keep the
previous value. Unlike conversion, this endpoint **does** fail (502) without GPT.

---

## 9. Caption grouping and line breaking

### 9.1 `_group_words_for_display(words, min_display, max_words, max_gap=0.4, strict_count)`
Greedy single pass (mirrored by `groupWordsForDisplay` in `CaptionStudio.jsx`):
```
group = [w0]
for next word n:
    if n.new_caption is True: break
    if n.new_caption is False: append; continue          # forced merge ignores every limit
    ok = len(group) < max_words
         and not ends_sentence(group[-1])                 # . ! ? । ॥ in word.original
         and n.start - group_end < max_gap
         and (strict_count or group_end - group[0].start < min_display)
    if not ok: break
    append
```
`_write_ass` chooses `default_max_words` = 6 (street_glow) / 3 (doodle_marker)
and `min_display` = 1.5 s for both; `words_per_caption` (1–8) sets max words
and `strict_count`.

Weaknesses: no look-ahead; doesn't know Hindi phrase structure (verb +
auxiliary "kar rahe hain", noun + postposition "website pe"), so a group can
end between them; the min-display rule cuts by time, not meaning. A DP
formulation (minimize Σ break costs: pause length, punctuation, POS-ish rules
from a small Hindi function-word list, width balance, duration targets) is the
planned replacement — implement once, in Python **and** JS, with shared test
vectors.

### 9.2 Line breaks
`_auto_line_breaks(group, tiers, caption_lines)`: tiered templates break at
tier changes (unused now: Doodle passes `tiers=None` to stay single-line);
`caption_lines == 2` → break at `ceil(n/2)`; else none. `_resolve_line_breaks`
lets each word's `new_line` (True/False) override. Street Glow always calls with
`caption_lines=2`. `_split_rows` materializes rows.

---

## 10. The ASS writer and the FFmpeg render

### 10.1 Header and style
`PlayResX 1080, PlayResY 1920, WrapStyle 2` (no automatic wrapping — we decide
breaks). One `Default` style: project font, size 52, BorderStyle 1 (outline) or
3 (opaque box when Background is on: Outline 14 = box padding, BackColour = box fill).

### 10.2 Generic path (Doodle Marker and any tiered theme)
One Dialogue per group; rows joined by `\N` so libass stacks lines with native
metrics; the first word carries `\an5\pos(cx,cy)` (+ `\org`/`\frz` rotation).
Per word: `\fn\fs\fscx100\fscy100\c` (+ `\b1` only for Poppins/Caveat), outline
tags, and the active-word pop `\t(on,on+120,\fscx112\fscy112)\t(off−150,off,\fscx100\fscy100)`
relative to the Dialogue start. Devanagari text on a non-Devanagari font is
forced to Noto Sans Devanagari. `emphasize` → accent colour `#EAB308`, size ×1.18.

### 10.3 Street Glow path (`_emit_street_glow_group`)
Two Dialogues per group (ASS animates whole Dialogues, so each independently
animated line needs its own): line 1 `\an5\pos(cx,cy1)` with the pop `\t`s;
line 2 `\an5\move(cx,cy2+18 → cx,cy2, 0–220ms)\fad(120,80)`. Vertical centres:
`total = 72 + (44 − 8 if line2)`; `top = cy − total/2`; `cy1 = top + 36`;
`cy2 = top + 72 − 8 + 22`. Glow mask pair for line 1 (red, opacity 0.85), shadow
mask pair for line 2 (black, 0.55). The render forces blur strengths
`STREET_GLOW_SHADOW_BLUR = 3`, `STREET_GLOW_GLOW_BLUR = 10`.

### 10.4 Doodle decorations (`_emit_doodle_decorations`)
Behind the text (Layer −1), as `\p1` vector drawings, positioned by measuring
each word with PIL (`_measure_text_width`, Caveat) and estimating row centres
(`DOODLE_NATIVE_LINE_HEIGHT = 1.47`). `key` → yellow pill growing left→right in
6 steps over 180 ms; `feature` → red loop (outline-only ellipse path, `\bord3`)
growing in 6 steps over 220 ms. Stepped because an animated `\clip` combined
with `\p` drawings did not render correctly in libass.

### 10.5 Blur masks (Shadow/Glow)
libass `\blur` is a coarse approximation and blurs fill and outline together.
Instead each layer writes two mask scripts sharing geometry: an **alpha** mask
(grey = opacity) and a **colour** mask (real colour). `_blur_mask_steps`
renders both onto black `color` sources at the output size, `gblur`s them with
`sigma = blur × (width/1080) × 1.1` (1.1 measured to match CSS blur radius),
`alphamerge`s colour + alpha into RGBA, and overlays onto the video with
`shortest=1` (the `color` source is infinite; without it the render never ends).
Order: grade → glow → shadow → crisp text (`subtitles` filter).

### 10.6 Audio and SFX
`volume` on the main track. Each SFX marker → a `lavfi` synthesized source
(`anoisesrc` band/high-pass for whoosh/pop/shutter; `aevalsrc` tone bursts for
cash; a pitch-dropping sine with soft clip for bass_drop), mono→stereo `pan`,
`adelay` to its time, volume 0.7; mixed with `amix normalize=0 duration=first`.
`lib/sfx.js` reproduces the same recipes with Web Audio.

### 10.7 Encoding and Windows quirks
x264 (`high`: preset medium CRF 17; `draft`: veryfast CRF 26), AAC 192k,
`+faststart`, timeout 300 s (`RuntimeError` with a user-safe message). FFmpeg
runs with `cwd` = the temp dir and **relative** paths for the ASS files and
`fontsdir`, because a Windows drive-letter colon cannot be escaped reliably in
filter options. Output resolution = source resolution (PlayRes scales).

---

## 11. Verification recipes (copy-paste)

All from `backend/` with the venv's Python. Use `-X utf8` to print Devanagari.

### 11.1 Transcribe real clips
```python
import asyncio, sys
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path("backend/.env"))       # adjust to absolute path
import caption_ai
async def main(p, engine="sarvam"):
    words, diag = await caption_ai.transcribe_words(p, "auto", engine)
    words = await caption_ai.convert_to_hinglish(words, "")
    print(diag)
    for w in words: print(f"{w['start']:6.2f}-{w['end']:6.2f} {w['original']:<14} -> {w['text']}")
asyncio.run(main("../toe-protector-source.wav"))
```

### 11.2 Full job with a stub database
```python
import captions
updates = []
class Coll:
    async def find_one(self, *a, **k):
        return {"project_id": "p1", "user_id": "u1", "source_path": "x", "name": "clip.mp4",
                "theme": "street_glow", "stt_engine": "sarvam"}
    async def update_one(self, q, u): updates.append(u["$set"])
class DB: projects = Coll(); usage = Coll()
captions.get_object = lambda path: (open("../toe-protector-source.mp4", "rb").read(), "video/mp4")
captions.put_object = lambda path, data, ct: {"path": path}
asyncio.run(captions._run_caption_job(DB(), "p1", consume_credit=False))
print(updates[-1]["status"], updates[-1].get("error_message"))
```
To test key-failure handling, set `os.environ["OPENAI_API_KEY"] = "sk-invalid"`
inside the script (never touch the real one) and use `stt_engine: "whisper"`.

### 11.3 Visual parity (export frame vs preview screenshot)
1. Build word dicts for a caption (give the last word a long `end`), call
   `captions._write_ass(path, words, "street_glow", caption_position="middle",
   words_per_caption=len(words))`.
2. Burn a frame:
   `ffmpeg -f lavfi -i color=c=0x2a2f3a:s=1080x1920:d=3 -vf "subtitles=c.ass:fontsdir=<relative path to backend/fonts>,crop=1080:420:0:750" -ss 0.4 -frames:v 1 c.png`
   (run with `cwd` = the folder containing `c.ass`; sample at a time inside the cue).
3. Write an HTML page reproducing `StreetGlowOverlay` + the relevant `App.css`
   rules, `@font-face` pointing at `file:///…/backend/fonts/*.ttf`, body
   1080×1920, animations disabled; screenshot:
   `chrome --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1080,1920 --screenshot=p.png page.html`.
4. `hstack` the two crops; look at them; measure ink boxes with Pillow
   (red: R>180,G<110; white: min(RGB)>200).
5. Note: the probe above does not composite the gblur glow/shadow masks — it
   checks geometry. Use `_render` on a real clip for the full look.

### 11.4 Frontend build check
`cd frontend && CI=true npx craco build`.

---

## 12. Frontend internals

- `App.js`: `GET /auth/me` on load; routes `/`, `/editor`, `/payment/success|cancel`.
- `EditorPage`: loads `/usage`; shows `UploadStage` until a project exists, then
  `CaptionStudio`; `PaywallDialog`.
- `UploadStage`: file probe, Speech Engine `<select>` (`stt_engine`), Speech Mode
  buttons, upload + 2.5 s polling.
- `CaptionStudio` (≈ 1,100 lines) owns all editor state: `words`, `theme`,
  `fontId`, `wordsPerCaption`, `captionLines`, `captionPosition`, `textStyle`
  (outline/shadow/glow/background), `bold/italic`, `elements`, `sfxMarkers`,
  `scriptMode`, audio/grade values, playback (`currentTime` polled per animation
  frame while playing), selection, popovers.
  - `wordGroups = groupWordsForDisplay(words, wordsPerCaption, theme)`;
    `visibleWords` = the group containing `currentTime`.
  - Street Glow renders through `StreetGlowOverlay` (two keyed divs whose CSS
    entrance animations replay when the group changes).
  - Doodle Marker computes `doodleFitScale` from canvas `measureText` (the DOM's
    own shrink-to-fit width under-reports here).
  - Word edits: `updateWord`, `toggleWordNewLine`, `splitWord` (time-sliced by
    character position, re-indexed), `mergeWord`, `splitCaptionBeforeWord`
    (`new_caption: true`), `mergeCaptionUp` (`new_caption: false`),
    `setWordEmphasis` (**bug**: non-tiered branch references undefined
    `palettes`), `toggleWordEmphasize`, `setWordKinetic`.
  - Transform: drag (`pos_x/pos_y` on every word of the visible group), resize
    handles and Scale slider (`font_size` ratio-scaled, clamped 16–120),
    rotation, apply-to-all, reset.
  - Save = `PUT` of `payload()` (the whole state); Export = save + `POST /render`.
- `ThemePanel`: templates, fonts, layout, style layers, transform; exports
  `templates` and `fonts` lists used elsewhere.
- `TranscriptPanel`: card grouping, raw transcript, word popover
  (double-click/right-click), Re-listen, script toggle.
- `Timeline`: ruler, captions lane, filmstrip lane (frames captured from a
  hidden video every ~2.5 s), waveform lane (decoded audio; synthetic fallback);
  zoom; words/lines mode; split at playhead; SFX palette; canvas width capped
  for browser limits.
- `MomentPopover`: per-word actions, anchored to the clicked element.
- `AiToolsPanel`: local filler-word list; emphasis re-tag.
- `lib/api.js`: axios with `withCredentials`, base `REACT_APP_BACKEND_URL || localhost:8000`;
  `errorMessage` flattens FastAPI validation arrays (deduped, max 3 + "more").

---

## 13. Error handling conventions

- Provider credential/credit failures → `TranscriptionAuthError(message)` with
  the provider name and the fix; the job shows it verbatim.
- Per-chunk transient failures → `logger.exception`, skip the chunk; the overall
  "no trustworthy transcript" check decides failure.
- GPT failures in conversion → offline fallback (logged). In emphasis re-tag →
  HTTP 502.
- Render failures → `RuntimeError` with a safe message → HTTP 500 with that message.
- Frontend shows `error_message` / `errorMessage(error)` in a toast.

---

## 14. Performance characteristics (owner's PC, 2026-10-27)

| Step | ~Time for a 38 s clip |
| --- | --- |
| Upload + FFmpeg probe | 1–2 s |
| Audio extract | < 1 s |
| Sarvam-only transcription (2 chunks, sequential) | ≈ 6 s |
| GPT conversion | 2–5 s (skipped quickly on 401) |
| WebM preview (parallel) | ≈ 20 s — the long pole of the job |
| Full job | ≈ 27 s |
| High-quality render | tens of seconds; scales with length/resolution |

Chunks are processed sequentially (context carry-over depends on order).
Whole files are loaded into memory on every media request.

---

## 15. Security notes

- Repo is public; `.env` files are git-ignored; committed `*-user`/cookie files
  hold only `@example.com` test users and Cloudflare bot cookies.
- CORS reflects any origin with credentials — fine locally; restrict before hosting.
- Session tokens are bearer secrets; `X-Session-Token` header is returned on
  register/login (Emergent-era convenience).
- Uploaded media is served only to the owning user (all project queries filter by `user_id`).
- No rate limiting; no upload virus scanning; FFmpeg parses untrusted media.

---

## 16. How to …

### 16.1 Add a template
1. Backend: add to `THEMES` (and to `_apply_theme_defaults` semantics); implement
   emission in `_write_ass` (generic tiered path or a dedicated `_emit_*`
   function); set per-template `default_max_words`/`min_display`; any blur
   strengths in `render`.
2. Frontend: add to `ThemePanel.templates`; add CSS in `App.css`; add rendering
   in `CaptionStudio` (overlay component or the generic path); mirror grouping
   parameters in `groupWordsForDisplay`.
3. Verify with §11.3 for at least: 1/3/6-word groups, long English words,
   Devanagari (native mode), ascender/no-ascender lines, 2-line cases.
4. Long term: define templates in one JSON spec read by both sides.

### 16.2 Add a speech engine
1. Add the id to `STT_ENGINES` and a branch in `transcribe_words` that produces
   `[{original, start, end}]` per chunk (chunk-relative), raising
   `TranscriptionAuthError` on credential failures.
2. Keep the shared tail (repetition check, offset, overlap drop, context).
3. Add the `<option>` in `UploadStage`; update error text in `process_video`.
4. Run §11.1 on all corpus clips; record results in TRACKER.

### 16.3 Change grouping
Change Python and JS together, keep the `new_caption` tri-state semantics, and
add shared input/expected-output vectors (JSON) that both test suites read.

---

## 17. Root-cause notes from past bugs (do not reintroduce)

1. **Glued words were CSS, not transcription.** Captions showed words stuck
   together; a Sarvam merge fix (04eb454) and debug logging were added before
   the real cause was found: CSS whitespace collapse between the per-word spans
   (d6588fa), then explicit word spacing (9febc36). Before blaming the ASR,
   check the DOM.
2. **Devanagari leaking into Roman mode.** GPT sometimes returns Devanagari or
   drops indices; every path into `word.text` must go through `_romanize_fallback`.
3. **GPT's own misspellings** ("maim", "isa", "apa"): the common-word dictionary
   is checked against the ASR source *before* trusting GPT, gated by similarity.
4. **Fake bold.** Requesting bold on a single-weight font makes libass emboss and
   browsers synthesize differently → only Poppins/Caveat get bold. (The Street
   Glow line-1 inherited `font-weight:800` is a remaining instance — fix it.)
5. **Windows drive-letter colon** in `-vf subtitles=C:/…` breaks FFmpeg parsing →
   run in the temp dir with relative paths.
6. **Infinite render**: `overlay` with an unbounded `color` source needs `shortest=1`.
7. **Whisper eats the opening** of a buffer → 0.5 s silence lead-in on chunk 0;
   overlap priming on later chunks; protected no-speech window.
8. **Repetition hallucination** ("YouTube protector" ×N over music) → per-chunk
   and overall repetition rejection.
9. **Temp dir cleanup on Windows**: leaving `TemporaryDirectory` while the
   parallel preview FFmpeg still had `preview.webm` open raised `PermissionError`
   and masked the real error → always await the preview task in a `finally`.
10. **Swallowed key errors**: a 401 per chunk was caught and logged, then
    reported as "unclear audio" → `TranscriptionAuthError` aborts immediately.
11. **Validation mismatch broke export**: Pydantic bounds narrower than UI
    slider bounds made one out-of-range word fail the whole save → keep bounds identical.
12. **Sarvam keyterms with commas** are rejected by the API → strip `,`/`;`.
13. **Claimed-but-missing features**: a status table listed DP grouping,
    width-fit and gated Street Glow reveal as implemented; none were in git.
    Verify with `git grep` before relying on a status report.
