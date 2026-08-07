import { Pause, Play } from "@phosphor-icons/react";

export const Timeline = ({ words, duration, currentTime, playing, onToggle, onSeek }) => (
  <section className="timeline" data-testid="caption-timeline">
    <div className="timeline-controls">
      <button onClick={onToggle} title={playing ? "Pause" : "Play"} data-testid="timeline-play-toggle">{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
      <span data-testid="current-playback-time">{currentTime.toFixed(1)}s</span>
      <b data-testid="video-total-duration">/ {duration.toFixed(1)}s</b>
    </div>
    <div className="timeline-track" data-testid="timeline-word-track">
      <div className="playhead" style={{ left: `${Math.min(100, (currentTime / duration) * 100)}%` }} data-testid="timeline-playhead" />
      {words.map((word, index) => <button key={index} className={currentTime >= word.start && currentTime <= word.end ? "active" : ""}
        style={{ width: `${Math.max(2.4, ((word.end - word.start) / duration) * 100)}%` }} onClick={() => onSeek(word.start)} data-testid={`word-block-${index}`}>
        {word.text}
      </button>)}
    </div>
  </section>
);