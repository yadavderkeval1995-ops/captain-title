import { ArrowsMerge, MagnifyingGlassMinus, MagnifyingGlassPlus, Pause, Play, Scissors } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";

const timecode = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
};

export const ProTimeline = ({ groups, waveform, duration, currentTime, playing, selectedId,
  onSelect, onSeek, onToggle, onUpdateGroup, onCheckpoint, onSplit, onMerge }) => {
  const [zoom, setZoom] = useState(78);
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const width = Math.max(900, duration * zoom + 80);
  const rulerStep = zoom >= 130 ? 1 : zoom >= 80 ? 2 : 5;
  const marks = useMemo(() => Array.from({ length: Math.ceil(duration / rulerStep) + 1 }, (_, index) => index * rulerStep), [duration, rulerStep]);
  const peaks = waveform?.length ? waveform : Array.from({ length: 180 }, (_, index) => groups.some((group) => group.start <= (index / 180) * duration && group.end >= (index / 180) * duration) ? 0.62 : 0.08);

  const seekFromPointer = (event) => {
    const track = scrollRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const seconds = Math.max(0, Math.min(duration, (event.clientX - rect.left + track.scrollLeft - 70) / zoom));
    onSeek(seconds);
  };

  const startPlayheadDrag = (event) => {
    event.preventDefault();
    const move = (moveEvent) => seekFromPointer(moveEvent);
    const stop = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", stop); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", stop); seekFromPointer(event);
  };

  const startBlockDrag = (event, group, mode) => {
    event.preventDefault(); event.stopPropagation(); onSelect(group.id); onCheckpoint();
    dragRef.current = { id: group.id, mode, x: event.clientX, start: group.start, end: group.end };
    const move = (moveEvent) => {
      const drag = dragRef.current; if (!drag) return;
      const delta = (moveEvent.clientX - drag.x) / zoom;
      const length = drag.end - drag.start;
      if (drag.mode === "move") {
        const start = Math.max(0, Math.min(duration - length, drag.start + delta));
        onUpdateGroup(drag.id, { start, end: start + length });
      } else if (drag.mode === "start") onUpdateGroup(drag.id, { start: Math.max(0, Math.min(drag.end - 0.08, drag.start + delta)) });
      else onUpdateGroup(drag.id, { end: Math.min(duration, Math.max(drag.start + 0.08, drag.end + delta)) });
    };
    const stop = () => { dragRef.current = null; document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", stop); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", stop);
  };

  return <section className="pro-timeline" data-testid="pro-editor-timeline">
    <div className="timeline-toolbar">
      <div className="transport"><button onClick={onToggle} data-testid="timeline-space-play-toggle">{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button><span data-testid="timeline-current-time">{timecode(currentTime)}</span><small data-testid="timeline-duration">/ {timecode(duration)}</small></div>
      <div className="timeline-modes"><button className="active" data-testid="timeline-phrase-mode-button">PHRASE</button><button disabled data-testid="timeline-word-mode-button">WORD</button></div>
      <div className="timeline-edit-actions"><button onClick={() => onSplit(selectedId)} disabled={!selectedId} title="Split selected caption" data-testid="timeline-split-button"><Scissors /> Split</button><button onClick={() => onMerge(selectedId)} disabled={!selectedId} title="Merge with next" data-testid="timeline-merge-button"><ArrowsMerge /> Merge</button></div>
      <div className="timeline-zoom"><MagnifyingGlassMinus /><input type="range" min="42" max="220" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} data-testid="timeline-zoom-slider" /><MagnifyingGlassPlus /><b data-testid="timeline-zoom-value">{Math.round(zoom / 78 * 100)}%</b></div>
    </div>
    <div className="timeline-scroll" ref={scrollRef} data-testid="timeline-scroll-container">
      <div className="timeline-canvas" style={{ width }} onPointerDown={startPlayheadDrag} data-testid="timeline-seek-surface">
        <div className="time-ruler"><span className="track-label">TIME</span>{marks.map((mark) => <i key={mark} style={{ left: 70 + mark * zoom }}><b>{timecode(mark).slice(0, 5)}</b></i>)}</div>
        <div className="timeline-lane caption-lane"><span className="track-label">Captions</span>{groups.map((group, index) => <button key={group.id} className={`caption-block ${selectedId === group.id ? "selected" : ""}`} style={{ left: 70 + group.start * zoom, width: Math.max(18, (group.end - group.start) * zoom) }} onPointerDown={(event) => startBlockDrag(event, group, "move")} data-testid={`timeline-caption-block-${index}`}>
          <em onPointerDown={(event) => startBlockDrag(event, group, "start")} data-testid={`timeline-caption-start-handle-${index}`} />
          <span>{group.text}</span><em onPointerDown={(event) => startBlockDrag(event, group, "end")} data-testid={`timeline-caption-end-handle-${index}`} />
        </button>)}</div>
        <div className="timeline-lane video-lane"><span className="track-label">Video 1</span><div className="video-strip">VIDEO · {duration.toFixed(1)} SEC</div></div>
        <div className="timeline-lane audio-lane"><span className="track-label">Audio 1</span><div className="waveform" data-testid="timeline-audio-waveform">{peaks.map((peak, index) => <i key={index} style={{ height: `${Math.max(6, peak * 58)}px`, left: 70 + (index / peaks.length) * duration * zoom }} />)}</div></div>
        <div className="timeline-playhead" style={{ left: 70 + currentTime * zoom }} onPointerDown={startPlayheadDrag} data-testid="draggable-timeline-playhead"><i /><span /></div>
      </div>
    </div>
    <p className="timeline-shortcut-hint" data-testid="timeline-shortcut-hint"><kbd>Space</kbd> Play / pause · click or drag the blue playhead · drag caption edges to correct timing</p>
  </section>;
};