import JASSUB from "jassub";

// Cache-aware hybrid animation engine for Street Glow: renders each caption
// group's SETTLED state once via real libass (JASSUB), then reproduces the
// group's actual entrance/exit animation by applying the SAME tag math
// backend/captions.py's _emit_street_glow_group already writes into the
// real .ass (scale \t for line1, \move+\fad for line2) as a canvas
// transform/opacity on the cached bitmap, instead of re-invoking libass for
// every frame. This file deliberately re-derives those exact numbers from
// the real backend constants (STREET_GLOW_* below mirror captions.py) so
// the comparison in run_hybrid_compare.js is against the real animation,
// not an invented one.

const GT = "/ground_truth/";
const fontMap = {
  "Anton": `${GT}fonts/Anton-Regular.ttf`,
  "Playfair Display SemiBold": `${GT}fonts/PlayfairDisplay-Italic.ttf`,
};

// Mirrors backend/captions.py's STREET_GLOW_* constants and
// _emit_street_glow_group's own tag math exactly (not re-derived/guessed -
// copied from the real file so the hybrid reproduces the REAL animation).
const LINE1_POS = { x: 540, y: 1518 };
const LINE2_SETTLED = { x: 540, y: 1568 };
const LINE2_MOVE_FROM_Y = LINE2_SETTLED.y + 18; // cy2 + 18, per captions.py
const SCALE_POP_PEAK_MS = 160;
const SCALE_POP_SETTLE_MS = 240;
const SCALE_POP_PEAK = 1.08;
const MOVE_DURATION_MS = 220;
const FADE_IN_MS = 120;
const FADE_OUT_MS = 80;

const SIGMA_TO_CSS_BLUR_RADIUS = 1.1;
const STREET_GLOW_GLOW_BLUR = 10;
const STREET_GLOW_SHADOW_BLUR = 3;

function drawnCopy(canvas, W, H) {
  const tmp = document.createElement("canvas");
  tmp.width = W; tmp.height = H;
  tmp.getContext("2d").drawImage(canvas, 0, 0);
  return tmp;
}

function blurredLuma(srcCanvas, W, H, blurPx) {
  const tmp = document.createElement("canvas");
  tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext("2d");
  tctx.fillStyle = "black";
  tctx.fillRect(0, 0, W, H);
  tctx.filter = `blur(${blurPx}px)`;
  tctx.drawImage(srcCanvas, 0, 0);
  return tctx.getImageData(0, 0, W, H);
}

function compositeMaskLayer(alphaCanvas, colorCanvas, W, H, blurPx) {
  const blurred = blurredLuma(alphaCanvas, W, H, blurPx);
  const colorCopy = drawnCopy(colorCanvas, W, H);
  const colorData = colorCopy.getContext("2d").getImageData(0, 0, W, H);
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const octx = out.getContext("2d");
  const img = octx.createImageData(W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = colorData.data[i];
    img.data[i + 1] = colorData.data[i + 1];
    img.data[i + 2] = colorData.data[i + 2];
    img.data[i + 3] = blurred.data[i];
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function drawnPixelCount(canvas, W, H) {
  const c = drawnCopy(canvas, W, H);
  const data = c.getContext("2d").getImageData(0, 0, W, H).data;
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
  return n;
}

// Single reused JASSUB instance (pool size 1, the Phase D-verified fastest/
// most reliable configuration) used for the SLOW path only: capturing a
// fresh group's settled sprite the first time it's needed, or rendering a
// dense real-frame reference sequence for comparison.
class SpriteRenderer {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.canvas = document.createElement("canvas");
    this.canvas.width = W; this.canvas.height = H;
    this.canvas.style.cssText = `width:${W}px;height:${H}px;visibility:hidden;position:absolute;top:0;left:0`;
  }
  async init() {
    document.getElementById("container").appendChild(this.canvas);
    this.inst = new JASSUB({
      canvas: this.canvas, subUrl: GT + "line1_only.ass",
      availableFonts: fontMap,
      fonts: [fontMap["Anton"], fontMap["Playfair Display SemiBold"]],
      queryFonts: false,
      workerUrl: new URL("./bundle/jassub-worker-bundled.js", window.location.href).href,
      wasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker.wasm", window.location.href).href,
      modernWasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker-modern.wasm", window.location.href).href,
    });
    await this.inst.ready;
    this.currentTrack = "line1_only.ass";
  }
  async renderLayer(file, mediaTime) {
    if (this.currentTrack !== file) {
      await this.inst.renderer.setTrackByUrl(GT + file);
      this.currentTrack = file;
    }
    let attempts = 0;
    for (; attempts < 8; attempts++) {
      await this.inst.manualRender({ expectedDisplayTime: performance.now(), width: this.W, height: this.H, mediaTime }, true);
      await new Promise(requestAnimationFrame);
      await new Promise((r) => setTimeout(r, 30));
      if (drawnPixelCount(this.canvas, this.W, this.H) > 0) break;
    }
    return drawnCopy(this.canvas, this.W, this.H);
  }
  async destroy() {
    await this.inst.destroy();
    this.canvas.remove();
  }
}

// --- Hybrid cache-and-interpolate engine -----------------------------

class HybridEngine {
  constructor(W, H, groups) {
    this.W = W; this.H = H;
    this.groups = groups; // [{start, end}] in seconds, real group boundaries
    this.sprites = new Map(); // groupIndex -> {sprite1, sprite2}
    this.glowBlurPx = (STREET_GLOW_GLOW_BLUR * (W / 1080) * SIGMA_TO_CSS_BLUR_RADIUS) / SIGMA_TO_CSS_BLUR_RADIUS;
    this.shadowBlurPx = (STREET_GLOW_SHADOW_BLUR * (W / 1080) * SIGMA_TO_CSS_BLUR_RADIUS) / SIGMA_TO_CSS_BLUR_RADIUS;
    this.scaleX = W / 1080;
  }
  async init() {
    this.renderer = new SpriteRenderer(this.W, this.H);
    await this.renderer.init();
  }
  groupIndexAt(mediaTime) {
    for (let i = 0; i < this.groups.length; i++) {
      if (mediaTime >= this.groups[i].start && mediaTime < this.groups[i].end) return i;
    }
    return -1;
  }
  // The expensive path: one real libass render per needed layer (4 total -
  // text1, glow1-alpha, glow1-color, text2, shadow2-alpha, shadow2-color -
  // 6 calls) to build this group's two cacheable sprites, captured at its
  // SETTLED instant (groupStart + 240ms, after both lines' entrance
  // animations finish). Only runs once per group, ever.
  async captureGroup(i) {
    if (this.sprites.has(i)) return { cacheHit: true, ms: 0 };
    const t0 = performance.now();
    const g = this.groups[i];
    const settledAt = g.start + 0.24;
    const text1 = await this.renderer.renderLayer("line1_only.ass", settledAt);
    const glowA = await this.renderer.renderLayer("glow_alpha.ass", settledAt);
    const glowC = await this.renderer.renderLayer("glow_color.ass", settledAt);
    const glowLayer = compositeMaskLayer(glowA, glowC, this.W, this.H, this.glowBlurPx);
    const sprite1 = document.createElement("canvas");
    sprite1.width = this.W; sprite1.height = this.H;
    const s1ctx = sprite1.getContext("2d");
    s1ctx.drawImage(glowLayer, 0, 0);
    s1ctx.drawImage(text1, 0, 0);

    const text2 = await this.renderer.renderLayer("line2_only.ass", settledAt);
    const shadowA = await this.renderer.renderLayer("shadow_alpha.ass", settledAt);
    const shadowC = await this.renderer.renderLayer("shadow_color.ass", settledAt);
    const shadowLayer = compositeMaskLayer(shadowA, shadowC, this.W, this.H, this.shadowBlurPx);
    const sprite2 = document.createElement("canvas");
    sprite2.width = this.W; sprite2.height = this.H;
    const s2ctx = sprite2.getContext("2d");
    s2ctx.drawImage(shadowLayer, 0, 0);
    s2ctx.drawImage(text2, 0, 0);

    this.sprites.set(i, { sprite1, sprite2 });
    return { cacheHit: false, ms: performance.now() - t0 };
  }
  // The fast path: pure canvas transform/opacity math, no libass call at
  // all. Returns a frame + per-frame diagnostics (cache hit, latency).
  async renderFrame(mediaTime) {
    const t0 = performance.now();
    const gi = this.groupIndexAt(mediaTime);
    const out = document.createElement("canvas");
    out.width = this.W; out.height = this.H;
    const octx = out.getContext("2d");
    if (gi === -1) {
      return { canvas: out, groupIndex: -1, cacheHit: true, captureMs: 0, frameMs: performance.now() - t0 };
    }
    const cap = await this.captureGroup(gi);
    const { sprite1, sprite2 } = this.sprites.get(gi);
    const g = this.groups[gi];
    const tRelMs = (mediaTime - g.start) * 1000;
    const tToEndMs = (g.end - mediaTime) * 1000;

    // Line 1: scale pop around its own \pos anchor - EXACT two-segment
    // linear interpolation copied from captions.py's \t(0,160,...)\t(160,240,...).
    let scale = 1.0;
    if (tRelMs >= 0 && tRelMs < SCALE_POP_PEAK_MS) {
      scale = 1.0 + (SCALE_POP_PEAK - 1.0) * (tRelMs / SCALE_POP_PEAK_MS);
    } else if (tRelMs >= SCALE_POP_PEAK_MS && tRelMs < SCALE_POP_SETTLE_MS) {
      scale = SCALE_POP_PEAK - (SCALE_POP_PEAK - 1.0) * ((tRelMs - SCALE_POP_PEAK_MS) / (SCALE_POP_SETTLE_MS - SCALE_POP_PEAK_MS));
    }
    // Line 1 has NO exit animation in the real template - hard cut at
    // group end, so no opacity ramp here; it simply stops being drawn once
    // mediaTime >= g.end (handled by groupIndexAt returning -1).
    if (tRelMs >= 0) {
      const cx = LINE1_POS.x * this.scaleX, cy = LINE1_POS.y * this.scaleX;
      octx.save();
      octx.translate(cx, cy);
      octx.scale(scale, scale);
      octx.translate(-cx, -cy);
      octx.drawImage(sprite1, 0, 0);
      octx.restore();
    }

    // Line 2: \move (position) + \fad (in at start, out at end) - exact
    // linear math copied from captions.py's \move(...,0,220)\fad(120,80).
    let dy = 0;
    if (tRelMs >= 0 && tRelMs < MOVE_DURATION_MS) {
      const fromY = LINE2_MOVE_FROM_Y, toY = LINE2_SETTLED.y;
      const y = fromY + (toY - fromY) * (tRelMs / MOVE_DURATION_MS);
      dy = (y - LINE2_SETTLED.y) * this.scaleX;
    }
    let opacity = 1;
    if (tRelMs >= 0 && tRelMs < FADE_IN_MS) {
      opacity = tRelMs / FADE_IN_MS;
    } else if (tToEndMs >= 0 && tToEndMs < FADE_OUT_MS) {
      opacity = tToEndMs / FADE_OUT_MS;
    }
    if (tRelMs >= 0) {
      octx.save();
      octx.globalAlpha = Math.max(0, Math.min(1, opacity));
      octx.drawImage(sprite2, 0, dy);
      octx.restore();
    }

    return { canvas: out, groupIndex: gi, cacheHit: cap.cacheHit, captureMs: cap.ms, frameMs: performance.now() - t0 };
  }
  async destroy() {
    await this.renderer.destroy();
  }
}

window.HybridEngine = HybridEngine;
window.SpriteRenderer = SpriteRenderer;
window.__drawnPixelCount = drawnPixelCount;
window.__hybridReady = true;
