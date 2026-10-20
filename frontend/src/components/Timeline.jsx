import { useEffect, useRef, useState } from "react";
import { Balloon, Bell, MagnifyingGlassMinus, MagnifyingGlassPlus, Money, Pause, Play, Wind, X } from "@phosphor-icons/react";

const BASE_PIXELS_PER_SECOND = 60;
const MIN_BLOCK_WIDTH = 46;
const MIN_WORD_DURATION = 0.08;
const PEAKS_PER_SECOND = 20;
const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3];
const TICK_INTERVALS = [1, 2, 5, 10, 15, 30, 60];
// Browsers cap a single canvas's intrinsic pixel width well below what a
// long, zoomed-in timeline needs (mobile Safari in particular, around
// 4096-8192px) - past that cap the canvas silently stops rendering
// anything at all. Keep the bitmap itself under that ceiling and stretch
// it to the full track width with CSS instead, so a 10-minute video at
// max zoom still draws a (slightly lower-resolution) waveform rather than
// a blank lane.
const MAX_CANVAS_WIDTH = 8000;
const SFX_TYPES = [
  { id: "whoosh", label: "Whoosh", icon: Wind, color: "#22d3ee" },
  { id: "pop", label: "Pop", icon: Balloon, color: "#ffeb3b" },
  { id: "cash", label: "Cash", icon: Money, color: "#5ee6a0" },
  { id: "ding", label: "Ding", icon: Bell, color: "#ff8fc7" },
];
const SFX_BY_TYPE = Object.fromEntries(SFX_TYPES.map((item) => [item.id, item]));

function formatTick(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function tickInterval(pxPerSecond) {
  for (const n of TICK_INTERVALS) if (n * pxPerSecond >= 56) return n;
  return TICK_INTERVALS[TICK_INTERVALS.length - 1];
}

// Used when real audio decode fails (unsupported codec, CORS, or a project
// with no audio extracted yet) so the waveform lane is never just a blank
// rectangle: louder while a word is being spoken, quiet in the gaps, with a
// deterministic (not random) wobble so it doesn't look like a dead flat bar.
function buildFallbackPeaks(words, duration) {
  const sampleCount = Math.max(1, Math.round(Math.max(duration, 1) * PEAKS_PER_SECOND));
  const peaks = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / PEAKS_PER_SECOND;
    const speaking = words.some((word) => t >= word.start && t <= word.end);
    const wobble = 0.65 + 0.35 * Math.abs(Math.sin(i * 12.9898));
    peaks[i] = speaking ? 0.35 * wobble : 0.04;
  }
  return peaks;
}

export const Timeline = ({ words, groups, duration, currentTime, playing, onToggle, onSeek, selectedIndex, onSelect,
                          onRetimeWord, mediaUrl, sfxMarkers, onAddSfx, onMoveSfx, onDeleteSfx }) => {
  const trackRef = useRef(null);
  const canvasRef = useRef(null);
  const peaksRef = useRef(null);
  // Lines by default - that's the view that actually shows how captions
  // are distributed across the video; Words is there for fine-grained
  // per-word timing work (and is the only mode where retime handles make
  // sense - a Lines block spans several words, so "drag its edge" has no
  // single unambiguous word boundary to move).
  const [mode, setMode] = useState("lines");
  const [zoom, setZoom] = useState(1);
  const pxPerSecond = BASE_PIXELS_PER_SECOND * zoom;
  const trackWidth = Math.max(1, duration) * pxPerSecond;

  const zoomIndex = ZOOM_STEPS.indexOf(zoom);
  const zoomOut = () => setZoom(ZOOM_STEPS[Math.max(0, zoomIndex - 1)]);
  const zoomIn = () => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1)]);

  const seekFromClientX = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left + trackRef.current.scrollLeft;
    onSeek(Math.min(duration, Math.max(0, x / pxPerSecond)));
  };

  const startScrub = (e) => {
    seekFromClientX(e.clientX);
    const onMove = (moveEvent) => seekFromClientX(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Drag a word block's left/right edge to re-time its start/end, clamped
  // against its own minimum duration, its neighbors, and the clip bounds.
  const startRetime = (index, edge) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const word = words[index];
    const prevWord = words[index - 1];
    const nextWord = words[index + 1];
    const startClientX = e.clientX;
    const origStart = word.start, origEnd = word.end;
    const onMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startClientX) / pxPerSecond;
      if (edge === "left") {
        let next = Math.max(0, origStart + dx);
        next = Math.min(next, origEnd - MIN_WORD_DURATION);
        if (prevWord) next = Math.max(next, prevWord.end);
        onRetimeWord(index, { start: Math.round(next * 100) / 100 });
      } else {
        let next = Math.min(duration, origEnd + dx);
        next = Math.max(next, origStart + MIN_WORD_DURATION);
        if (nextWord) next = Math.min(next, nextWord.start);
        onRetimeWord(index, { end: Math.round(next * 100) / 100 });
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startDragSfx = (marker) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const startClientX = e.clientX;
    const origTime = marker.time;
    const onMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startClientX) / pxPerSecond;
      const next = Math.min(duration, Math.max(0, origTime + dx));
      onMoveSfx(marker.id, Math.round(next * 100) / 100);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Decode the project's own audio client-side (no backend/ffmpeg round
  // trip needed) into a fixed-resolution peak table, independent of zoom -
  // the canvas draw below just re-renders those peaks at whatever the
  // current pixels-per-second happens to be.
  useEffect(() => {
    peaksRef.current = null;
    if (!mediaUrl) { drawWaveform(); return undefined; }
    let cancelled = false;
    let context;
    (async () => {
      try {
        const response = await fetch(mediaUrl, { credentials: "include" });
        if (!response.ok) throw new Error(`media fetch failed: ${response.status}`);
        const buffer = await response.arrayBuffer();
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error("Web Audio API unavailable");
        context = new AudioContextClass();
        const audioBuffer = await context.decodeAudioData(buffer);
        if (cancelled) return;
        const channel = audioBuffer.getChannelData(0);
        const sampleCount = Math.max(1, Math.round(audioBuffer.duration * PEAKS_PER_SECOND));
        const samplesPerPeak = Math.max(1, Math.floor(channel.length / sampleCount));
        const peaks = new Float32Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
          let max = 0;
          const start = i * samplesPerPeak;
          const end = Math.min(channel.length, start + samplesPerPeak);
          for (let j = start; j < end; j++) max = Math.max(max, Math.abs(channel[j]));
          peaks[i] = max;
        }
        peaksRef.current = { data: peaks, fallback: false };
      } catch (error) {
        // Real decode failed (unsupported codec, CORS, or no audio
        // extracted yet) - fall back to a synthetic waveform derived from
        // the words' own timing instead of leaving the lane blank, and log
        // it: a silently empty canvas is exactly what makes this hard to
        // diagnose in the field.
        console.warn("Timeline: waveform decode failed, using fallback peaks", error);
        if (!cancelled) peaksRef.current = { data: buildFallbackPeaks(words, duration), fallback: true };
      } finally {
        context?.close();
        if (!cancelled) drawWaveform();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrl]);

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const entry = peaksRef.current;
    if (!canvas) return;
    const width = canvas.width, height = canvas.height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    const peaks = entry?.data;
    if (!peaks || !peaks.length) return;
    ctx.fillStyle = entry.fallback ? "rgba(34,211,238,.22)" : "rgba(34,211,238,.55)";
    const mid = height / 2;
    const pxPerPeak = width / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const barHeight = Math.max(1, peaks[i] * mid);
      const x = i * pxPerPeak;
      ctx.fillRect(x, mid - barHeight, Math.max(1, pxPerPeak - 0.5), barHeight * 2);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Stay under the browser's intrinsic canvas pixel-width ceiling (a
    // long video at high zoom can easily exceed it) and stretch the
    // bitmap to the full track width with CSS instead - a lower-resolution
    // waveform beats a canvas that silently refuses to render at all.
    canvas.width = Math.max(1, Math.min(MAX_CANVAS_WIDTH, Math.ceil(trackWidth)));
    canvas.style.width = `${trackWidth}px`;
    drawWaveform();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackWidth]);

  // Keep the playhead in view as the video plays instead of letting it run
  // off the edge of a scrolled timeline. Only while actually playing, so it
  // never fights a manual scroll or drag-scrub.
  useEffect(() => {
    if (!playing) return;
    const track = trackRef.current;
    if (!track) return;
    const playheadX = currentTime * pxPerSecond;
    const { scrollLeft, clientWidth } = track;
    if (playheadX > scrollLeft + clientWidth - 60 || playheadX < scrollLeft) {
      track.scrollLeft = Math.max(0, playheadX - clientWidth * 0.2);
    }
  }, [currentTime, playing, pxPerSecond]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code !== "Space") return;
      const target = document.activeElement;
      if (["INPUT", "TEXTAREA"].includes(target?.tagName) || target?.isContentEditable) return;
      e.preventDefault();
      onToggle();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onToggle]);

  const interval = tickInterval(pxPerSecond);
  const ticks = [];
  for (let t = 0; t <= duration; t += interval) ticks.push(t);

  return (
    <section className="timeline" data-testid="caption-timeline">
      <div className="timeline-controls">
        <div className="timeline-controls-row">
          <button onClick={onToggle} title={playing ? "Pause (space)" : "Play (space)"} data-testid="timeline-play-toggle">{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
          <span data-testid="current-playback-time">{currentTime.toFixed(1)}s</span>
          <b data-testid="video-total-duration">/ {duration.toFixed(1)}s</b>
        </div>
        <div className="timeline-mode-toggle" data-testid="timeline-mode-toggle">
          <button className={mode === "words" ? "active" : ""} onClick={() => setMode("words")} data-testid="timeline-mode-words-button">Words</button>
          <button className={mode === "lines" ? "active" : ""} onClick={() => setMode("lines")} data-testid="timeline-mode-lines-button">Lines</button>
        </div>
        <div className="timeline-zoom" data-testid="timeline-zoom-control">
          <button onClick={zoomOut} disabled={zoomIndex <= 0} title="Zoom out" data-testid="timeline-zoom-out-button"><MagnifyingGlassMinus size={13} /></button>
          <span data-testid="timeline-zoom-value">{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} disabled={zoomIndex >= ZOOM_STEPS.length - 1} title="Zoom in" data-testid="timeline-zoom-in-button"><MagnifyingGlassPlus size={13} /></button>
        </div>
        <div className="timeline-sfx-palette" data-testid="timeline-sfx-palette">
          {SFX_TYPES.map(({ id, label, icon: Icon, color }) => <button key={id} style={{ color }} onClick={() => onAddSfx(id)} title={`Drop a ${label} marker here`} data-testid={`add-sfx-${id}-button`}><Icon size={14} weight="fill" /></button>)}
        </div>
      </div>
      <div className="timeline-tracks" ref={trackRef} onMouseDown={startScrub} data-testid="timeline-word-track">
        <div className="timeline-tracks-inner" style={{ width: `${trackWidth}px` }}>
          <div className="playhead" style={{ left: `${currentTime * pxPerSecond}px` }} data-testid="timeline-playhead"><i /></div>

          <div className="timeline-ruler" data-testid="timeline-ruler">
            {ticks.map((t) => <div key={t} className="timeline-tick" style={{ left: `${t * pxPerSecond}px` }}><b /><span>{formatTick(t)}</span></div>)}
          </div>

          <div className="timeline-lane timeline-lane-captions" data-testid="timeline-lane-captions">
            {mode === "words" && words.map((word, index) => {
              const isActive = currentTime >= word.start && currentTime <= word.end;
              const isSelected = selectedIndex === index;
              return <div key={index} className={`caption-block ${isActive ? "active" : ""} ${isSelected ? "selected" : ""}`}
                style={{ left: `${word.start * pxPerSecond}px`, width: `${Math.max(MIN_BLOCK_WIDTH, (word.end - word.start) * pxPerSecond)}px` }}
                data-testid={`word-block-${index}`}>
                <i className="retime-handle left" onMouseDown={startRetime(index, "left")} data-testid={`word-retime-left-${index}`} />
                <button onMouseDown={(e) => e.stopPropagation()} onClick={() => { onSeek(word.start); onSelect?.(index); }}>{word.text}</button>
                <i className="retime-handle right" onMouseDown={startRetime(index, "right")} data-testid={`word-retime-right-${index}`} />
              </div>;
            })}
            {mode === "lines" && groups.map((group, cueIndex) => {
              const start = group[0].word.start, end = group[group.length - 1].word.end;
              const indices = group.map((item) => item.index);
              const isActive = currentTime >= start && currentTime <= end;
              const isSelected = indices.includes(selectedIndex);
              return <button key={cueIndex} className={`line-block ${isActive ? "active" : ""} ${isSelected ? "selected" : ""}`}
                style={{ left: `${start * pxPerSecond}px`, width: `${Math.max(MIN_BLOCK_WIDTH, (end - start) * pxPerSecond)}px` }}
                onMouseDown={(e) => e.stopPropagation()} onClick={() => { onSeek(start); onSelect?.(group[0].index); }} data-testid={`line-block-${cueIndex}`}>
                {group.map((item) => item.word.text).join(" ")}
              </button>;
            })}
          </div>

          <div className="timeline-lane timeline-lane-waveform" data-testid="timeline-lane-waveform">
            <canvas ref={canvasRef} className="timeline-waveform" height={44} data-testid="timeline-waveform" />
          </div>

          <div className="timeline-lane timeline-lane-sfx" data-testid="timeline-lane-sfx">
            {sfxMarkers.map((marker) => {
              const meta = SFX_BY_TYPE[marker.type];
              const Icon = meta.icon;
              return <div key={marker.id} className="sfx-marker" style={{ left: `${marker.time * pxPerSecond}px`, borderColor: meta.color, color: meta.color }}
                onMouseDown={startDragSfx(marker)} title={`${meta.label} · ${marker.time.toFixed(2)}s - drag to move`} data-testid={`sfx-marker-${marker.id}`}>
                <Icon size={11} weight="fill" /><span>{meta.label}</span>
                <button onMouseDown={(e) => e.stopPropagation()} onClick={() => onDeleteSfx(marker.id)} title="Remove marker" data-testid={`sfx-marker-delete-${marker.id}`}><X size={9} weight="bold" /></button>
              </div>;
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
