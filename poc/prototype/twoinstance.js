import JASSUB from "jassub";
const fontMap = {
  "Anton": "/ground_truth/fonts/Anton-Regular.ttf",
  "Playfair Display SemiBold": "/ground_truth/fonts/PlayfairDisplay-Italic.ttf",
};
function opts(canvas, sub) {
  return {
    canvas, subUrl: "/ground_truth/" + sub,
    availableFonts: fontMap,
    fonts: [fontMap["Anton"], fontMap["Playfair Display SemiBold"]],
    queryFonts: false,
    workerUrl: new URL("./bundle/jassub-worker-bundled.js", window.location.href).href,
    wasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker.wasm", window.location.href).href,
    modernWasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker-modern.wasm", window.location.href).href,
  };
}
(async () => {
  const a = new JASSUB(opts(document.getElementById("a"), "captions.ass"));
  const b = new JASSUB(opts(document.getElementById("b"), "glow_color.ass"));
  await Promise.all([a.ready, b.ready]);
  const meta = { expectedDisplayTime: performance.now(), width: 720, height: 1280, mediaTime: 0.52 };
  await Promise.all([a.manualRender(meta, true), b.manualRender(meta, true)]);
  window.__done = true;
})();
