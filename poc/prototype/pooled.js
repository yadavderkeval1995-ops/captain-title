import JASSUB from "jassub";

const fontMap = {
  "Anton": "/ground_truth/fonts/Anton-Regular.ttf",
  "Playfair Display SemiBold": "/ground_truth/fonts/PlayfairDisplay-Italic.ttf",
};
const GT = "/ground_truth/";
const LAYERS = ["captions.ass", "glow_alpha.ass", "glow_color.ass", "shadow_alpha.ass", "shadow_color.ass"];

// Counts drawn pixels by ALPHA, not color: shadow_color.ass's legitimate
// content is black text (RGB 0,0,0 - _mask_dialogue_pair's shadow colour
// for Street Glow) which a colour-based "non-black" check would wrongly
// report as empty even on a correct render. The canvas starts fully
// transparent, so alpha>0 means JASSUB actually drew something there,
// regardless of what colour it drew.
function drawnPixelCount(canvas, W, H) {
  const tmp = document.createElement("canvas");
  tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(canvas, 0, 0);
  const data = tctx.getImageData(0, 0, W, H).data;
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
  return n;
}

// A small, fixed pool of JASSUB instances, each with its OWN canvas and its
// OWN WebGL context (created once, reused forever) - layers are assigned to
// pool slots round-robin and rendered ONE AT A TIME per slot (never two
// renders in flight on the same instance), trading a little latency for
// bounded, predictable resource usage instead of one-context-per-layer.
class RendererPool {
  constructor(size, W, H) {
    this.size = size;
    this.W = W; this.H = H;
    this.slots = [];
  }
  async init() {
    for (let i = 0; i < this.size; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = this.W; canvas.height = this.H;
      canvas.style.cssText = `width:${this.W}px;height:${this.H}px;visibility:hidden;position:absolute;top:0;left:0`;
      document.getElementById("container").appendChild(canvas);
      const inst = new JASSUB({
        canvas, subUrl: GT + "captions.ass", // placeholder track, immediately swapped per render
        availableFonts: fontMap,
        fonts: [fontMap["Anton"], fontMap["Playfair Display SemiBold"]],
        queryFonts: false,
        workerUrl: new URL("./bundle/jassub-worker-bundled.js", window.location.href).href,
        wasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker.wasm", window.location.href).href,
        modernWasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker-modern.wasm", window.location.href).href,
      });
      await inst.ready;
      this.slots.push({ inst, canvas, currentTrack: "captions.ass", lastMediaTime: null });
    }
  }
  // Renders `layerFile` at `mediaTime` using slot `index % size`, returns a
  // fresh standalone canvas holding the result (copied out immediately,
  // since the slot's own canvas gets overwritten by whatever layer uses
  // that slot next).
  async renderLayer(layerFile, mediaTime, index) {
    const slot = this.slots[index % this.size];
    if (slot.currentTrack !== layerFile) {
      await slot.inst.renderer.setTrackByUrl(GT + layerFile);
      slot.currentTrack = layerFile;
    }
    // manualRender's own promise is NOT a reliable signal that the draw is
    // actually visible on `slot.canvas` yet - isolating the exact trigger
    // (call order, mediaTime reuse, object identity) each produced a
    // DIFFERENT reproducible pattern under otherwise-identical conditions,
    // which points to an async paint/flush race in JASSUB's WebGL
    // compositing (through this environment's software-rendered WebGL -
    // see README) rather than one specific deterministic branch. Treating
    // it as an unreliable-paint-signal problem and verifying actual pixel
    // output - re-rendering once if the first read-back is still empty -
    // is the general fix: it holds regardless of which exact internal
    // condition triggers the race on a given call, not just the one this
    // investigation happened to isolate in simplified tests.
    let attempts = 0;
    for (; attempts < 8; attempts++) {
      await slot.inst.manualRender({ expectedDisplayTime: performance.now(), width: this.W, height: this.H, mediaTime }, true);
      await new Promise(requestAnimationFrame);
      await new Promise((r) => setTimeout(r, 30));
      const probe = drawnPixelCount(slot.canvas, this.W, this.H);
      if (probe > 0) break;
    }
    slot.lastAttempts = attempts + 1;
    const out = document.createElement("canvas");
    out.width = this.W; out.height = this.H;
    out.getContext("2d").drawImage(slot.canvas, 0, 0);
    return out;
  }
  async destroy() {
    for (const { inst } of this.slots) await inst.destroy();
  }
}

window.testScrub = async function testScrub(W, H, mediaTimes) {
  const pool = new RendererPool(1, W, H);
  await pool.init();
  const results = [];
  for (let i = 0; i < mediaTimes.length; i++) {
    const t0 = performance.now();
    await pool.renderLayer("captions.ass", mediaTimes[i], 0);
    results.push({ mediaTime: mediaTimes[i], ms: performance.now() - t0, attempts: pool.slots[0].lastAttempts });
  }
  await pool.destroy();
  document.getElementById("container").innerHTML = "";
  return results;
};

// Same blur-radius derivation as main.js (Phase C), generalized to any W:
// backend/_render's own comment gives sigma ~= 1.1 * canvasBlurPx at 1080
// output width, scaling linearly with resolution.
const SIGMA_TO_CSS_BLUR_RADIUS = 1.1;
const STREET_GLOW_GLOW_BLUR = 10;
const STREET_GLOW_SHADOW_BLUR = 3;

function drawnAlphaCanvas(canvas, W, H) {
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

// Mirrors _render()'s alphamerge (colour layer's RGB + blurred alpha-mask's
// luma as alpha), returns a standalone RGBA canvas for this one mask layer.
function compositeMaskLayer(alphaCanvas, colorCanvas, W, H, blurPx) {
  const blurred = blurredLuma(alphaCanvas, W, H, blurPx);
  const colorCopy = drawnAlphaCanvas(colorCanvas, W, H);
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

// Renders the full 5-layer Street Glow composite (glow -> shadow -> crisp
// text, same Z-order as _render()) at one mediaTime using a single reused
// pool_size=1 instance (the retry-safe, lowest-footprint configuration
// measured above), on a TRANSPARENT background (no synthetic video fill -
// this POC only needs to compare the caption layer itself, pixel for
// pixel, against a real/export-minus-source diff mask computed the same
// way on the ground-truth side). Returns the composite canvas's dataURL
// plus the raw per-layer canvases (useful for isolating core text from its
// glow halo) and per-layer timing/attempt diagnostics.
window.renderComposite = async function renderComposite(W, H, mediaTime) {
  const canvasScale = (W / 1080) * SIGMA_TO_CSS_BLUR_RADIUS;
  const glowBlurPx = (STREET_GLOW_GLOW_BLUR * canvasScale) / SIGMA_TO_CSS_BLUR_RADIUS;
  const shadowBlurPx = (STREET_GLOW_SHADOW_BLUR * canvasScale) / SIGMA_TO_CSS_BLUR_RADIUS;

  const pool = new RendererPool(1, W, H);
  const t0 = performance.now();
  await pool.init();
  const initMs = performance.now() - t0;

  const t1 = performance.now();
  const canvases = {};
  const attempts = {};
  for (const layer of LAYERS) {
    canvases[layer] = await pool.renderLayer(layer, mediaTime, 0);
    attempts[layer] = pool.slots[0].lastAttempts;
  }
  const renderMs = performance.now() - t1;
  await pool.destroy();
  document.getElementById("container").innerHTML = "";

  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const octx = out.getContext("2d");

  const glowLayer = compositeMaskLayer(canvases["glow_alpha.ass"], canvases["glow_color.ass"], W, H, glowBlurPx);
  octx.drawImage(glowLayer, 0, 0);
  const shadowLayer = compositeMaskLayer(canvases["shadow_alpha.ass"], canvases["shadow_color.ass"], W, H, shadowBlurPx);
  octx.drawImage(shadowLayer, 0, 0);
  octx.drawImage(canvases["captions.ass"], 0, 0);

  return {
    compositeDataUrl: out.toDataURL("image/png"),
    mainOnlyDataUrl: canvases["captions.ass"].toDataURL("image/png"),
    initMs, renderMs, attempts,
  };
};

// Byte-for-byte compares two canvases' pixel data - used to test whether a
// layer's rendered output is truly identical (safe to cache) across two
// separate render calls, not just "visually close."
function canvasesIdentical(c1, c2, W, H) {
  const g1 = drawnAlphaCanvas(c1, W, H).getContext("2d").getImageData(0, 0, W, H).data;
  const g2 = drawnAlphaCanvas(c2, W, H).getContext("2d").getImageData(0, 0, W, H).data;
  if (g1.length !== g2.length) return false;
  for (let i = 0; i < g1.length; i++) if (g1[i] !== g2[i]) return false;
  return true;
}

// Tests whether glow/shadow (and crisp text) layers are safe to cache once
// a caption group's entrance animation has settled: renders the SAME
// mediaTime twice (self-consistency) and DIFFERENT mediaTimes within the
// group's steady window (time-invariance - the real question for caching,
// since a cache keyed only on "same timestamp" is useless for scrubbing).
window.testCaching = async function testCaching(W, H, steadyTimes) {
  const pool = new RendererPool(1, W, H);
  await pool.init();
  const framesByLayer = {};
  for (const layer of LAYERS) framesByLayer[layer] = [];
  for (const t of steadyTimes) {
    for (const layer of LAYERS) {
      framesByLayer[layer].push(await pool.renderLayer(layer, t, 0));
    }
  }
  const results = {};
  for (const layer of LAYERS) {
    const frames = framesByLayer[layer];
    const cmp = [];
    for (let i = 1; i < frames.length; i++) {
      cmp.push({
        vs: `${steadyTimes[0]}->${steadyTimes[i]}`,
        identical: canvasesIdentical(frames[0], frames[i], W, H),
      });
    }
    results[layer] = cmp;
  }
  await pool.destroy();
  document.getElementById("container").innerHTML = "";
  return results;
};

// Simulates a real preview render loop: either sequential PLAYBACK (small
// fixed dt between frames) or random-access SCRUBBING (uniform random seeks
// within the window), rendering the FULL 5-layer composite each "frame"
// (what a real preview must do to show the complete visual, not just one
// layer) on a single warmed pool_size=1 instance. Returns per-frame latency
// and dropped-frame counts against both a 30fps (33.3ms) and 60fps (16.7ms)
// budget.
window.testPlaybackLoop = async function testPlaybackLoop(W, H, mode, frameCount, startTime, dt) {
  const pool = new RendererPool(1, W, H);
  await pool.init();
  // Warm up the instance once (pay the one-time first-render retry cost
  // outside the measured loop, matching how a real preview would warm up
  // on mount, not on the first user-visible scrub/play frame).
  await pool.renderLayer(LAYERS[0], startTime, 0);

  const times = [];
  for (let i = 0; i < frameCount; i++) {
    times.push(mode === "scrub" ? startTime + Math.random() * dt * frameCount : startTime + i * dt);
  }

  const frameMs = [];
  for (const t of times) {
    const f0 = performance.now();
    for (const layer of LAYERS) await pool.renderLayer(layer, t, 0);
    frameMs.push(performance.now() - f0);
  }
  await pool.destroy();
  document.getElementById("container").innerHTML = "";

  const over60 = frameMs.filter((m) => m > 16.7).length;
  const over30 = frameMs.filter((m) => m > 33.3).length;
  const avg = frameMs.reduce((a, b) => a + b, 0) / frameMs.length;
  const sorted = [...frameMs].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return { mode, W, H, frameCount, avgMs: avg, p50Ms: p50, p95Ms: p95, maxMs: Math.max(...frameMs),
            minMs: Math.min(...frameMs), droppedVs60fps: over60, droppedVs30fps: over30, frameMs };
};

window.testPool = async function testPool(poolSize, W, H, mediaTime, trials) {
  const results = [];
  for (let trial = 0; trial < trials; trial++) {
    const pool = new RendererPool(poolSize, W, H);
    const t0 = performance.now();
    await pool.init();
    const initMs = performance.now() - t0;

    const t1 = performance.now();
    const layerCanvases = [];
    const attemptsPerLayer = [];
    for (let i = 0; i < LAYERS.length; i++) {
      layerCanvases.push(await pool.renderLayer(LAYERS[i], mediaTime, i));
      attemptsPerLayer.push(pool.slots[i % poolSize].lastAttempts);
    }
    const allLayersMs = performance.now() - t1;

    const perLayerPixels = layerCanvases.map((c) => drawnPixelCount(c, W, H));
    await pool.destroy();
    document.getElementById("container").innerHTML = "";
    results.push({ trial, initMs, allLayersMs, perLayerPixels, attemptsPerLayer, succeeded: perLayerPixels.filter((n) => n > 50).length });
  }
  return { poolSize, W, H, trials: results };
};
