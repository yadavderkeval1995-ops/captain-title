import { useEffect, useRef, useState } from "react";
import { MagnifyingGlassMinus, MagnifyingGlassPlus, Pause, Play } from "@phosphor-icons/react";

const BASE_PIXELS_PER_SECOND = 60;
const MIN_BLOCK_WIDTH = 46;
const PEAKS_PER_SECOND = 20;
const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3];

export const Timeline = ({ words, groups, duration, currentTime, playing, onToggle, onSeek, selectedIndex, onSelect, mediaUrl }) => {
  const trackRef = useRef(null);
  const canvasRef = useRef(null);
  const peaksRef = useRef(null);
  // Lines by default - that's the view that actually shows how captions
  // are distributed across the video; Words is there for fine-grained
  // per-word timing work.
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

  // Decode the project's own audio client-side (no backend/ffmpeg round
  // trip needed) into a fixed-resolution peak table, independent of zoom -
  // the canvas draw below just re-renders those peaks at whatever the
  // current pixels-per-second happens to be.
  useEffect(() => {
    peaksRef.current = null;
    if (!mediaUrl) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(mediaUrl, { credentials: "include" });
        const buffer = await response.arrayBuffer();
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        const context = new AudioContextClass();
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
        peaksRef.current = peaks;
        context.close();
      } catch {
        // No waveform is a cosmetic loss, not a functional one - the
        // timeline still works fine without it (e.g. decode unsupported,
        // CORS, or a still-processing project with no audio yet).
      } finally {
        if (!cancelled) drawWaveform();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrl]);

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const peaks = peaksRef.current;
    if (!canvas) return;
    const height = canvas.height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, height);
    if (!peaks || !peaks.length) return;
    ctx.fillStyle = "rgba(255,80,105,.35)";
    const mid = height / 2;
    const pxPerPeak = trackWidth / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const barHeight = Math.max(1, peaks[i] * mid);
      const x = i * pxPerPeak;
      ctx.fillRect(x, mid - barHeight, Math.max(1, pxPerPeak - 0.5), barHeight * 2);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.ceil(trackWidth);
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
      </div>
      <div className="timeline-track" ref={trackRef} onMouseDown={startScrub} data-testid="timeline-word-track">
        <div className="timeline-track-inner" style={{ width: `${trackWidth}px` }}>
          <canvas ref={canvasRef} className="timeline-waveform" height={72} data-testid="timeline-waveform" />
          <div className="playhead" style={{ left: `${currentTime * pxPerSecond}px` }} data-testid="timeline-playhead" />
          {mode === "words" && words.map((word, index) => <button key={index} className={`${currentTime >= word.start && currentTime <= word.end ? "active" : ""} ${selectedIndex === index ? "selected" : ""}`}
            style={{ left: `${word.start * pxPerSecond}px`, width: `${Math.max(MIN_BLOCK_WIDTH, (word.end - word.start) * pxPerSecond)}px` }}
            onMouseDown={(e) => e.stopPropagation()} onClick={() => { onSeek(word.start); onSelect?.(index); }} data-testid={`word-block-${index}`}>
            {word.text}
          </button>)}
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
      </div>
    </section>
  );
};
