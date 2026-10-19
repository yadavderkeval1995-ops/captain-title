import { useEffect, useRef } from "react";
import { Pause, Play } from "@phosphor-icons/react";

const PIXELS_PER_SECOND = 60;
const MIN_BLOCK_WIDTH = 26;

export const Timeline = ({ words, duration, currentTime, playing, onToggle, onSeek }) => {
  const trackRef = useRef(null);
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
      </div>
      <div className="timeline-track" ref={trackRef} onMouseDown={startScrub} data-testid="timeline-word-track">
        <div className="timeline-track-inner" style={{ width: `${trackWidth}px` }}>
          <div className="playhead" style={{ left: `${currentTime * PIXELS_PER_SECOND}px` }} data-testid="timeline-playhead" />
          {words.map((word, index) => <button key={index} className={currentTime >= word.start && currentTime <= word.end ? "active" : ""}
            style={{ left: `${word.start * PIXELS_PER_SECOND}px`, width: `${Math.max(MIN_BLOCK_WIDTH, (word.end - word.start) * PIXELS_PER_SECOND)}px` }}
            onMouseDown={(e) => e.stopPropagation()} onClick={() => onSeek(word.start)} data-testid={`word-block-${index}`}>
            {word.text}
          </button>)}
        </div>
      </div>
    </section>
  );
};
