import JASSUB from "jassub";

const fontMap = {
  "Anton": "/ground_truth/fonts/Anton-Regular.ttf",
  "Playfair Display SemiBold": "/ground_truth/fonts/PlayfairDisplay-Italic.ttf",
};

function opts(canvas) {
  return {
    canvas, subUrl: "/ground_truth/captions.ass",
    availableFonts: fontMap,
    fonts: [fontMap["Anton"], fontMap["Playfair Display SemiBold"]],
    queryFonts: false,
    workerUrl: new URL("./bundle/jassub-worker-bundled.js", window.location.href).href,
    wasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker.wasm", window.location.href).href,
    modernWasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker-modern.wasm", window.location.href).href,
  };
}

function nonBlackCount(canvas, W, H) {
  const tmp = document.createElement("canvas");
  tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(canvas, 0, 0);
  const data = tctx.getImageData(0, 0, W, H).data;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] || data[i + 1] || data[i + 2]) n++;
  return n;
}

window.runConcurrencyTest = async function runConcurrencyTest(count, W, H, mode) {
  const container = document.getElementById("container");
  container.innerHTML = "";
  const canvases = [];
  const glErrors = [];
  const origError = console.error;
  console.error = (...args) => { glErrors.push(args.map(String).join(" ")); origError(...args); };

  for (let i = 0; i < count; i++) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    c.style.cssText = `width:${W}px;height:${H}px;visibility:hidden;position:absolute;top:0;left:0`;
    container.appendChild(c);
    canvases.push(c);
  }

  const t0 = performance.now();
  const instances = [];
  if (mode === "parallel") {
    const made = await Promise.all(canvases.map((c) => {
      const inst = new JASSUB(opts(c));
      return inst.ready.then(() => inst);
    }));
    instances.push(...made);
  } else {
    for (const c of canvases) {
      const inst = new JASSUB(opts(c));
      await inst.ready;
      instances.push(inst);
    }
  }
  const initMs = performance.now() - t0;

  const meta = { expectedDisplayTime: performance.now(), width: W, height: H, mediaTime: 0.52 };
  const t1 = performance.now();
  if (mode === "parallel") {
    await Promise.all(instances.map((inst) => inst.manualRender(meta, true)));
  } else {
    for (const inst of instances) await inst.manualRender(meta, true);
  }
  const renderMs = performance.now() - t1;
  const firstPassResults = canvases.map((c) => nonBlackCount(c, W, H));

  // Render a SECOND time at the same mediaTime - the first call for any
  // freshly-constructed instance always takes the resize() branch (videoWidth
  // starts at 0), which resizes then recursively re-demands a draw; this
  // checks whether that recursive re-demand is actually completing before
  // manualRender's own promise resolves, or whether something about this
  // harness's instantiation pattern leaves it incomplete.
  const t2 = performance.now();
  if (mode === "parallel") {
    await Promise.all(instances.map((inst) => inst.manualRender({ ...meta, expectedDisplayTime: performance.now() }, true)));
  } else {
    for (const inst of instances) await inst.manualRender({ ...meta, expectedDisplayTime: performance.now() }, true);
  }
  const secondRenderMs = performance.now() - t2;
  const results = canvases.map((c, i) => nonBlackCount(c, W, H));
  window.__firstPassResults = firstPassResults;
  window.__secondRenderMs = secondRenderMs;
  for (const inst of instances) await inst.destroy();
  console.error = origError;

  return { count, mode, initMs, renderMs, perCanvasNonBlackPixels: results,
           succeeded: results.filter((n) => n > 100).length,
           glErrors: glErrors.slice(0, 10) };
};
