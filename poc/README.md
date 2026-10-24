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

This sandbox's headless Chromium also renders WebGL in **software**
(SwiftShader, confirmed via `WEBGL_debug_renderer_info`:
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device...`), not real GPU hardware
acceleration. Every latency/concurrency number below was measured under
that constraint — a real end-user browser with hardware WebGL should be
faster and likely less prone to the render-contention pattern found in
finding #2 below, though that has not been verified on real hardware in
this POC.

---

## Phase D: concurrency fix, 1080p parity, and verified glow/shadow root-cause

Phase C left two things unresolved: the 5-instance concurrency problem, and
whether the preview genuinely lines up with the real export (checked then
only via whole-frame pixel diff at 720×1280). Phase D re-tested everything
at full production resolution (1080×1920), systematically root-caused the
concurrency issue instead of assuming a hard ceiling, and measured caption
geometry and glow/shadow fidelity directly instead of relying on a
whole-frame diff percentage.

### 1. The "5-instance ceiling" was not a ceiling — it was a first-render race, now fixed

Methodical isolation (`order_test.js`'s `testOrder`/`testWarmup`, see code)
disproved three theories in turn: it is not tied to instance count, not tied
to which file renders first, and not fixed by a warmup render at a matching
timestamp once that same logic was lifted into a real multi-instance
harness. What actually explains every observed failure: **a given JASSUB
instance's very first `manualRender()` call does not reliably flush its
draw to the canvas before its promise resolves.** Every render after that
first one, on that same instance, succeeds immediately. This is consistent
with an async paint/flush race in JASSUB's WebGL compositing, likely
amplified by this environment's software-rendered WebGL.

**Fix** (`pooled.js`, `RendererPool.renderLayer`): after each
`manualRender`, wait a frame (`requestAnimationFrame`) + 30ms, then verify
the canvas actually has non-zero-alpha pixels; retry (up to 8x) if not.
Verified **100% reliable across pool sizes 1, 2, and 5** (9 trials × 5
layers = 45 layer-renders, zero failures). The retry-count pattern is fully
explained: only each instance's first-ever render needed a retry (typically
1 extra attempt); every later render on that instance, at any mediaTime,
succeeded on the first try (confirmed separately via `testScrub`: scrubbing
through 8 different timestamps on one warmed-up instance took 65-100ms each
with 1 attempt, after the initial instance's one-time 2-3-attempt first
render).

**Pool-size comparison, full 5-layer composite, 1080×1920, 5 trials each:**

| Pool size | Init | All-5-layers render | Notes |
|---|---|---|---|
| 1 (sequential reuse) | ~110-195ms | ~465-590ms | Only the very first layer ever rendered needs a retry |
| 5 (one instance/layer) | ~470-560ms | ~725-1020ms | *Slower*, not faster — every layer needs a retry, not just the first, because 5 concurrent WebGL contexts contend for the same software rasterizer |

**Recommendation: pool size 1** (a single reused JASSUB instance,
layers rendered sequentially via `setTrackByUrl`) — it is simultaneously
the fastest, the lowest-resource, and equally reliable to a larger pool in
this environment. This is the opposite of what finding #4 in Phase C
guessed ("pooled... trading latency for reliability") — pooling at size 1
costs no latency at all here; it is strictly better than more concurrency.

### 2. Full-resolution (1080×1920) regeneration

Ground truth was regenerated calling the real, unmodified
`backend/captions.py` pipeline directly, with the source video pre-scaled
to 1080×1920 (`_render`'s filter_complex sizes its glow/shadow mask
canvases to `video_width`/`video_height` but does not itself resize the
source stream — a POC harness detail, not a production bug, since
production's uploaded video and project dimensions already agree). Three
timestamps were extracted from the real export, chosen from the actual
`.ass` animation windows for caption group 1: `0.48s` (entrance — 80ms
into the scale-pop/move-in), `1.40s` (fully visible — animations settled),
`2.18s` (near the group's end). Note an asymmetry in the Street Glow
template's own design: line 2 ("mein hain") fades in/out via `\fad`, but
line 1 ("JAB AAP PRACTICE") has no exit animation — it hard-cuts at the
group boundary — so there is no true "exit" animation state to test for
line 1 within a single group.

A horizontal banding artifact visible in the extracted 1080p frames was
traced directly to the raw background video *before* any caption
compositing (same artifact present in a frame pulled straight from
`source_1080x1920.mp4`) — pre-existing in the original test fixture, not
something the caption pipeline introduces, and not investigated further.

### 3. Vertical alignment and caption positioning: essentially exact

The user's original concern was about vertical alignment and positioning
accuracy. This was measured directly rather than assumed:

- **Ground-truth caption mask**: real export frame minus the real
  pre-caption source frame at the identical timestamp (both decoded from
  real ffmpeg output — no synthetic threshold against a guessed background
  color). Isolates exactly which pixels the caption compositing changed.
- **WASM caption mask**: the alpha channel of the pooled renderer's 5-layer
  composite (glow → shadow → crisp text, same Z-order as `_render`),
  rendered via the retry-safe `RendererPool`.
- Both masks were row-scanned to find line 1 and line 2's bounding boxes
  independently (two distinct vertical ink bands).

**Crisp-text-only geometry (no glow/shadow contribution at all, from the
WASM `captions.ass` layer alone vs. a high-threshold "core ink" mask on the
ground truth) at the fully-visible and exit timestamps:**

| | Ground truth | WASM | Diff |
|---|---|---|---|
| Line 1 ("JAB AAP PRACTICE") width | 280px | 282px | +2px |
| Line 1 height | 38px | 37px | -1px |
| Line 1 center X | 539.5 | 539.5 | 0px |
| Line 1 center Y | 1522.5 | 1522.0 | -0.5px |
| Line 1 baseline Y | 1541 | 1540 | -1px |
| Line 2 ("mein hain") width | 138px | 139px | +1px |
| Line 2 center X | 539.5 | 539.0 | -0.5px |
| Line 2 center Y | 1569.5-1570.0 | 1569.5 | ~0px |
| Line 2 baseline Y | 1582 | 1582 | 0px |

All offsets are within 0-2px at 1080×1920 — within anti-aliasing/sub-pixel
noise. **Text position, size, and baseline match the real export almost
exactly at every timestamp tested.** The entrance timestamp (0.48s, mid
scale-pop/move-in animation) also visually matches in the side-by-side and
50%-opacity overlay images (see below) — no visible lag or offset during
the animation.

This directly answers the "vertical alignment/positioning" concern: it is
not where the preview and export diverge.

### 4. Where they *do* diverge: glow blur tail shape, not position

At the fully-visible timestamp (1.40s), the automatic line1/line2 band
separation that worked cleanly in ground truth (and at the other two
timestamps in WASM) merged into one band in the WASM render — investigated
directly rather than dismissed as noise. A pixel-by-pixel profile through
the gap between the two lines (`x=539, y=1540-1575`) shows why:

- **Ground truth**: diff-vs-source drops to exactly 0 for a run of ~15-18
  rows in the gap, at all three timestamps — a clean valley.
- **WASM**: alpha never reaches 0 in that same gap at the fully-visible and
  exit timestamps — it bottoms out around 1-12 (out of 255) before rising
  into line 2's own halo, a measurably fatter tail.

Root cause: Canvas2D's `filter: blur()` (used to mirror ffmpeg's `gblur`
mask blur in-browser) is a browser-vendor approximation, not a true
Gaussian, and its spatial falloff/tail shape does not match ffmpeg's
`gblur` even after sigma-matching via the backend's own documented
`SIGMA_TO_CSS_BLUR_RADIUS≈1.1` constant — that constant was derived to match
the blur's overall visible width at one reference point, not its full decay
curve. The gap between line 1 and line 2 narrows from ~28px (entrance) to
~16px (settled) purely from the template's own `\move` animation, which is
exactly where a longer blur tail becomes visible as a merged band instead of
two. This is **real and measured, not a thresholding artifact** (verified
at multiple threshold levels), but it is also **subtle in practice** — not
visible as a defect in the rendered images at normal viewing (see the
50%-opacity overlay: no visible doubling or ghosting at any timestamp), and
it affects only the glow/shadow halo, not text position or crispness.

### 5. Region-limited, categorized diff numbers

Computed within a fixed 480×230px crop around the caption (not the whole
1080×1920 frame — the user was explicit that a low whole-frame diff is not
the goal):

| Timestamp | Whole-frame diff (informational only) | Caption-region diff | Core-text mask IoU | Glow-halo zone mean abs diff (0-765 scale) |
|---|---|---|---|---|
| 0.48 (entrance) | 0.20% | 3.73% | 65.2% | 3.3 |
| 1.40 (fully visible) | 0.23% | 4.39% | 55.0% | 5.2 |
| 2.18 (exit) | 0.24% | 4.47% | 66.4% | 3.6 |

The whole-frame number (first column) is the misleading metric Phase C
originally reported and the user explicitly flagged as insufficient — it
looks excellent regardless of what's happening in the caption itself,
because the caption only covers a small fraction of a 1080×1920 frame. The
region-limited number is ~20x larger and more honest, though still small in
absolute terms. Core-text IoU (hard overlap of high-threshold "ink" pixels)
sitting at 55-66% looks lower than the sub-2px bbox match above would
suggest — that's a known sensitivity of binary-mask IoU to text's high
edge-to-fill ratio (a 1px anti-aliasing shift along a glyph's whole outline
measurably moves IoU even when the shape's center and size are correct);
the bbox/baseline comparison in section 3 is the more meaningful geometry
metric for exactly this reason. The glow-halo zone's mean difference (out
of a possible 0-765) is low across all three timestamps, consistent with
section 4's finding that the blur-tail mismatch is measurable but visually
subtle.

Full-resolution side-by-side, 50%-opacity overlay (with horizontal/vertical
guides through the caption's center and both lines' baselines), and
close-up crops for all three timestamps are in `results/1080p/`.

### 6. Performance and memory at full 1080×1920 resolution (pool size 1)

- Full 5-layer composite (what one visually-complete preview frame
  actually costs): **~465-590ms**, i.e. roughly **1.7-2.2 composite
  frames/sec** — not real-time scrubbing, but a static "snap to this
  timestamp and render" preview update is comfortably sub-second.
- Steady-state re-render of a single already-warm layer at a new
  timestamp (the per-layer cost while scrubbing, once the one-time
  first-render cost is paid): **~65-100ms** (~10-15fps for one layer;
  the full visual needs all 5 layers composited, so real scrubbing FPS is
  bounded by the number above, not this one).
- Total Chromium process RSS grew by **~200-230MB** after one full
  construct→render→destroy pool cycle and did not immediately drop back to
  baseline after `destroy()` — expected behavior for a WASM/V8 allocator
  that retains freed pages for reuse rather than returning them to the OS
  immediately, not a confirmed leak (not shown to grow further on repeated
  cycles in these tests). No meaningful memory difference was found between
  pool sizes 1 and 5.
- **All of the above was measured under this environment's software WebGL
  (SwiftShader) — see the caveat above. Real hardware-accelerated browsers
  are expected to be faster; this was not independently verified on real
  hardware in this POC.**

### Phase D summary

- The 5-instance reliability problem is solved, understood, and the fix
  (retry-with-pixel-verification inside a reused pool-size-1 instance) is
  simultaneously the fastest and lowest-resource option measured.
- Vertical alignment / caption positioning — the user's original
  concern — is not where this approach diverges from the real export: text
  position, size, and baseline match within 0-2px at 1080×1920 across all
  three animation states tested.
- The one real, measured, root-caused difference is the glow/shadow blur's
  spatial tail shape (Canvas2D `blur()` vs ffmpeg `gblur`), which is subtle
  visually but real in the pixel data, concentrated in the gap between the
  two caption lines at their closest (settled/steady-state) spacing.
- Performance and memory numbers are only meaningful as measured in this
  software-WebGL sandbox, not validated on real GPU hardware.
- **No integration has been proposed in this phase, per the governing
  instruction.** This document reports results only.
