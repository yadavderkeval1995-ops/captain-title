import JASSUB from "jassub";

const fontMap = {
  "Anton": "/ground_truth/fonts/Anton-Regular.ttf",
  "Playfair Display SemiBold": "/ground_truth/fonts/PlayfairDisplay-Italic.ttf",
};
const GT = "/ground_truth/";

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

window.testWarmup = async function testWarmup(warmupMediaTime, W, H) {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = `width:${W}px;height:${H}px;visibility:hidden;position:absolute;top:0;left:0`;
  document.getElementById("container").appendChild(canvas);
  const inst = new JASSUB({
    canvas, subUrl: GT + "captions.ass",
    availableFonts: fontMap,
    fonts: [fontMap["Anton"], fontMap["Playfair Display SemiBold"]],
    queryFonts: false,
    workerUrl: new URL("./bundle/jassub-worker-bundled.js", window.location.href).href,
    wasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker.wasm", window.location.href).href,
    modernWasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker-modern.wasm", window.location.href).href,
  });
  await inst.ready;
  if (warmupMediaTime !== null) {
    await inst.manualRender({ expectedDisplayTime: performance.now(), width: W, height: H, mediaTime: warmupMediaTime }, true);
  }
  await inst.manualRender({ expectedDisplayTime: performance.now(), width: W, height: H, mediaTime: 0.52 }, true);
  const result = drawnPixelCount(canvas, W, H);
  await inst.destroy();
  document.getElementById("container").innerHTML = "";
  return { warmupMediaTime, result };
};

window.testOrder = async function testOrder(layerOrder, W, H) {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = `width:${W}px;height:${H}px;visibility:hidden;position:absolute;top:0;left:0`;
  document.getElementById("container").appendChild(canvas);
  const inst = new JASSUB({
    canvas, subUrl: GT + layerOrder[0], // construct with the FIRST layer in this test's order
    availableFonts: fontMap,
    fonts: [fontMap["Anton"], fontMap["Playfair Display SemiBold"]],
    queryFonts: false,
    workerUrl: new URL("./bundle/jassub-worker-bundled.js", window.location.href).href,
    wasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker.wasm", window.location.href).href,
    modernWasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker-modern.wasm", window.location.href).href,
  });
  await inst.ready;
  const results = {};
  for (const layer of layerOrder) {
    await inst.renderer.setTrackByUrl(GT + layer);
    await inst.manualRender({ expectedDisplayTime: performance.now(), width: W, height: H, mediaTime: 0.52 }, true);
    results[layer] = drawnPixelCount(canvas, W, H);
  }
  await inst.destroy();
  document.getElementById("container").innerHTML = "";
  return results;
};
