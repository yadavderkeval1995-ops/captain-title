import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "@phosphor-icons/react";

const PIXELS_PER_SECOND = 60;
const MIN_BLOCK_WIDTH = 26;

export const Timeline = ({ words, groups, duration, currentTime, playing, onToggle, onSeek, selectedIndex, onSelect }) => {
  const trackRef = useRef(null);
  // Lines by default - that's the view that actually shows how captions
  // are distributed across the video; Words is there for fine-grained
  // per-word timing work.
  const [mode, setMode] = useState("lines");
  const trackWidth = Math.max(1, duration) * PIXELS_PER_SECOND;

  const seekFromClientX = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left + trackRef.current.scrollLeft;
    onSeek(Math.min(duration, Math.max(0, x / PIXELS_PER_SECOND)));
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

  // Keep the playhead in view as the video plays instead of letting it run
  // off the edge of a scrolled timeline. Only while actually playing, so it
  // never fights a manual scroll or drag-scrub.
  useEffect(() => {
    if (!playing) return;
    const track = trackRef.current;
    if (!track) return;
    const playheadX = currentTime * PIXELS_PER_SECOND;
    const { scrollLeft, clientWidth } = track;
    if (playheadX > scrollLeft + clientWidth - 60 || playheadX < scrollLeft) {
      track.scrollLeft = Math.max(0, playheadX - clientWidth * 0.2);
    }
  }, [currentTime, playing]);

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
        <button onClick={onToggle} title={playing ? "Pause (space)" : "Play (space)"} data-testid="timeline-play-toggle">{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
        <span data-testid="current-playback-time">{currentTime.toFixed(1)}s</span>
        <b data-testid="video-total-duration">/ {duration.toFixed(1)}s</b>
        <div className="timeline-mode-toggle" data-testid="timeline-mode-toggle">
          <button className={mode === "words" ? "active" : ""} onClick={() => setMode("words")} data-testid="timeline-mode-words-button">Words</button>
          <button className={mode === "lines" ? "active" : ""} onClick={() => setMode("lines")} data-testid="timeline-mode-lines-button">Lines</button>
        </div>
      </div>
      <div className="timeline-track" ref={trackRef} onMouseDown={startScrub} data-testid="timeline-word-track">
        <div className="timeline-track-inner" style={{ width: `${trackWidth}px` }}>
          <div className="playhead" style={{ left: `${currentTime * PIXELS_PER_SECOND}px` }} data-testid="timeline-playhead" />
          {mode === "words" && words.map((word, index) => <button key={index} className={`${currentTime >= word.start && currentTime <= word.end ? "active" : ""} ${selectedIndex === index ? "selected" : ""}`}
            style={{ left: `${word.start * PIXELS_PER_SECOND}px`, width: `${Math.max(MIN_BLOCK_WIDTH, (word.end - word.start) * PIXELS_PER_SECOND)}px` }}
            onMouseDown={(e) => e.stopPropagation()} onClick={() => { onSeek(word.start); onSelect?.(index); }} data-testid={`word-block-${index}`}>
            {word.text}
          </button>)}
          {mode === "lines" && groups.map((group, cueIndex) => {
            const start = group[0].word.start, end = group[group.length - 1].word.end;
            const indices = group.map((item) => item.index);
            const isActive = currentTime >= start && currentTime <= end;
            const isSelected = indices.includes(selectedIndex);
            return <button key={cueIndex} className={`line-block ${isActive ? "active" : ""} ${isSelected ? "selected" : ""}`}
              style={{ left: `${start * PIXELS_PER_SECOND}px`, width: `${Math.max(MIN_BLOCK_WIDTH, (end - start) * PIXELS_PER_SECOND)}px` }}
              onMouseDown={(e) => e.stopPropagation()} onClick={() => { onSeek(start); onSelect?.(group[0].index); }} data-testid={`line-block-${cueIndex}`}>
              {group.map((item) => item.word.text).join(" ")}
            </button>;
          })}
        </div>
      </div>
    </section>
  );
};
