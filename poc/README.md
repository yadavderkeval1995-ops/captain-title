# Rendering-parity POC: WASM libass (JASSUB) for the Street Glow preview

Isolated proof-of-concept, branch `poc/libass-wasm-preview-parity`. Nothing in
`backend/` or `frontend/` was changed — this lives entirely under `poc/` and
is not wired into the running app.

## What this answers

Can the live preview use the *same renderer* (libass) as the export, instead
of the current hand-written CSS/JSX re-implementation per template? Scoped to
Street Glow only, per the task.

## Layout

- `generate_ground_truth.py` — calls the real, unmodified `backend/captions.py`
  functions (`_apply_theme_defaults`, `_write_ass`, `_render`) directly to
  produce an exact copy of what production actually exports for a Street Glow
  project: `ground_truth/captions.ass` (+ the 4 glow/shadow mask `.ass`
  files), `ground_truth/export.mp4`, and a copy of the real bundled fonts.
  Run with the backend's own venv: `../backend/.venv/bin/python generate_ground_truth.py`
- `ground_truth/frames/` — reference frames extracted from the real export at
  comparison timestamps via ffmpeg.
- `prototype/` — the browser-side renderer. `npm install` then serve the
  whole `poc/` directory (not just `prototype/`) with any static file server
  that sets `application/wasm` correctly, e.g. `npx serve -l 8080 .` from
  `poc/`, then open `/prototype/`.
  - `main.js` → `bundle/main-bundled.js` (esbuild) — the full 5-layer
    (crisp text + glow alpha/color + shadow alpha/color) prototype renderer.
  - `isolated.html` / `isolated.js` — single-instance test harness used to
    isolate the concurrency issue described below (`?sub=<filename>.ass`).
  - `twoinstance.html` — 2-concurrent-instance test (confirms the ceiling is
    resource contention, not a rendering bug).

JASSUB and esbuild are installed via `npm install` inside `prototype/` and
are POC-only dependencies — they are not added to `frontend/package.json`.

## Findings

**1. Core text rendering: high-fidelity match, proven.** Loading the real
`captions.ass` with the real bundled font files (`Anton-Regular.ttf`,
`PlayfairDisplay-Italic.ttf`) through JASSUB reproduces the crisp text layer
almost pixel-for-pixel. Diffed against the real export frame at the same
timestamp (0.52s, mid pop-in animation): mean per-channel difference 0.11/255,
only 4,099 of 921,600 pixels (0.44%) differ by more than 10/255, and the
diff is a thin, image-shaped halo right at the glyph edges (not a scattered
or offset pattern) — i.e. what's left over is exactly the shape of the
missing glow/shadow, not a font, shaping, or position mismatch.

**2. libass alone does NOT produce the glow/shadow — confirmed, not
assumed.** The main `captions.ass` sets `\bord0\shad0\blur0` on every line;
glow and shadow are a separate ffmpeg-level compositing step
(`_blur_mask_steps` in `captions.py`): a grey alpha mask burned onto a black
canvas, blurred with `gblur`, then `alphamerge`d with a full-color pass.
Loading only `captions.ass` in the browser gives crisp text with **no**
glow or shadow at all. Reproducing the full look requires mirroring that
exact mask-blur-composite technique in the browser too — prototyped here by
rendering `glow_alpha.ass`/`glow_color.ass`/`shadow_alpha.ass`/`shadow_color.ass`
through their own JASSUB instances, blurring the alpha mask with Canvas2D's
`filter: blur()`, and manually alpha-compositing the result (mirroring
`alphamerge` via per-pixel `ImageData` manipulation). This **works** when
tested with 2 concurrent instances (confirmed: `twoinstance.html`, both
layers render correctly together).

**3. Identical font files: confirmed working.** `availableFonts` points
JASSUB directly at the same `.ttf` files `backend/fonts/` bundles — no
separate "preview" font source, no Google Fonts CDN involved.

**4. A real, unresolved engineering problem: 5 simultaneous JASSUB instances
does not reliably render in this test environment.** The full technique
needs 5 layers (crisp + glow-alpha + glow-color + shadow-alpha +
shadow-color). Tested 1 instance (works), 2 concurrent instances (works),
5 concurrent instances (2 of 5 silently render nothing, reproducibly, both
with parallel and sequential-await instantiation) — exactly the same files
that render correctly in isolation or in pairs. This points to a browser
resource ceiling (WebGL contexts and/or WASM worker threads) somewhere
between 2 and 5 concurrent renderer instances, not a bug in the technique
itself. **This was not solved in this POC** — a production implementation
would need either a pooled/reused single instance rendering each layer
sequentially (trading some per-frame latency for reliability), or confirming
the real ceiling is higher outside this sandboxed test environment. Flagging
this honestly rather than hiding it behind a cherry-picked passing case.

**5. Performance** (single JASSUB instance, this environment):
   - Init (WASM load + worker spawn + font fetch): ~215ms cold, ~113ms warm.
   - First render after init: ~38-43ms.
   - Steady-state re-render (seeking to a new timestamp, i.e. scrubbing):
     ~1-10ms after warmup, comfortably inside a 60fps frame budget.
   - Real export (`_render`, the actual ffmpeg pipeline, glow+shadow+audio+
     x264 encode included): **2.55s for a 6-second 720×1280 clip.** Export
     is not, and was never going to be, real-time — the comparison that
     matters is preview responsiveness, where the WASM approach is fast
     once initialized.
   - These are single-instance numbers; the full 5-layer version's real
     per-frame cost (and whether the concurrency ceiling in finding #4
     affects it) was not cleanly measurable because of that unresolved issue.

## Honest caveat on the test environment

This sandbox's headless Chromium build has no H.264 decoder
(`DEMUXER_ERROR_NO_SUPPORTED_STREAMS` on the real source clip) — a build
limitation of this container, not of the approach. The background video
layer was reproduced as a flat color fill sampled from the real export frame
instead (the test source happens to be a solid-color test card, so this
doesn't affect what's actually being measured: the caption rendering). A
real deployment target (an end user's own browser) decodes H.264 natively.
