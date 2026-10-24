import JASSUB from "./node_modules/jassub/dist/jassub.js";

const log = (msg) => {
  document.getElementById("log").textContent += msg + "\n";
  console.log(msg);
};

const W = 720, H = 1280;
const GT = "/ground_truth/";

// Exact same formula backend/captions.py's _render() uses to convert an
// authored blur strength into a real gblur sigma for THIS output
// resolution (720x1280, matching the ground-truth export exactly).
const SIGMA_TO_CSS_BLUR_RADIUS = 1.1;
const canvasScale = (W / 1080) * SIGMA_TO_CSS_BLUR_RADIUS;
const STREET_GLOW_GLOW_BLUR = 10;
const STREET_GLOW_SHADOW_BLUR = 3;
const glowSigma = STREET_GLOW_GLOW_BLUR * canvasScale;
const shadowSigma = STREET_GLOW_SHADOW_BLUR * canvasScale;
// Canvas2D's filter:blur(Npx) and ffmpeg's gblur=sigma=S aren't the same
// parameterization - backend's own comment derives S ~= 1.1 * N empirically
// (a 20px CSS blur matched a sigma=22 gblur pass). Inverting that same
// measured ratio here to go from sigma back to a CSS/Canvas2D blur radius.
const glowBlurPx = glowSigma / SIGMA_TO_CSS_BLUR_RADIUS;
const shadowBlurPx = shadowSigma / SIGMA_TO_CSS_BLUR_RADIUS;
log(`glow sigma=${glowSigma.toFixed(2)} -> canvas blur ${glowBlurPx.toFixed(2)}px`);
log(`shadow sigma=${shadowSigma.toFixed(2)} -> canvas blur ${shadowBlurPx.toFixed(2)}px`);

const fontMap = {
  "Anton": `${GT}fonts/Anton-Regular.ttf`,
  "Playfair Display SemiBold": `${GT}fonts/PlayfairDisplay-Italic.ttf`,
};

async function makeInstance(canvasId, subUrl) {
  const canvas = document.getElementById(canvasId);
  const instance = new JASSUB({
    canvas,
    subUrl,
    availableFonts: fontMap,
    fonts: [fontMap["Anton"], fontMap["Playfair Display SemiBold"]],
    queryFonts: false,
    // worker/worker.js has bare CJS/ESM-mixed imports (abslink,
    // lfa-ponyfill) the browser's native module resolver can't handle -
    // bundled once via esbuild into a single self-contained file instead
    // of fighting import maps for a CJS package with no ESM build. The
    // .wasm files themselves don't need bundling - worker.js fetches them
    // at runtime from whatever URL it's given, so pointing straight at
    // the real files already installed by npm is simplest.
    workerUrl: new URL("./bundle/jassub-worker-bundled.js", window.location.href).href,
    wasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker.wasm", window.location.href).href,
    modernWasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker-modern.wasm", window.location.href).href,
  });
  await instance.ready;
  return instance;
}

const t0 = performance.now();
// Instantiated SEQUENTIALLY, not via Promise.all: 5 concurrent JASSUB
// instances (5 Workers + 5 WASM instances initializing at once) produced
// silently-empty renders for 2 of the 5 in this environment (confirmed:
// the exact same files render correctly when loaded one at a time, see
// isolated.html/isolated.js) - a real concurrency/resource-contention
// limitation of the current approach, documented in the POC report, not
// worked around invisibly here.
const main = await makeInstance("main", GT + "captions.ass");
const glowAlpha = await makeInstance("glowAlpha", GT + "glow_alpha.ass");
const glowColor = await makeInstance("glowColor", GT + "glow_color.ass");
const shadowAlpha = await makeInstance("shadowAlpha", GT + "shadow_alpha.ass");
const shadowColor = await makeInstance("shadowColor", GT + "shadow_color.ass");
const initMs = performance.now() - t0;
log(`JASSUB init (5 instances, WASM+fonts load) took ${initMs.toFixed(1)}ms`);

// NOTE: this sandbox's headless Chromium build has no H.264 decoder
// (DEMUXER_ERROR_NO_SUPPORTED_STREAMS on the real source.mp4 - a build
// limitation of this environment, not a limitation of the approach: a
// real end-user's browser decodes H.264 natively almost universally).
// The ground-truth test clip is itself a flat-color card, so the
// background layer is reproduced as a solid fill sampled from the real
// exported frame instead of decoding video, which does not affect what
// this POC actually measures (the caption rendering/compositing, not
// video decoding).
const bgCtx = document.getElementById("bg").getContext("2d");
bgCtx.fillStyle = "#19172D";
bgCtx.fillRect(0, 0, W, H);
const outCtx = document.getElementById("out").getContext("2d");

// Blurs `srcCanvas` (grey-on-black alpha mask, mirrors _render()'s own
// "color=black,ass=...,gblur=sigma=S" step) and returns an ImageData whose
// RGB channel average IS the blurred alpha value per pixel - the same
// value ffmpeg's alphamerge would read as the alpha channel.
function blurredLuma(srcCanvas, blurPx) {
  const tmp = document.createElement("canvas");
  tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext("2d");
  tctx.fillStyle = "black";
  tctx.fillRect(0, 0, W, H);
  tctx.filter = `blur(${blurPx}px)`;
  tctx.drawImage(srcCanvas, 0, 0);
  return tctx.getImageData(0, 0, W, H);
}

// Mirrors _render()'s alphamerge: colorLayer's RGB + blurredMask's luma as
// alpha, composited as one RGBA layer.
function compositeMaskLayer(ctx, alphaCanvas, colorCanvas, blurPx) {
  const blurred = blurredLuma(alphaCanvas, blurPx);
  // alphaCanvas/colorCanvas each had control transferred to JASSUB's
  // worker (for WebGL rendering), so getContext() on them directly throws
  // ("canvas that has transferred its control to offscreen") - but they're
  // still valid as a drawImage() source (that's how the placeholder shows
  // the worker's rendered content on the main thread at all), so copy via
  // drawImage onto a fresh canvas first, then read pixels from THAT.
  const colorCopy = document.createElement("canvas");
  colorCopy.width = W; colorCopy.height = H;
  const colorCopyCtx = colorCopy.getContext("2d");
  colorCopyCtx.drawImage(colorCanvas, 0, 0);
  const colorData = colorCopyCtx.getImageData(0, 0, W, H);
  const out = ctx.createImageData(W, H);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = colorData.data[i];
    out.data[i + 1] = colorData.data[i + 1];
    out.data[i + 2] = colorData.data[i + 2];
    out.data[i + 3] = blurred.data[i]; // luma (R channel of a grey pixel) as alpha
  }
  ctx.putImageData(out, 0, 0);
}

window.renderAt = async function renderAt(mediaTime) {
  const t0 = performance.now();
  const frameMeta = { expectedDisplayTime: performance.now(), width: W, height: H, mediaTime };
  await Promise.all([
    main.manualRender(frameMeta, true),
    glowAlpha.manualRender(frameMeta, true),
    glowColor.manualRender(frameMeta, true),
    shadowAlpha.manualRender(frameMeta, true),
    shadowColor.manualRender(frameMeta, true),
  ]);

  // Z-order mirrors _render() exactly: graded video -> glow layer ->
  // shadow layer -> crisp main text burned on top last. compositeMaskLayer
  // uses putImageData, which REPLACES raw pixels (including alpha) rather
  // than alpha-compositing - drawing straight onto outCtx would erase the
  // video/earlier layers wherever this layer's alpha is 0. Each masked
  // layer is built on its OWN offscreen canvas first, then drawn onto
  // outCtx with normal source-over, which does alpha-blend correctly.
  outCtx.clearRect(0, 0, W, H);
  outCtx.drawImage(document.getElementById("bg"), 0, 0);

  const glowLayer = document.createElement("canvas");
  glowLayer.width = W; glowLayer.height = H;
  compositeMaskLayer(glowLayer.getContext("2d"), document.getElementById("glowAlpha"),
                      document.getElementById("glowColor"), glowBlurPx);
  outCtx.drawImage(glowLayer, 0, 0);

  const shadowLayer = document.createElement("canvas");
  shadowLayer.width = W; shadowLayer.height = H;
  compositeMaskLayer(shadowLayer.getContext("2d"), document.getElementById("shadowAlpha"),
                      document.getElementById("shadowColor"), shadowBlurPx);
  outCtx.drawImage(shadowLayer, 0, 0);

  outCtx.drawImage(document.getElementById("main"), 0, 0);

  const ms = performance.now() - t0;
  window.__lastRenderMs = ms;
  return ms;
};

window.__jassubReady = true;
log("Ready. Call window.renderAt(seconds) to render a frame.");
