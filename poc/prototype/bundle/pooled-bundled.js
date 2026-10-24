var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/throughput/index.js
var require_throughput = __commonJS({
  "node_modules/throughput/index.js"(exports, module) {
    var hrtime = typeof process !== "undefined" && !!process.hrtime;
    var maxTick = 65535;
    var resolution = 10;
    var timeDiff = hrtime ? 1e9 / resolution : 1e3 / resolution;
    var now = hrtime ? () => {
      const [seconds, nanoseconds] = process.hrtime();
      return seconds * 1e9 + nanoseconds;
    } : () => performance.now();
    function getTick(start) {
      return (now() - start) / timeDiff & maxTick;
    }
    module.exports = function(seconds) {
      const start = now();
      const size = resolution * (seconds || 5);
      const buffer2 = [0];
      let pointer = 1;
      let last = getTick(start) - 1 & maxTick;
      return function(delta) {
        const tick = getTick(start);
        let dist = tick - last & maxTick;
        if (dist > size) dist = size;
        last = tick;
        while (dist--) {
          if (pointer === size) pointer = 0;
          buffer2[pointer] = buffer2[pointer === 0 ? size - 1 : pointer - 1];
          pointer++;
        }
        if (delta) buffer2[pointer - 1] += delta;
        const top = buffer2[pointer - 1];
        const btm = buffer2.length < size ? 0 : buffer2[pointer === size ? 0 : pointer];
        return buffer2.length < resolution ? top : (top - btm) * resolution / buffer2.length;
      };
    };
  }
});

// node_modules/rvfc-polyfill/index.js
var VidProto = typeof HTMLVideoElement !== "undefined" ? HTMLVideoElement.prototype : {};
var hasQuality = "getVideoPlaybackQuality" in VidProto || "webkitDecodedFrameCount" in VidProto || "mozPresentedFrames" in VidProto || "mozPaintedFrames" in VidProto;
if (!("requestVideoFrameCallback" in VidProto) && hasQuality && typeof requestAnimationFrame === "function") {
  VidProto._rvfcpolyfillmap = {};
  const getPlaybackQuality = "getVideoPlaybackQuality" in VidProto ? (video) => {
    const { totalFrameDelay, totalVideoFrames, droppedVideoFrames } = video.getVideoPlaybackQuality();
    return {
      presentedFrames: totalVideoFrames - droppedVideoFrames,
      totalFrameDelay
    };
  } : (video) => {
    return {
      presentedFrames: video.mozPresentedFrames || video.mozPaintedFrames || video.webkitDecodedFrameCount - (video.webkitDroppedFrameCount || 0),
      totalFrameDelay: video.mozFrameDelay || 0
    };
  };
  VidProto.requestVideoFrameCallback = function(callback) {
    const handle = performance.now();
    const quality = getPlaybackQuality(this);
    const baseline = quality.presentedFrames;
    const check = (old, now) => {
      const newquality = getPlaybackQuality(this);
      const presentedFrames = newquality.presentedFrames;
      if (presentedFrames > baseline) {
        const processingDuration = newquality.totalFrameDelay - quality.totalFrameDelay || 0;
        const timediff = now - old;
        callback(now, {
          presentationTime: now + processingDuration * 1e3,
          expectedDisplayTime: now + timediff,
          width: this.videoWidth,
          height: this.videoHeight,
          mediaTime: Math.max(0, this.currentTime || 0) + timediff / 1e3,
          presentedFrames,
          processingDuration
        });
        delete this._rvfcpolyfillmap[handle];
      } else {
        this._rvfcpolyfillmap[handle] = requestAnimationFrame((newer) => check(now, newer));
      }
    };
    this._rvfcpolyfillmap[handle] = requestAnimationFrame((newer) => check(handle, newer));
    return handle;
  };
  VidProto.cancelVideoFrameCallback = function(handle) {
    cancelAnimationFrame(this._rvfcpolyfillmap[handle]);
    delete this._rvfcpolyfillmap[handle];
  };
}

// node_modules/abslink/src/types.js
var WireValueType = {
  RAW: "RAW",
  PROXY: "PROXY",
  THROW: "THROW",
  HANDLER: "HANDLER"
};
var MessageType = {
  GET: "GET",
  SET: "SET",
  APPLY: "APPLY",
  CONSTRUCT: "CONSTRUCT",
  RELEASE: "RELEASE"
};

// node_modules/abslink/src/abslink.js
var proxyMarker = /* @__PURE__ */ Symbol("Abslink.proxy");
var releaseProxy = /* @__PURE__ */ Symbol("Abslink.releaseProxy");
var finalizer = /* @__PURE__ */ Symbol("Abslink.finalizer");
var throwMarker = /* @__PURE__ */ Symbol("Abslink.thrown");
var isObject = (val) => typeof val === "object" && val !== null || typeof val === "function";
var proxyTransferHandler = {
  canHandle: (val) => isObject(val) && proxyMarker in val,
  serialize(obj, ep) {
    const markerID = obj[proxyMarker];
    expose(obj, ep, markerID);
    return [markerID, []];
  },
  deserialize(markerID, ep) {
    return wrap(ep, markerID);
  }
};
var throwTransferHandler = {
  canHandle: (value) => isObject(value) && throwMarker in value,
  serialize({ value }) {
    let serialized;
    if (value instanceof Error) {
      serialized = {
        isError: true,
        value: {
          message: value.message,
          name: value.name,
          stack: value.stack
        }
      };
    } else {
      serialized = { isError: false, value };
    }
    return [serialized, []];
  },
  deserialize(serialized) {
    if (serialized.isError) {
      throw Object.assign(new Error(serialized.value.message), serialized.value);
    }
    throw serialized.value;
  }
};
var transferHandlers = /* @__PURE__ */ new Map([
  ["proxy", proxyTransferHandler],
  ["throw", throwTransferHandler]
]);
function filterPath(path, obj) {
  let parent = obj;
  const parentPath = path.slice(0, -1);
  for (const segment of parentPath) {
    if (Object.prototype.hasOwnProperty.call(parent, segment)) {
      parent = parent[segment];
    }
  }
  const lastSegment = path[path.length - 1];
  const RawValue = lastSegment ? parent[lastSegment] : parent;
  return { parent, RawValue, lastSegment };
}
function expose(obj, ep, rootMarkerID) {
  ep.on("message", function callback(data) {
    if (!data)
      return;
    const { id, type, path, markerID } = {
      path: [],
      ...data
    };
    if (markerID !== rootMarkerID)
      return;
    const argumentList = (data.argumentList ?? []).map((v) => fromWireValue(v, ep));
    let returnValue;
    try {
      const { parent, RawValue, lastSegment } = filterPath(path, obj);
      switch (type) {
        case MessageType.GET:
          returnValue = RawValue;
          break;
        case MessageType.SET:
          parent[lastSegment] = fromWireValue(data.value, ep);
          returnValue = true;
          break;
        case MessageType.APPLY:
          returnValue = RawValue.apply(parent, argumentList);
          break;
        case MessageType.CONSTRUCT:
          returnValue = new RawValue(...argumentList);
          break;
        case MessageType.RELEASE:
          returnValue = void 0;
          break;
        default:
          return;
      }
    } catch (value) {
      returnValue = { value, [throwMarker]: 0 };
    }
    Promise.resolve(returnValue).catch((value) => {
      return { value, [throwMarker]: 0 };
    }).then((returnValue2) => {
      if (type === MessageType.CONSTRUCT && !(isObject(returnValue2) && throwMarker in returnValue2)) {
        returnValue2 = proxy(returnValue2);
      }
      const [wireValue, transfer2] = toWireValue(returnValue2, ep);
      ep.postMessage({ ...wireValue, id, markerID: rootMarkerID }, transfer2);
      if (type === MessageType.RELEASE) {
        ep.off("message", callback);
        obj[finalizer]?.();
      }
    }).catch((_) => {
      const [wireValue, transfer2] = toWireValue({
        value: new TypeError("Unserializable return value"),
        [throwMarker]: 0
      }, ep);
      ep.postMessage({ ...wireValue, id, markerID: rootMarkerID }, transfer2);
    });
  });
  return obj;
}
function wrap(endpoint, rootMarkerID) {
  const pendingListeners = /* @__PURE__ */ new Map();
  endpoint.on("message", (data) => {
    if (!data?.id) {
      return;
    }
    const resolver = pendingListeners.get(data.id);
    if (!resolver) {
      return;
    }
    try {
      resolver(data);
    } finally {
      pendingListeners.delete(data.id);
    }
  });
  return createProxy({ endpoint, pendingListeners, rootMarkerID });
}
function throwIfProxyReleased(isReleased) {
  if (isReleased) {
    throw new Error("Proxy has been released and is not useable");
  }
}
async function releaseEndpoint(epWithPendingListeners) {
  await requestResponseMessage(epWithPendingListeners, { type: MessageType.RELEASE });
}
var proxyCounter = /* @__PURE__ */ new WeakMap();
var proxyFinalizers = "FinalizationRegistry" in globalThis && new FinalizationRegistry((epWithPendingListeners) => {
  const newCount = (proxyCounter.get(epWithPendingListeners) ?? 0) - 1;
  proxyCounter.set(epWithPendingListeners, newCount);
  if (newCount === 0) {
    releaseEndpoint(epWithPendingListeners).finally(() => {
      epWithPendingListeners.pendingListeners.clear();
    });
  }
});
function registerProxy(proxy2, epWithPendingListeners) {
  const newCount = (proxyCounter.get(epWithPendingListeners) ?? 0) + 1;
  proxyCounter.set(epWithPendingListeners, newCount);
  if (proxyFinalizers) {
    proxyFinalizers.register(proxy2, epWithPendingListeners, proxy2);
  }
}
function unregisterProxy(proxy2) {
  if (proxyFinalizers) {
    proxyFinalizers.unregister(proxy2);
  }
}
function createProxy(epWithPendingListeners, path = []) {
  let isProxyReleased = false;
  const propProxyCache = /* @__PURE__ */ new Map();
  const proxy2 = new Proxy(function() {
  }, {
    get(_target, prop) {
      throwIfProxyReleased(isProxyReleased);
      if (prop === releaseProxy) {
        return async () => {
          for (const subProxy of propProxyCache.values()) {
            subProxy[releaseProxy]();
          }
          propProxyCache.clear();
          unregisterProxy(proxy2);
          releaseEndpoint(epWithPendingListeners).finally(() => {
            epWithPendingListeners.pendingListeners.clear();
          });
          isProxyReleased = true;
        };
      }
      if (prop === "then") {
        if (path.length === 0) {
          return { then: () => proxy2 };
        }
        const r = requestResponseMessage(epWithPendingListeners, {
          type: MessageType.GET,
          path: path.map((p) => p.toString())
        }).then((v) => fromWireValue(v, epWithPendingListeners.endpoint));
        return r.then.bind(r);
      }
      const cachedProxy = propProxyCache.get(prop);
      if (cachedProxy) {
        return cachedProxy;
      }
      const propProxy = createProxy(epWithPendingListeners, [...path, prop]);
      propProxyCache.set(prop, propProxy);
      return propProxy;
    },
    set(_target, prop, rawValue) {
      throwIfProxyReleased(isProxyReleased);
      const [value, transfer2] = toWireValue(rawValue, epWithPendingListeners.endpoint);
      return requestResponseMessage(epWithPendingListeners, {
        type: MessageType.SET,
        path: [...path, prop].map((p) => p.toString()),
        value
      }, transfer2).then((v) => fromWireValue(v, epWithPendingListeners.endpoint));
    },
    apply(_target, _thisArg, rawArgumentList) {
      throwIfProxyReleased(isProxyReleased);
      const last = path[path.length - 1];
      if (last === "bind") {
        return createProxy(epWithPendingListeners, path.slice(0, -1));
      }
      const [argumentList, transfer2] = processArguments(rawArgumentList, epWithPendingListeners);
      return requestResponseMessage(epWithPendingListeners, {
        type: MessageType.APPLY,
        path: path.map((p) => p.toString()),
        argumentList
      }, transfer2).then((v) => fromWireValue(v, epWithPendingListeners.endpoint));
    },
    construct(_target, rawArgumentList) {
      throwIfProxyReleased(isProxyReleased);
      const [argumentList, transfer2] = processArguments(rawArgumentList, epWithPendingListeners);
      return requestResponseMessage(epWithPendingListeners, {
        type: MessageType.CONSTRUCT,
        path: path.map((p) => p.toString()),
        argumentList
      }, transfer2).then((v) => fromWireValue(v, epWithPendingListeners.endpoint));
    }
  });
  registerProxy(proxy2, epWithPendingListeners);
  return proxy2;
}
var transferCache = /* @__PURE__ */ new WeakMap();
function transfer(obj, transfers) {
  transferCache.set(obj, transfers);
  return obj;
}
function processArguments(argumentList, epWithPendingListeners) {
  const wireValues = [];
  const transferables = [];
  for (const argument of argumentList) {
    const [wireValue, transfer2] = toWireValue(argument, epWithPendingListeners.endpoint);
    wireValues.push(wireValue);
    transferables.push(...transfer2);
  }
  return [wireValues, transferables];
}
function proxy(obj) {
  return Object.assign(obj, { [proxyMarker]: randomId() });
}
function toWireValue(value, ep) {
  for (const [name, handler] of transferHandlers) {
    if (handler.canHandle(value)) {
      const [serializedValue, transfer2] = handler.serialize(value, ep);
      return [{
        type: WireValueType.HANDLER,
        name,
        value: serializedValue
      }, transfer2];
    }
  }
  return [{
    type: WireValueType.RAW,
    value
  }, transferCache.get(value) ?? []];
}
function fromWireValue(value, ep) {
  switch (value.type) {
    case WireValueType.HANDLER:
      return transferHandlers.get(value.name).deserialize(value.value, ep);
    case WireValueType.RAW:
      return value.value;
  }
}
function requestResponseMessage(ep, msg, transfer2 = []) {
  return new Promise((resolve) => {
    const id = randomId();
    ep.pendingListeners.set(id, resolve);
    ep.endpoint.postMessage({ id, ...msg, markerID: ep.rootMarkerID }, transfer2);
  });
}
var hex = [];
var alphabet = "0123456789abcdef";
for (let i = 0; i < 256; i++) {
  hex[i] = alphabet[i >> 4 & 15] + alphabet[i & 15];
}
var step = 0;
var buffer = "";
function randomId() {
  let i = 0;
  if (!buffer || step + 16 > 256 * 2) {
    for (buffer = "", step = 0; i < 256; ++i) {
      buffer += hex[Math.random() * 256 | 0];
    }
  }
  return buffer.substring(step, ++step + 16);
}

// node_modules/abslink/adapters/w3c.js
function createWrapper(channel, messageable) {
  const listeners = /* @__PURE__ */ new WeakMap();
  channel.start?.();
  messageable.start?.();
  return {
    on(event, listener) {
      const unwrapped = (event2) => listener(event2.data);
      if ("addEventListener" in channel) {
        channel.addEventListener(event, unwrapped);
      } else if ("addListener" in channel) {
        channel.addListener(event, unwrapped);
      } else {
        channel.on(event, unwrapped);
      }
      listeners.set(listener, unwrapped);
    },
    off(event, listener) {
      const unwrapped = listeners.get(listener);
      if ("removeEventListener" in channel) {
        channel.removeEventListener(event, unwrapped);
      } else if ("removeListener" in channel) {
        channel.removeListener(event, unwrapped);
      } else {
        channel.off(event, unwrapped);
      }
      listeners.delete(listener);
    },
    postMessage(message, transfer2 = []) {
      messageable.postMessage(message, transfer2);
    }
  };
}
function wrap2(channel, messageable = channel) {
  return wrap(createWrapper(channel, messageable));
}

// node_modules/jassub/dist/debug.js
var import_throughput = __toESM(require_throughput(), 1);
var Debug = class {
  // 5 second average
  fps = (0, import_throughput.default)(5);
  processingDuration = (0, import_throughput.default)(5);
  droppedFrames = 0;
  presentedFrames = 0;
  mistimedFrames = 0;
  _drop() {
    ++this.droppedFrames;
  }
  _startTime = 0;
  _startFrame() {
    this._startTime = performance.now();
  }
  onsubtitleFrameCallback = (_, { fps, processingDuration, droppedFrames }) => console.info("%cFPS: %c%f %c| Frame Time: %c%d ms %c| Dropped Frames: %c%d %c| 5s Avg", "color: #888", "color: #0f0; font-weight: bold", fps.toFixed(1), "color: #888", "color: #0ff; font-weight: bold", processingDuration, "color: #888", "color: #f00; font-weight: bold", droppedFrames, "color: #888");
  _endFrame(meta) {
    ++this.presentedFrames;
    const fps = this.fps(1);
    const now = performance.now();
    const processingDuration = this.processingDuration((now - this._startTime) / fps);
    const frameDelay = Math.max(0, now - meta.expectedDisplayTime);
    if (frameDelay)
      ++this.mistimedFrames;
    this.onsubtitleFrameCallback?.(now, {
      fps,
      processingDuration,
      droppedFrames: this.droppedFrames,
      presentedFrames: this.presentedFrames,
      mistimedFrames: this.mistimedFrames,
      presentationTime: now,
      expectedDisplayTime: meta.expectedDisplayTime + (frameDelay > 0 ? fps / 1e3 : 0),
      frameDelay,
      width: meta.width,
      height: meta.height,
      mediaTime: meta.mediaTime
    });
  }
};

// node_modules/jassub/dist/jassub.js
var webYCbCrMap = {
  rgb: "RGB",
  bt709: "BT709",
  // these might not be exactly correct? oops?
  bt470bg: "BT601",
  // alias BT.601 PAL... whats the difference?
  smpte170m: "BT601"
  // alias BT.601 NTSC... whats the difference?
};
var JASSUB = class _JASSUB {
  timeOffset;
  prescaleFactor;
  prescaleHeightLimit;
  maxRenderHeight;
  debug;
  renderer;
  ready;
  busy = false;
  _video;
  _videoWidth = 0;
  _videoHeight = 0;
  _videoColorSpace = null;
  _canvas;
  _ro = new ResizeObserver(async () => {
    await this.ready;
    this.resize();
  });
  _destroyed = false;
  _lastDemandTime;
  _skipped = false;
  _worker;
  constructor(opts) {
    if (!globalThis.Worker)
      throw new Error("Worker not supported");
    if (!opts)
      throw new Error("No options provided");
    if (!opts.video && !opts.canvas)
      throw new Error("You should give video or canvas in options.");
    _JASSUB._test();
    this.timeOffset = opts.timeOffset ?? 0;
    this._video = opts.video;
    this._canvas = opts.canvas ?? document.createElement("canvas");
    if (this._video && !opts.canvas) {
      this._canvas.className = "JASSUB";
      this._canvas.style.position = "absolute";
      this._canvas.style.pointerEvents = "none";
      this._video.insertAdjacentElement("afterend", this._canvas);
    }
    const ctrl = this._canvas.transferControlToOffscreen();
    this.debug = opts.debug ? new Debug() : null;
    this.prescaleFactor = opts.prescaleFactor ?? 1;
    this.prescaleHeightLimit = opts.prescaleHeightLimit ?? 1080;
    this.maxRenderHeight = opts.maxRenderHeight ?? 0;
    this._worker = opts.workerUrl ? new Worker(opts.workerUrl, { name: "jassub-worker", type: "module" }) : new Worker(new URL("./worker/worker.js", import.meta.url), { name: "jassub-worker", type: "module" });
    const Renderer = wrap2(this._worker);
    const modern = opts.modernWasmUrl ?? new URL("./wasm/jassub-worker-modern.wasm", import.meta.url).href;
    const normal = opts.wasmUrl ?? new URL("./wasm/jassub-worker.wasm", import.meta.url).href;
    const availableFonts = opts.availableFonts ?? {};
    if (!availableFonts["liberation sans"] && !opts.defaultFont) {
      availableFonts["liberation sans"] = new URL("./default.woff2", import.meta.url).href;
    }
    this.ready = new Renderer({
      wasmUrl: _JASSUB._supportsSIMD ? modern : normal,
      width: ctrl.width,
      height: ctrl.height,
      subUrl: opts.subUrl,
      subContent: opts.subContent ?? null,
      fonts: opts.fonts ?? [],
      availableFonts,
      defaultFont: opts.defaultFont ?? "liberation sans",
      debug: !!opts.debug,
      libassMemoryLimit: opts.libassMemoryLimit ?? 0,
      libassGlyphLimit: opts.libassGlyphLimit ?? 0,
      queryFonts: opts.queryFonts ?? "local"
    }, proxy((font) => this._getLocalFont(font)), transfer(ctrl, [ctrl])).then((renderer) => {
      this.renderer = renderer;
    });
    if (this._video) {
      this.setVideo(this._video);
    } else {
      this._ro.observe(this._canvas);
    }
  }
  static _supportsSIMD;
  static _test() {
    if (_JASSUB._supportsSIMD != null)
      return;
    try {
      _JASSUB._supportsSIMD = WebAssembly.validate(Uint8Array.of(
        // WASM magic number + version 1
        0,
        97,
        115,
        109,
        1,
        0,
        0,
        0,
        // Type section: 1 type, func () -> v128
        1,
        5,
        1,
        96,
        0,
        1,
        123,
        // function section 1 function, type index 0
        3,
        2,
        1,
        0,
        // code section 1 body, 0 locals
        10,
        43,
        1,
        41,
        0,
        // v128.const i32x4 0 0 0 0
        253,
        12,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        // v128.const i32x4 0 0 0 0
        253,
        12,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        // i8x16.relaxed_swizzle relaxed SIMD
        253,
        128,
        2,
        // end
        11
      ));
    } catch (e) {
      _JASSUB._supportsSIMD = false;
    }
    const module = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
    if (!(module instanceof WebAssembly.Module) || !(new WebAssembly.Instance(module) instanceof WebAssembly.Instance))
      throw new Error("WASM not supported");
  }
  async resize(forceRepaint = !!this._video?.paused, renderWidth = 0, renderHeight = 0) {
    const videoWidth = this._video?.videoWidth ?? this._videoWidth;
    const videoHeight = this._video?.videoHeight ?? this._videoHeight;
    const videoSize = this._getElementBoundingBox(this._video ?? this._canvas, videoWidth, videoHeight);
    if (!renderWidth || !renderHeight) {
      const widthScale = this._videoWidth / videoWidth || 1;
      const heightScale = this._videoHeight / videoHeight || 1;
      const { width, height } = this._computeRenderSize(videoSize.width * widthScale, videoSize.height * heightScale);
      renderWidth = Math.round(width);
      renderHeight = Math.round(height);
    }
    if (this._video) {
      this._canvas.style.width = Math.round(videoSize.width) + "px";
      this._canvas.style.height = Math.round(videoSize.height) + "px";
      this._canvas.style.top = videoSize.y + "px";
      this._canvas.style.left = videoSize.x + "px";
    }
    await this.renderer._resizeCanvas(renderWidth, renderHeight, this._video ? this._videoWidth || renderWidth : 0, this._video ? this._videoHeight || renderHeight : 0);
    if (this._lastDemandTime)
      await this._demandRender(forceRepaint);
  }
  _getElementBoundingBox(el, videoWidth, videoHeight) {
    const { clientWidth, clientHeight, offsetLeft, offsetTop } = el;
    const videoRatio = videoWidth / videoHeight;
    const elementRatio = clientWidth / clientHeight;
    if (elementRatio > videoRatio) {
      videoHeight = clientHeight;
      videoWidth = clientHeight * videoRatio;
    } else {
      videoHeight = clientWidth / videoRatio;
      videoWidth = clientWidth;
    }
    return { x: offsetLeft + (clientWidth - videoWidth) / 2, y: offsetTop + (clientHeight - videoHeight) / 2, width: videoWidth, height: videoHeight };
  }
  _computeRenderSize(width = 0, height = 0) {
    if (height <= 0 || width <= 0)
      return { width: 0, height: 0 };
    const scalefactor = this.prescaleFactor <= 0 ? 1 : this.prescaleFactor;
    const ratio = self.devicePixelRatio || 1;
    const sgn = scalefactor < 1 ? -1 : 1;
    let newH = height * ratio;
    if (sgn * newH * scalefactor <= sgn * this.prescaleHeightLimit) {
      newH *= scalefactor;
    } else if (sgn * newH < sgn * this.prescaleHeightLimit) {
      newH = this.prescaleHeightLimit;
    }
    if (this.maxRenderHeight > 0 && newH > this.maxRenderHeight)
      newH = this.maxRenderHeight;
    width *= newH / height;
    height = newH;
    return { width, height };
  }
  async setVideo(target) {
    this._removeListeners();
    this._video = target;
    this._ro.observe(target);
    if (typeof VideoFrame !== "undefined") {
      target.addEventListener("loadedmetadata", this._boundUpdateColorSpace);
      this._updateColorSpace({ target });
    }
    await this.ready;
    this._video.requestVideoFrameCallback((now, data) => this._handleRVFC(data));
  }
  async _getLocalFont(font, weight = "regular") {
    if (navigator.permissions?.query) {
      const { state } = await navigator.permissions.query({ name: "local-fonts" });
      if (state !== "granted")
        return;
    }
    for (const data of await self.queryLocalFonts()) {
      const family = data.family.toLowerCase();
      const style = data.style.toLowerCase();
      if (family === font && style === weight) {
        const blob = await data.blob();
        return new Uint8Array(await blob.arrayBuffer());
      }
    }
  }
  _handleRVFC(data) {
    if (this._destroyed)
      return;
    this.manualRender(data);
    this._video.requestVideoFrameCallback((now, data2) => this._handleRVFC(data2));
  }
  manualRender(data, repaint = false) {
    this._lastDemandTime = data;
    return this._demandRender(repaint);
  }
  async _demandRender(repaint = false) {
    const { mediaTime, width, height } = this._lastDemandTime;
    if (width !== this._videoWidth || height !== this._videoHeight) {
      this._videoWidth = width;
      this._videoHeight = height;
      return await this.resize(repaint);
    }
    if (this.busy) {
      this._skipped = true;
      this.debug?._drop();
      return;
    }
    this.busy = true;
    this._skipped = false;
    this.debug?._startFrame();
    await this.renderer._draw(mediaTime + this.timeOffset, repaint);
    this.debug?._endFrame(this._lastDemandTime);
    this.busy = false;
    if (this._skipped)
      await this._demandRender();
  }
  _boundUpdateColorSpace = this._updateColorSpace.bind(this);
  _updateColorSpace({ target }) {
    this._video.requestVideoFrameCallback(async () => {
      if (this._destroyed || this._video !== target)
        return;
      try {
        const frame = new VideoFrame(this._video);
        const colorSpace = webYCbCrMap[frame.colorSpace.matrix];
        frame.close();
        await this.ready;
        await this.renderer._setColorSpace(colorSpace);
      } catch (e) {
        console.warn(e);
      }
    });
  }
  _removeListeners() {
    this._ro.disconnect();
    this._video?.removeEventListener("loadedmetadata", this._boundUpdateColorSpace);
  }
  async destroy() {
    if (this._destroyed)
      return;
    this._destroyed = true;
    this._canvas.remove();
    this._removeListeners();
    try {
      await this.ready;
      await this.renderer?.[releaseProxy]();
    } finally {
      this._worker.terminate();
    }
  }
};

// pooled.js
var fontMap = {
  "Anton": "/ground_truth/fonts/Anton-Regular.ttf",
  "Playfair Display SemiBold": "/ground_truth/fonts/PlayfairDisplay-Italic.ttf"
};
var GT = "/ground_truth/";
var LAYERS = ["captions.ass", "glow_alpha.ass", "glow_color.ass", "shadow_alpha.ass", "shadow_color.ass"];
function drawnPixelCount(canvas, W, H) {
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(canvas, 0, 0);
  const data = tctx.getImageData(0, 0, W, H).data;
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
  return n;
}
var RendererPool = class {
  constructor(size, W, H) {
    this.size = size;
    this.W = W;
    this.H = H;
    this.slots = [];
  }
  async init() {
    for (let i = 0; i < this.size; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = this.W;
      canvas.height = this.H;
      canvas.style.cssText = `width:${this.W}px;height:${this.H}px;visibility:hidden;position:absolute;top:0;left:0`;
      document.getElementById("container").appendChild(canvas);
      const inst = new JASSUB({
        canvas,
        subUrl: GT + "captions.ass",
        // placeholder track, immediately swapped per render
        availableFonts: fontMap,
        fonts: [fontMap["Anton"], fontMap["Playfair Display SemiBold"]],
        queryFonts: false,
        workerUrl: new URL("./bundle/jassub-worker-bundled.js", window.location.href).href,
        wasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker.wasm", window.location.href).href,
        modernWasmUrl: new URL("./node_modules/jassub/dist/wasm/jassub-worker-modern.wasm", window.location.href).href
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
    out.width = this.W;
    out.height = this.H;
    out.getContext("2d").drawImage(slot.canvas, 0, 0);
    return out;
  }
  async destroy() {
    for (const { inst } of this.slots) await inst.destroy();
  }
};
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
var SIGMA_TO_CSS_BLUR_RADIUS = 1.1;
var STREET_GLOW_GLOW_BLUR = 10;
var STREET_GLOW_SHADOW_BLUR = 3;
function drawnAlphaCanvas(canvas, W, H) {
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  tmp.getContext("2d").drawImage(canvas, 0, 0);
  return tmp;
}
function blurredLuma(srcCanvas, W, H, blurPx) {
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext("2d");
  tctx.fillStyle = "black";
  tctx.fillRect(0, 0, W, H);
  tctx.filter = `blur(${blurPx}px)`;
  tctx.drawImage(srcCanvas, 0, 0);
  return tctx.getImageData(0, 0, W, H);
}
function compositeMaskLayer(alphaCanvas, colorCanvas, W, H, blurPx) {
  const blurred = blurredLuma(alphaCanvas, W, H, blurPx);
  const colorCopy = drawnAlphaCanvas(colorCanvas, W, H);
  const colorData = colorCopy.getContext("2d").getImageData(0, 0, W, H);
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
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
window.renderComposite = async function renderComposite(W, H, mediaTime) {
  const canvasScale = W / 1080 * SIGMA_TO_CSS_BLUR_RADIUS;
  const glowBlurPx = STREET_GLOW_GLOW_BLUR * canvasScale / SIGMA_TO_CSS_BLUR_RADIUS;
  const shadowBlurPx = STREET_GLOW_SHADOW_BLUR * canvasScale / SIGMA_TO_CSS_BLUR_RADIUS;
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
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d");
  const glowLayer = compositeMaskLayer(canvases["glow_alpha.ass"], canvases["glow_color.ass"], W, H, glowBlurPx);
  octx.drawImage(glowLayer, 0, 0);
  const shadowLayer = compositeMaskLayer(canvases["shadow_alpha.ass"], canvases["shadow_color.ass"], W, H, shadowBlurPx);
  octx.drawImage(shadowLayer, 0, 0);
  octx.drawImage(canvases["captions.ass"], 0, 0);
  return {
    compositeDataUrl: out.toDataURL("image/png"),
    mainOnlyDataUrl: canvases["captions.ass"].toDataURL("image/png"),
    initMs,
    renderMs,
    attempts
  };
};
function canvasesIdentical(c1, c2, W, H) {
  const g1 = drawnAlphaCanvas(c1, W, H).getContext("2d").getImageData(0, 0, W, H).data;
  const g2 = drawnAlphaCanvas(c2, W, H).getContext("2d").getImageData(0, 0, W, H).data;
  if (g1.length !== g2.length) return false;
  for (let i = 0; i < g1.length; i++) if (g1[i] !== g2[i]) return false;
  return true;
}
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
        identical: canvasesIdentical(frames[0], frames[i], W, H)
      });
    }
    results[layer] = cmp;
  }
  await pool.destroy();
  document.getElementById("container").innerHTML = "";
  return results;
};
window.testPlaybackLoop = async function testPlaybackLoop(W, H, mode, frameCount, startTime, dt) {
  const pool = new RendererPool(1, W, H);
  await pool.init();
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
  return {
    mode,
    W,
    H,
    frameCount,
    avgMs: avg,
    p50Ms: p50,
    p95Ms: p95,
    maxMs: Math.max(...frameMs),
    minMs: Math.min(...frameMs),
    droppedVs60fps: over60,
    droppedVs30fps: over30,
    frameMs
  };
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
