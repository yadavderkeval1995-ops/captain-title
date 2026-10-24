import JASSUB from "jassub";

const canvas = document.getElementById("c");
canvas.width = 1080; canvas.height = 1920;
canvas.style.width = "1080px"; canvas.style.height = "1920px";

(async () => {
  const instance = new JASSUB({
    canvas, subUrl: "/ground_truth/clip_test.ass",
    availableFonts: { "Anton": "/ground_truth/fonts/Anton-Regular.ttf" },
    fonts: ["/ground_truth/fonts/Anton-Regular.ttf"],
    queryFonts: false,
    workerUrl: new URL("./bundle/jassub-worker-bundled.js", window.location.href).href,
    wasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker.wasm", window.location.href).href,
    modernWasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker-modern.wasm", window.location.href).href,
  });
  await instance.ready;

  window.renderClipTestAt = async function (mediaTime) {
    let attempts = 0;
    for (; attempts < 8; attempts++) {
      await instance.manualRender({ expectedDisplayTime: performance.now(), width: 1080, height: 1920, mediaTime }, true);
      await new Promise(requestAnimationFrame);
      await new Promise((r) => setTimeout(r, 30));
      const tmp = document.createElement("canvas");
      tmp.width = 1080; tmp.height = 1920;
      tmp.getContext("2d").drawImage(canvas, 0, 0);
      const data = tmp.getContext("2d").getImageData(0, 0, 1080, 1920).data;
      let any = false;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) { any = true; break; }
      if (any) return tmp.toDataURL("image/png");
    }
    const tmp = document.createElement("canvas");
    tmp.width = 1080; tmp.height = 1920;
    tmp.getContext("2d").drawImage(canvas, 0, 0);
    return tmp.toDataURL("image/png");
  };
  window.__clipTestReady = true;
})();
