import { ArrowClockwise, ListBullets } from "@phosphor-icons/react";

export const TranscriptPanel = ({ words, originalTranscript, transcriptionMode, activeIndex, selectedIndex, onSelect, onText, onRelisten, relistening }) => (
  <aside className="transcript-panel" data-testid="transcript-editor-panel">
    <div className="panel-heading"><ListBullets size={18} /><div><span>HINGLISH TRANSCRIPT</span><h2 data-testid="transcript-panel-heading">Word by word</h2></div></div>
    <div className="raw-transcript" data-testid="whisper-raw-transcript">
      <div className="raw-transcript-head">
        <span data-testid="whisper-raw-transcript-label">WHISPER HEARD · {transcriptionMode === "hi" ? "HINDI PASS" : "ADAPTIVE PASS"}</span>
        <button onClick={onRelisten} disabled={relistening} data-testid="retranscribe-project-button"><ArrowClockwise size={13} className={relistening ? "spin" : ""} /> {relistening ? "Listening…" : "Re-listen"}</button>
      </div>
      <p data-testid="whisper-raw-transcript-text">{originalTranscript || words.map((word) => word.original).join(" ")}</p>
    </div>
    <div className="transcript-scroll" data-testid="editable-transcript-list">
      {words.map((word, index) => <div key={`${word.start}-${index}`} className={`transcript-word ${activeIndex === index ? "playing" : ""} ${selectedIndex === index ? "selected" : ""} ${word.uncertain ? "uncertain" : ""}`} onClick={() => onSelect(index)} data-testid={`transcript-word-row-${index}`}>
        <span data-testid={`transcript-word-time-${index}`}>{word.start.toFixed(2)}</span>
        <input value={word.text} onChange={(e) => onText(index, e.target.value)} aria-label={`Caption word ${index + 1}`} data-testid={`transcript-word-input-${index}`} />
        {word.uncertain ? <b title="Please verify this word" data-testid={`uncertain-word-indicator-${index}`}>?</b> : word.important && <i title="Impact word" data-testid={`important-word-indicator-${index}`} />}
      </div>)}
    </div>
  </aside>
);