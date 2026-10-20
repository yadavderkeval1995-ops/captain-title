import { ArrowClockwise, ListBullets } from "@phosphor-icons/react";

// One caption line/cue per card (same grouping the live preview and the
// final render use), with its words flowing inline - matches how a cue
// actually reads on screen, instead of one disconnected row per word.
export const TranscriptPanel = ({ words, groups, originalTranscript, transcriptionMode, activeIndex, selectedIndex, onSelect, onText, onRelisten, relistening }) => (
  <aside className="transcript-panel" data-testid="transcript-editor-panel">
    <div className="panel-heading"><ListBullets size={18} /><div><span>HINGLISH TRANSCRIPT</span><h2 data-testid="transcript-panel-heading">Captions</h2></div></div>
    <div className="raw-transcript" data-testid="whisper-raw-transcript">
      <div className="raw-transcript-head">
        <span data-testid="whisper-raw-transcript-label">TRANSCRIPT · {transcriptionMode === "hi" ? "HINDI PASS" : "ADAPTIVE PASS"}</span>
        <button onClick={onRelisten} disabled={relistening} data-testid="retranscribe-project-button"><ArrowClockwise size={13} className={relistening ? "spin" : ""} /> {relistening ? "Listening…" : "Re-listen"}</button>
      </div>
      <p data-testid="whisper-raw-transcript-text">{originalTranscript || words.map((word) => word.original).join(" ")}</p>
    </div>
    <div className="transcript-scroll" data-testid="editable-transcript-list">
      {groups.map((group, cueIndex) => <div key={group[0].word.index} className="transcript-cue" data-testid={`transcript-cue-${cueIndex}`}>
        <div className="transcript-cue-head">
          <span className="transcript-cue-number" data-testid={`transcript-cue-number-${cueIndex}`}>{cueIndex + 1}</span>
          <span className="transcript-cue-time" data-testid={`transcript-cue-time-${cueIndex}`}>{group[0].word.start.toFixed(1)} → {group[group.length - 1].word.end.toFixed(1)}</span>
        </div>
        <div className="transcript-cue-words">
          {group.map(({ word, index }) => <span key={index} className={`transcript-word-chip ${activeIndex === index ? "playing" : ""} ${selectedIndex === index ? "selected" : ""} ${word.uncertain ? "uncertain" : ""} ${word.important ? "important" : ""}`} onClick={() => onSelect(index)} data-testid={`transcript-word-row-${index}`}>
            <input value={word.text} onChange={(e) => onText(index, e.target.value)} style={{ width: `${Math.max(1, word.text.length)}ch` }} aria-label={`Caption word ${index + 1}`} data-testid={`transcript-word-input-${index}`} />
            {word.uncertain && <sup title="Please verify this word" data-testid={`uncertain-word-indicator-${index}`}>?</sup>}
          </span>)}
        </div>
      </div>)}
    </div>
  </aside>
);
