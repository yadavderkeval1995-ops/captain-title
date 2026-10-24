import JASSUB from "jassub";

const params = new URLSearchParams(location.search);
const sub = params.get("sub") || "captions.ass";
const canvas = document.getElementById("c");
const fontMap = {
  "Anton": "/ground_truth/fonts/Anton-Regular.ttf",
  "Playfair Display SemiBold": "/ground_truth/fonts/PlayfairDisplay-Italic.ttf",
};
(async () => {
  const t0 = performance.now();
  const instance = new JASSUB({
    canvas, subUrl: "/ground_truth/" + sub,
    availableFonts: fontMap,
    fonts: [fontMap["Anton"], fontMap["Playfair Display SemiBold"]],
    queryFonts: false,
    workerUrl: new URL("./bundle/jassub-worker-bundled.js", window.location.href).href,
    wasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker.wasm", window.location.href).href,
    modernWasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker-modern.wasm", window.location.href).href,
  });
  await instance.ready;
  const t1 = performance.now();
  await instance.manualRender({ expectedDisplayTime: performance.now(), width: 720, height: 1280, mediaTime: 0.52 }, true);
  const t2 = performance.now();
  // 9 more seeks to different timestamps, timing steady-state re-render cost
  // (the part that matters for scrubbing/playback, not one-time init).
  const times = [];
  for (let i = 0; i < 9; i++) {
    const ta = performance.now();
    await instance.manualRender({ expectedDisplayTime: performance.now(), width: 720, height: 1280, mediaTime: 0.2 + i * 0.3 }, true);
    times.push(performance.now() - ta);
  }
  window.__timing = {
    initMs: t1 - t0,
    firstRenderMs: t2 - t1,
    subsequentRendersMs: times,
    subsequentAvgMs: times.reduce((a, b) => a + b, 0) / times.length,
  };
  window.__done = true;
})();
