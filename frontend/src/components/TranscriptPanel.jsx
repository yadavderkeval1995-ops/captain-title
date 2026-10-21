import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise, ListBullets, Scissors, TextAa, X } from "@phosphor-icons/react";

const SENTENCE_END_CHARS = ".!?।॥"; // includes Devanagari danda/double danda
const CHUNK_SIZE = 4; // short, scannable cards instead of one tall sentence block
function endsSentence(word) {
  const original = (word.original || word.text || "").trim();
  return !!original && SENTENCE_END_CHARS.includes(original[original.length - 1]);
}

// Captik's left panel reads like a script, but in short, scannable chunks -
// a card breaks every CHUNK_SIZE words, or earlier at a sentence end (so a
// short sentence still gets its own clean card instead of bleeding into the
// next one). Groups independently from the on-screen caption/timeline cue
// groups, straight off the flat words array using real array position as
// the index (same addressing every other editor control already relies on).
function groupIntoChunks(words) {
  const chunks = [];
  let current = [];
  words.forEach((word, index) => {
    current.push({ word, index });
    if (endsSentence(word) || current.length >= CHUNK_SIZE) {
      chunks.push(current);
      current = [];
    }
  });
  if (current.length) chunks.push(current);
  return chunks;
}

const EMPHASIS_TIERS = [
  { id: "support", label: "Support" },
  { id: "feature", label: "Feature" },
  { id: "key", label: "Key" },
];

const WordPopover = ({ word, index, anchor, onClose, onText, onNewLine, onSplitWord, onEmphasis }) => {
  const [draft, setDraft] = useState(word.text);
  const inputRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => { setDraft(word.text); }, [word.text]);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  useEffect(() => {
    const onDocMouseDown = (e) => { if (popoverRef.current && !popoverRef.current.contains(e.target)) onClose(); };
    const onKeyDown = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("mousedown", onDocMouseDown); window.removeEventListener("keydown", onKeyDown); };
  }, [onClose]);

  const commitText = () => { if (draft.trim() && draft !== word.text) onText(index, draft.trim()); };
  const splitHere = () => {
    const pos = inputRef.current?.selectionStart ?? Math.ceil(draft.length / 2);
    commitText();
    onSplitWord(index, pos);
    onClose();
  };

  const left = Math.min(anchor.x, Math.max(8, window.innerWidth - 272));
  const top = Math.min(anchor.y, window.innerHeight - 220);

  return (
    <div ref={popoverRef} className="fixed z-50 w-64 rounded-lg border border-zinc-700 bg-[#17171a] p-3 shadow-xl"
      style={{ left, top }} data-testid={`script-word-popover-${index}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold tracking-[.14em] text-zinc-500">EDIT WORD</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-white" data-testid="script-popover-close"><X size={13} weight="bold" /></button>
      </div>
      <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { commitText(); onClose(); } }}
        onBlur={commitText}
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white outline-none focus:border-[#ff2d4d]"
        data-testid={`script-popover-input-${index}`} />
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button onClick={splitHere} className="flex items-center justify-center gap-1 rounded bg-zinc-800 px-2 py-1.5 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-700"
          title="Split this word into two, at the cursor" data-testid={`script-split-word-${index}`}>
          <Scissors size={12} /> Split word
        </button>
        <button onClick={() => { onNewLine(index); onClose(); }} className="flex items-center justify-center gap-1 rounded bg-zinc-800 px-2 py-1.5 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-700"
          title="Toggle a caption line break before this word" data-testid={`script-split-line-${index}`}>
          <TextAa size={12} /> Split line
        </button>
      </div>
      <div className="mt-2">
        <span className="block mb-1 text-[10px] font-semibold tracking-[.1em] text-zinc-500">EMPHASIS</span>
        <div className="grid grid-cols-3 gap-1.5">
          {EMPHASIS_TIERS.map((tier) => <button key={tier.id} onClick={() => { onEmphasis(index, tier.id); onClose(); }}
            className={`rounded px-1.5 py-1 text-[11px] font-semibold ${word.emphasis === tier.id ? "bg-[#ff2d4d] text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
            data-testid={`script-emphasis-${tier.id}-${index}`}>{tier.label}</button>)}
        </div>
      </div>
    </div>
  );
};

// One caption line/cue per card (same grouping the live preview and the
// final render use), with its words flowing inline - matches how a cue
// actually reads on screen, instead of one disconnected row per word.
export const TranscriptPanel = ({ words, originalTranscript, transcriptionMode, activeIndex, selectedIndex,
                                  onSelect, onText, onNewLine, onSplitWord, onEmphasis, onRelisten, relistening,
                                  scriptMode = "roman", onScriptMode }) => {
  const sentences = useMemo(() => groupIntoChunks(words), [words]);
  const [popover, setPopover] = useState(null); // { index, x, y }
  const cardRefs = useRef({});

  const activeSentenceIndex = sentences.findIndex((sentence) => sentence.some(({ index }) => index === activeIndex));

  // Keep whichever card is currently being spoken centered in view, without
  // fighting a manual scroll on every currentTime tick - only re-run when
  // the active sentence itself changes.
  useEffect(() => {
    if (activeSentenceIndex < 0) return;
    cardRefs.current[activeSentenceIndex]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeSentenceIndex]);

  const openPopover = (index, target) => {
    const rect = target.getBoundingClientRect();
    setPopover({ index, x: rect.left, y: rect.bottom + 6 });
  };

  return (
    <aside className="transcript-panel" data-testid="transcript-editor-panel">
      <div className="panel-heading"><ListBullets size={18} /><div><span>HINGLISH TRANSCRIPT</span><h2 data-testid="transcript-panel-heading">Script</h2></div></div>
      <div className="script-mode-toggle" data-testid="script-mode-toggle">
        <button className={scriptMode === "roman" ? "active" : ""} onClick={() => onScriptMode?.("roman")} data-testid="script-mode-roman-button">English Letters</button>
        <button className={scriptMode === "native" ? "active" : ""} onClick={() => onScriptMode?.("native")} data-testid="script-mode-native-button">Native Script</button>
      </div>
      <div className="raw-transcript" data-testid="whisper-raw-transcript">
        <div className="raw-transcript-head">
          <span data-testid="whisper-raw-transcript-label">TRANSCRIPT · {transcriptionMode === "hi" ? "HINDI PASS" : "ADAPTIVE PASS"}</span>
          <button onClick={onRelisten} disabled={relistening} data-testid="retranscribe-project-button"><ArrowClockwise size={13} className={relistening ? "spin" : ""} /> {relistening ? "Listening…" : "Re-listen"}</button>
        </div>
        <p data-testid="whisper-raw-transcript-text">{originalTranscript || words.map((word) => word.original).join(" ")}</p>
      </div>
      <div className="transcript-scroll" data-testid="editable-transcript-list">
        {sentences.map((sentence, sentenceIndex) => {
          const start = sentence[0].word.start, end = sentence[sentence.length - 1].word.end;
          const isActive = sentenceIndex === activeSentenceIndex;
          return <div key={sentence[0].index} ref={(el) => { cardRefs.current[sentenceIndex] = el; }}
            className={`rounded-md border p-2.5 transition-colors ${isActive ? "border-[#ff2d4d]/60 bg-[#2a0f14]" : "border-zinc-800 bg-[#151113]"}`}
            data-testid={`script-sentence-${sentenceIndex}`}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-zinc-800 text-[10px] font-semibold text-zinc-400" data-testid={`script-sentence-number-${sentenceIndex}`}>{sentenceIndex + 1}</span>
              <span className="font-mono text-[9px] text-zinc-500" data-testid={`script-sentence-time-${sentenceIndex}`}>{start.toFixed(1)}s → {end.toFixed(1)}s</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-y-1">
              {sentence.map(({ word, index }) => <button key={index} type="button"
                onClick={(e) => onSelect(index, e.currentTarget)}
                onDoubleClick={(e) => { e.preventDefault(); openPopover(index, e.currentTarget); }}
                onContextMenu={(e) => { e.preventDefault(); openPopover(index, e.currentTarget); }}
                className={`mr-1 flex flex-col items-start rounded px-2 py-1 leading-none transition-colors ${
                  activeIndex === index ? "bg-[#ff2d4d] text-white"
                    : selectedIndex === index ? "bg-zinc-700 text-white ring-1 ring-[#ff2d4d]"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white"
                } ${word.important || word.emphasis === "key" ? "font-bold" : ""}`}
                title={word.uncertain ? "Uncertain transcription - double-click to fix the spelling" : "Click to seek · double-click or right-click to edit"}
                data-testid={`script-word-${index}`} data-uncertain={word.uncertain ? "true" : undefined}>
                <span className="text-[13px]" data-testid={`script-word-text-${index}`}>
                  {scriptMode === "native" ? (word.original || word.text) : word.text}
                </span>
              </button>)}
            </div>
          </div>;
        })}
      </div>
      {popover && <WordPopover word={words[popover.index]} index={popover.index} anchor={popover} onClose={() => setPopover(null)}
        onText={onText} onNewLine={onNewLine} onSplitWord={onSplitWord} onEmphasis={onEmphasis} />}
    </aside>
  );
};
