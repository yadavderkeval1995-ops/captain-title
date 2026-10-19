import { useMemo } from "react";
import { MagicWand, SpinnerGap, Sparkle, Trash } from "@phosphor-icons/react";

// A conservative, heuristic filler-word list (English + common Hinglish) -
// not an AI call, just a quick local scan so it's instant and free.
const FILLER_WORDS = new Set([
  "um", "umm", "uh", "uhh", "hmm", "like", "actually", "basically", "matlab",
  "yaar", "toh", "vo", "voh", "haan", "right", "well", "literally", "ok", "okay",
]);

function isFiller(word) {
  const clean = (word.text || "").toLowerCase().replace(/[^a-zऀ-ॿ]/gi, "");
  return FILLER_WORDS.has(clean);
}

export const AiToolsPanel = ({ words, onDeleteWords, onReassignEmphasis, reassigning }) => {
  const fillers = useMemo(() => words.filter(isFiller), [words]);
  return (
    <aside className="tool-panel" data-testid="ai-tools-panel">
      <div className="panel-heading"><Sparkle size={18} /><div><span>AI ASSIST</span><h2 data-testid="ai-tools-panel-heading">Smart cleanup</h2></div></div>
      <p className="panel-note" data-testid="filler-note">
        {fillers.length ? `${fillers.length} filler word${fillers.length === 1 ? "" : "s"} found (um, matlab, basically…).` : "No obvious filler words found."}
      </p>
      {fillers.length > 0 && <>
        <div className="element-list" data-testid="filler-list">
          {fillers.map((word) => <div key={word.index} className="element-row" data-testid={`filler-row-${word.index}`}>
            <span className="element-glyph" style={{ fontSize: 12 }}>"{word.text}"</span>
            <span className="element-time">{word.start.toFixed(1)}s</span>
            <button onClick={() => onDeleteWords([word.index])} title="Remove this word" data-testid={`filler-delete-${word.index}`}><Trash size={14} /></button>
          </div>)}
        </div>
        <button className="panel-action-button" onClick={() => onDeleteWords(fillers.map((word) => word.index))} data-testid="remove-all-fillers-button">
          <Trash size={16} /> Remove all {fillers.length}
        </button>
      </>}
      <div className="tool-divider" />
      <div className="panel-heading compact"><MagicWand size={18} /><div><span>EMPHASIS</span><h2 data-testid="reassign-emphasis-heading">Re-run AI highlighting</h2></div></div>
      <p className="panel-note">Re-reads your current caption text and re-picks which words get the Key / Feature / Support treatment - useful after hand-editing text.</p>
      <button className="panel-action-button" onClick={onReassignEmphasis} disabled={reassigning} data-testid="reassign-emphasis-button">
        {reassigning ? <SpinnerGap className="spin" size={16} /> : <MagicWand size={16} />} {reassigning ? "Thinking…" : "Re-run AI emphasis"}
      </button>
    </aside>
  );
};
