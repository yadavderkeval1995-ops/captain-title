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

### Phase D summary (superseded in part by Phase E below — see the real-time-performance caveat there)

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

---

## Phase E: real-time performance — resolution-aware rendering, caching, and architecture fit

Phase D proved visual *correctness* (positions, geometry, glow/shadow all
match the real export closely). The user's next concern, explicitly, is
*speed*: will this hold up as a live, interactive preview — not just a
batch of still frames compared after the fact. This phase tests that
directly, still entirely inside `poc/`, no production files touched, no
merge, no new templates.

### 1. Rendering at actual preview resolution (not fixed 1080×1920)

`pooled.js`'s `renderComposite(W, H, mediaTime)` already took resolution as
a parameter (Phase D just always called it with 1080×1920). Called instead
at 1080×1920, 540×960, and 360×640 for the same `mediaTime`, then
normalizing each result's measured bounding box back to 1080-scale units
for direct comparison:

| Resolution | Width (norm.) | Height (norm.) | Center X (norm.) | Center Y (norm.) |
|---|---|---|---|---|
| 1080×1920 (native) | 302.0 | 93.0 | 539.5 | 1538.0 |
| 540×960 | 308.0 | 96.0 | 539.0 | 1537.0 |
| 360×640 | 306.0 | 99.0 | 538.5 | 1536.0 |

All three stay within ~2% of each other, and center position is accurate
to within 1px at every size. **libass natively re-scales from the
authored script resolution (`PlayResX`/`PlayResY`, fixed at 1080×1920 in
every `.ass` file here) to whatever pixel canvas it's given** — there is
no need to regenerate or re-author captions per preview size; the exact
same `.ass` files render correctly scaled at any target resolution. The
small (~2-3%) growth in measured height at lower resolutions is consistent
with mask-threshold quantization (fewer pixels crossing the alpha
threshold at small sizes), not a real geometry error — confirmed visually
in `results/multi_res/native_vs_upscaled_360.png` (native 1080p vs. a
360p-native render blown back up: same proportions, same position, the
only visible difference is the upscaled copy's own pixelation from
nearest-neighbor magnification, which a real preview would never do since
it displays the native render at native size).

### 2. Glow/shadow/text layer caching: safe, and the key to real-time performance

Rendered all 5 layers (crisp text, glow alpha/color, shadow alpha/color)
at 5 different timestamps spanning a caption group's *settled* window
(0.70s-2.10s into a group whose entrance animation finishes at ~0.22-0.24s)
at a typical preview size (540×960), then compared every later frame
against the first **byte-for-byte**. **Result: 100% identical across all 5
layers at all 5 timestamps tested** (`poc/prototype/pooled.js`'s
`testCaching`). Once a caption group's entrance animation settles, its
rendered bitmap is exactly time-invariant until the group ends — a clean,
provable cache key (caption group ID + "settled" boolean, not exact
timestamp).

This matters enormously for performance (see #3): a cached composite
bitmap costs **~0.04ms** to redraw via `drawImage` (measured: 60 blits,
avg 0.043ms, max 2.5ms) — i.e., essentially free, nowhere near a frame
budget concern.

### 3. Smooth playback and scrubbing: not with naive per-frame re-render — yes with caching

Simulated both sequential **playback** (30 frames at 1/30s steps) and
random-access **scrubbing** (30 random seeks) at both requested preview
sizes, rendering the *full 5-layer composite every simulated frame* (what
a naive "just call the renderer on every `requestAnimationFrame`" preview
would do):

| Config | Avg frame time | p95 | Dropped vs. 60fps (16.7ms) | Dropped vs. 30fps (33.3ms) |
|---|---|---|---|---|
| 360×640 playback | 271ms | 251ms | 30/30 | 30/30 |
| 360×640 scrub | 250ms | 253ms | 30/30 | 30/30 |
| 540×960 playback | 272ms | 256ms | 30/30 | 30/30 |
| 540×960 scrub | 250ms | 255ms | 30/30 | 30/30 |

**Every single simulated frame missed both budgets, at both sizes, in
both modes — this naive architecture is not real-time capable.** The cost
barely drops from 360×640 to 540×960 (and only ~2x from 1080p down to
either), which tells you the bottleneck is **not raster/pixel work** —
it's the fixed per-layer overhead of 5 separate WASM/worker round-trips
(`setTrackByUrl` + `manualRender` + the retry-verification from Phase D),
paid 5 times per frame regardless of how few pixels are being drawn.

Combined with finding #2, this reframes the real answer: **don't re-render
every frame.** A cache-aware preview — render once when a caption group's
entrance animation settles, reuse (blit) that bitmap for every frame until
the next group starts — makes steady-state playback and scrubbing
effectively free (~0.04ms/frame, no dropped frames, no contest). What
remains genuinely expensive, and is **not** solved by caching, is the
*brief animation window itself* (~220-240ms per group in Street Glow): at
~250-580ms per full composite render, rendering that window frame-by-frame
via JASSUB would itself play back in visible slow motion. This is the one
real open problem for smooth animated transitions, not steady display —
see the recommendation at the end.

### 4. Performance at the two requested preview sizes (360×640, 540×960)

| Resolution | Init (3 trials) | Full 5-layer composite (3 trials) | Chromium RSS growth after one cycle |
|---|---|---|---|
| 360×640 | 113-180ms | 260-287ms | ~58MB (357→415MB) |
| 540×960 | 105-132ms | 296-300ms | ~85MB (357→442MB) |
| 1080×1920 (Phase D, for reference) | 98-235ms | 458-624ms | ~200-230MB |

Init time is roughly resolution-independent (WASM/worker/font loading
dominates, not canvas size). Memory growth scales down meaningfully at
preview sizes vs. full export resolution.

### 5. Memory, init, latency, dropped frames — consolidated

Covered above (#3, #4): dropped frames are 100% under naive per-frame
re-render and 0% under cache-and-blit; init is ~100-235ms regardless of
size; full-composite latency is ~260-620ms depending on resolution; memory
growth is ~60-230MB per render cycle depending on resolution, and did not
compound further on repeated cycles in these tests (not stress-tested
across a long multi-hour editing session in this POC).

### 6. Quality consistency: preview resolution → full export

Addressed together with #1: native rendering at 360×640/540×960 produces
geometry that normalizes back to within ~1-2% of native 1080×1920
rendering (center position within 1px), and visually matches (see
`results/multi_res/native_vs_upscaled_360.png`). Because the SAME `.ass`
files and the SAME libass renderer are used at every size — just with a
different output canvas — there is no separate "preview-quality" vs.
"export-quality" render path to drift apart, unlike the current CSS-based
preview which is a structurally different renderer (browser text layout)
from the export (ffmpeg/libass).

### 7. Architecture fit for other template effects

Grounded directly in what `backend/captions.py` already does (not
speculation):

- **Animated highlights** (color sweeps, scale pops, position moves):
  already proven, both in production (Street Glow's own `\t(0,160,\fscx108
  \fscy108)` scale-pop and `\move`/`\fad` line-2 entrance) and re-confirmed
  in Phase D's parity testing (entrance-timestamp geometry matched within
  2px). `\t`-interpolated tag animation is solid, no new finding needed.
- **SVG-like vector shapes**: already proven in production — Doodle
  Marker's pill and pencil-loop decorations are genuine ASS `\p` vector
  drawings (`_doodle_pill_path`/`_doodle_loop_path` in `captions.py`), not
  CSS. libass draws arbitrary filled or stroked vector paths natively.
- **Word-level animation**: already proven in production (Doodle Marker's
  per-word reveal, one independent `Dialogue` per word/step). **New
  finding, correcting an existing code comment**: `captions.py` currently
  avoids an animated `\clip` + `\p` reveal, citing a repro where "a plain
  `\p1` rect with a STATIC `\clip` exactly matching its own bounds still
  came out clipped to half width" — and uses 6 discrete growth steps
  instead. This POC re-tested that exact scenario in JASSUB
  (`poc/prototype/clip_test.*`) and found the *real* cause: libass
  positions an `\an5`-anchored `\p` drawing's origin at `pos - bbox_max`
  (the path's local max corner), **not** `pos - bbox_center` — the same
  quirk `_emit_doodle_decorations` already documents and compensates for
  elsewhere in the file. A clip rectangle computed against the *naive*
  expected position (not knowing about that offset) will indeed clip the
  *actual*, shifted shape to roughly half its area — exactly the
  symptom originally reported. Once the clip rectangle is computed against
  the shape's *actual* rendered bounds (the same compensation already
  applied to position the pill/loop shapes), static `\clip` matches
  exactly, and an **animated** `\t(0,1000,\clip(...))` reveal interpolates
  correctly and smoothly (tested at 0%, 50%, ~100% progress: widths 0 →
  200 → 396 out of an expected 0 → 200 → 400px, linear as expected). This
  suggests the current 6-step discrete reveal could become a true smooth
  continuous reveal — a genuine improvement opportunity, not just parity
  — **but this was only verified in JASSUB (WASM libass); it should be
  re-confirmed against the real ffmpeg/export libass build before relying
  on it in production**, since this POC did not test the export path for
  this specific tag combination.
- **Net**: the ASS/libass feature set (vector drawing, clipping,
  interpolated tag animation, per-word timing via independent Dialogue
  events) already covers everything in Street Glow and Doodle Marker today
  and, per the tests above, covers animated highlights, SVG-like shapes,
  and word-level animation for new templates too. The constraint is not
  *expressiveness* — it's the per-layer rendering *cost* found in #3: a
  template with more effect layers costs proportionally more per
  full-composite render (each layer is a separate fixed-overhead
  JASSUB round-trip), which raises the stakes on the caching architecture
  in #2/#3 being mandatory, not optional, as the template catalog grows.

### Software WebGL vs. real GPU hardware

**Every number in this phase (and Phase D) was measured on this sandbox's
software-rendered WebGL (SwiftShader), not real GPU hardware — this could
not be tested on real hardware in this environment.** The per-frame
~250-620ms full-composite cost is the single most important number in this
report, and it is a software-rendering worst case. On a real user's
hardware-accelerated browser, raw per-layer render cost should drop
significantly (SwiftShader is a CPU fallback specifically built for
environments with no GPU access, typically an order of magnitude or more
slower than real hardware WebGL for this kind of compositing work) —
*but the fixed per-layer round-trip overhead that dominates the numbers
above (worker messaging, WASM boundary crossing, `setTrackByUrl`
reparse) is not purely a GPU-bound cost, so it should not be assumed to
shrink by the same factor.* This was not independently verified on real
hardware in this POC and should be the first thing confirmed before
trusting these specific millisecond figures for a go/no-go decision.

### Recommendation

**The architecture (WASM libass / JASSUB) is suitable for a production
caption editor with 10 initial templates, conditional on building it as a
cache-aware renderer from the start — not as a naive "re-render every
frame" preview:**

- **Steady-state caption display** (the overwhelming majority of real
  playback/scrubbing time, since caption groups last 1.6-4s and only their
  first ~220-240ms is animating): solved. Render once per group when its
  entrance animation settles, cache the bitmap, blit it (~0.04ms) for
  every subsequent frame until the next group. No dropped frames, no
  resolution penalty, scales to however many templates/layers a group
  uses since it's paid once, not per-frame.
- **The animation window itself** (~200-250ms per group): **not solved**
  by this POC. Naive full-composite re-render during that window would
  itself take longer than the animation's own real-time duration in this
  sandbox. Two credible paths forward, neither built or tested here: (a)
  render the animation's start and end states via JASSUB (both cacheable
  per #2) and interpolate between them with a cheap CSS/canvas transform
  (scale/position/opacity) for the brief transition, falling back to true
  libass rendering only once settled — mirroring what the *original* CSS
  preview already did, just now backed by libass-accurate endpoints; or
  (b) verify real GPU hardware closes enough of the gap that live
  re-render during a 220ms window becomes viable outright. Given the
  per-layer round-trip overhead this phase found to dominate over raster
  cost, (a) is the safer bet to validate first.
- **10 templates**: not a capacity concern for expressiveness (per #7,
  the ASS feature set already used in production covers animated
  highlights, vector shapes, and word-level animation) or for caching
  (per-group caching is independent of how many templates exist — only
  one group renders at a time). It does multiply how many *distinct*
  effect-layer combinations need the animation-window strategy above to
  be solved, since more layers per template means proportionally slower
  full-composite renders during that window.
- **Before integration**: validate the animation-window strategy (hybrid
  cache + CSS-tween, or confirm real-hardware WebGL performance directly),
  and re-confirm the animated-clip finding in #7 against the real export
  libass build. Both are concrete, scoped follow-ups, not reasons to
  abandon the approach — the hard parts already de-risked in Phases D/E
  (pixel-accurate geometry, resolution independence, caching safety, and
  effect expressiveness) are the ones that would have been hardest to fix
  after committing to integration.

---

## Phase F: cache-aware animation — Street Glow entrance/exit, playback, and a playable demo

Phase E showed caching makes *static* caption display free, but left the
animated transition itself (~200-250ms per group) as the one unsolved cost.
This phase builds and tests the actual fix: a hybrid engine that renders
each caption group's *settled* state once via real libass (cacheable, per
Phase E), then reproduces that group's real entrance/exit animation as a
canvas transform on the cached bitmap, using the exact tag math from
`backend/captions.py`'s Street Glow implementation — not an invented
simplified animation.

### 1-2. The hybrid engine (`poc/prototype/hybrid.js`)

Line 1 and line 2 animate independently in the real template, so each is
captured as its own sprite (text + its own glow or shadow, composited
together, full-canvas-sized): `line1_only.ass` + `glow_alpha/color.ass` for
line 1, `line2_only.ass` + `shadow_alpha/color.ass` for line 2 (two new
derived `.ass` files under `poc/ground_truth/`, split by line the same way
`glow_alpha.ass`/`shadow_alpha.ass` already were by `_emit_street_glow_group`
— not hand-simplified). Both sprites are captured once per group, at
`groupStart + 240ms` (after every entrance animation in the template has
finished). Every frame after that:

- **Line 1** (`\t(0,160,\fscx108\fscy108)\t(160,240,\fscx100\fscy100)`):
  the exact same two-segment linear scale interpolation, applied as
  `ctx.scale()` around line 1's real `\pos` anchor.
- **Line 2** (`\move(...,0,220)\fad(120,80)`): the exact same linear
  position and opacity interpolation, applied as a `drawImage` y-offset and
  `globalAlpha`.
- Line 1 has no exit animation in the real template (hard cut at group
  end) — the hybrid reproduces that exactly, not a fade that doesn't exist.

A `captureGroup()` cache keyed by caption group index makes the first
frame of any group expensive (one real render) and every frame after it
near-free — the same pattern Phase E proved, now covering genuinely
*animated* frames, not just static ones.

### 3. Hybrid vs. real render, timestamp by timestamp — not assumed equivalent

Rendered 26 real per-frame composites (the naive full-libass-render
technique from Phases D/E, used here only as ground truth) and 26 matching
hybrid frames, at the same timestamps, across the entrance window
(0.40-0.68s), the exit window (2.12-2.22s), and the group transition
(2.20-2.32s), at 540×960. Diffed within the caption region:

| Moment | Mean RGB diff on ink pixels (0-765) | % of region differing >20 |
|---|---|---|
| t=0.40 (animation start) | 0.0 | 0.0% |
| t=0.42-0.62 (mid-entrance, scale/move/fade active) | 19.9-31.7 | 1.5-2.6% |
| t=0.64+ (settled) | 0.0 | 0.0% |
| t=2.12-2.32 (exit, gap, next entrance) | 0.0 except within each group's own active window | same pattern |

**The discrepancy exists only during the ~200ms of actual motion, and is
exactly zero at rest** (both at the instant an animation starts and once
it settles) — expected, since both frames are driven from the same
underlying settled render at those instants. Visually, side-by-side
comparison at normal viewing scale shows no perceptible difference (see
`results/hybrid/sidebyside_*.png`). At 4x pixel-diff amplification
(`results/hybrid/triptych_diff_0.46.png`), a faint double-edge/ghosting
outline is visible along text strokes during the transition — consistent
with libass re-rasterizing each glyph fresh at every intermediate scale
value, versus the hybrid canvas-scaling one fixed 100%-rasterized bitmap.
This is real, measured, and honestly reported, and — per the user's own
framing for this phase — judged against actual visual quality rather than
chasing a lower pixel-diff number: it is not visible without amplification.
The group transition itself (`results/hybrid/transition_sequence.png`) is
clean — no flash, no leftover content from the previous group, no
double-exposure.

### 4-6. Playback, scrubbing, seeking backward, pause/resume, memory

All four driven through one `HybridEngine` instance at 540×960 (results in
`poc/results/hybrid/`):

| Test | Frames | Avg | p50 | p95 | Max | Dropped (33.3ms budget) |
|---|---|---|---|---|---|---|
| Continuous 30fps playback, 0-2.5s (spans group 0 entrance→steady→exit, the gap, group 1 entrance) | 75 | 13.2ms | 1.3ms | 11.9ms | 438ms | 2/75 (2.7%) |
| Rapid random-access scrubbing, 0-4.8s | 60 | 8.0ms | 1.4ms | 10.6ms | 362ms | 1/60 (1.7%) |
| Seek backward (forward into group 1, back into cached group 0, repeatedly) | 10 | 1.3ms | 1.3ms | 1.5ms | 1.5ms | 0/10 |
| Pause (hold one frame, 20x) | 20 | 1.5ms | 1.4ms | 2.7ms | 2.7ms | 0/20 |
| Resume (6 frames forward after pause) | 6 | 1.3ms | 1.3ms | 1.3ms | 1.3ms | 0/6 |

**Every dropped frame in every test is a one-time, predictable cache miss
— the first time a specific caption group is reached, whichever test
reaches it first.** Once touched, a group never costs more than ~1-3ms
again for the rest of that engine's lifetime, including after seeking
away and back. This is a qualitatively different result from Phase E's
naive per-frame re-render (100% dropped, every frame, every mode): caching
plus transform-based interpolation makes animated playback and scrubbing
real-time in this environment, with isolated, explainable exceptions
rather than a systemic failure.

Memory: Chromium RSS grew from 356MB to 513MB (~157MB) over the full test
run, which captured and held all 3 groups' sprites simultaneously across
playback + scrub + seek-back + pause/resume in one engine instance — in
line with Phase E's per-group memory findings, not a new concern, though
not stress-tested across a long multi-hour session with many more groups.

**The one real product concern this surfaces**: a user who scrubs or plays
into a caption group for the very first time will see one ~300-800ms stall
(depending on resolution; higher at 1080p per Phase D/E) before that
group's animation plays. This POC does not solve that — the natural fix,
not built here, is prefetching: warm the *next* group's cache slightly
before playback reaches it (a standard video-player pattern), which turns
the one remaining stall into something that happens off-screen rather
than on a frame the user is watching.

### 7. Playable demonstration

Published as an interactive artifact: **[Street Glow Hybrid
Preview](https://claude.ai/artifact/3eKJXrUnK3pDo8axZUP5DX)**. Play,
scrub, step frame-by-frame, or jump to each group's entrance/exit. A
compare toggle swaps the live canvas to the nearest captured real libass
render (26 available, spanning the same entrance/exit/transition windows
tested above) with a labeled tag, so the real and hybrid renders can be
viewed one at a time at the same timestamp. Built from the same real
exported sprite PNGs and the same interpolation code as the test harness
above — not a separate, prettier simplification.

### 8. Does this extend to Doodle Marker and future word-level effects?

**Partially proven, partially open — assessed honestly rather than
assumed:**

- **Transform-based effects** (scale, position, opacity — what Street Glow
  uses, and what covers most "pop in," "slide in," "fade" style highlight
  animations): directly covered by exactly this architecture, now proven
  end to end.
- **Doodle Marker's pill/loop reveal is structurally different** — it is
  not a transform of a fixed shape, it is the shape itself growing
  (currently implemented as 6 discrete stepped `Dialogue` events in
  `captions.py`, specifically because of the `\clip`+`\p` investigation
  from Phase E). Two credible paths, **neither built or tested in this
  phase**: (a) cache the fully-grown decoration as a sprite and reveal it
  with an animated CSS `clip-path` (a native, GPU-accelerated reveal
  primitive distinct from scale/translate/opacity, but still "cache once,
  animate via CSS"); or (b) keep using real libass rendering for these
  specifically, since Phase E found animated `\clip`+`\p` reveals do
  render correctly, and a single small word-level decoration shape is a
  much cheaper render than a full-frame multi-layer composite — possibly
  cheap enough to render live even without caching. Both are reasonable;
  neither has been measured.
- **General rule for future templates**: any effect expressible as a
  transform or a CSS-native reveal (clip-path, mask) on a cached raster
  fits this architecture with the same caching discipline proven in this
  phase. An effect that changes the rasterized shape frame-by-frame in a
  way CSS/canvas can't approximate — per-letter procedural distortion,
  true particle effects — would not be cacheable this way, and this POC
  has not found or tested a fix for that category. That is the one honest
  ceiling on "10 templates" as asked: it bounds *effect design*, not
  template count.

### Phase F recommendation

**Adopt the hybrid cache-and-interpolate architecture, with three specific,
scoped limitations to close before integration:**

1. **Prefetching isn't built.** The one-time per-group stall (~300-800ms)
   is real and user-visible on first visit to a group. Needs a standard
   look-ahead/prefetch strategy, not a redesign — low risk, not yet done.
2. **Doodle Marker's reveal-by-growth effect needs its own prototype.**
   Street Glow's transform-based animation is proven; a clip-path-based (or
   continued-live-render) approach for shape-growth effects is proposed
   but not measured.
3. **Real GPU hardware is still unverified.** Every number in Phases D-F
   comes from this sandbox's software WebGl (SwiftShader). The *shape* of
   the result (caching solves steady state; transforms solve transitions;
   a small, bounded, visually-subtle discrepancy exists during motion) is
   expected to hold on real hardware, but the specific millisecond numbers
   are a software-rendering worst case and should be the first thing
   confirmed with real users' browsers before finalizing a go/no-go.

None of these three are reasons to investigate a different rendering
approach — they are the concrete, bounded remainder of de-risking an
architecture whose hard parts (pixel-accurate geometry, resolution
independence, caching correctness, and now animated-transition
performance) are already proven across Phases D, E, and F.
