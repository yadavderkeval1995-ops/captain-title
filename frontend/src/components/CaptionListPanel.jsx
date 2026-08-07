import { ArrowsMerge, Scissors, WarningCircle } from "@phosphor-icons/react";

export const CaptionListPanel = ({ groups, words, selectedId, onSelect, onText, onSplit, onMerge }) => (
  <section className="caption-list-panel" data-testid="caption-group-list-panel">
    <div className="pro-panel-header"><div><span>CAPTIONS</span><h2>Phrase editor</h2></div><b data-testid="caption-group-count">{groups.length}</b></div>
    <div className="caption-list-scroll" data-testid="caption-group-list">
      {groups.map((group, index) => {
        const uncertain = group.word_indices.some((wordIndex) => words[wordIndex]?.uncertain);
        return <article key={group.id} className={`caption-list-row ${selectedId === group.id ? "selected" : ""}`} onClick={() => onSelect(group.id)} data-testid={`caption-group-row-${index}`}>
          <span className="caption-row-number" data-testid={`caption-group-number-${index}`}>{index + 1}</span>
          <div><textarea value={group.text} rows={2} maxLength={120} onChange={(event) => onText(group.id, event.target.value)} data-testid={`caption-group-text-${index}`} />
            <small data-testid={`caption-group-time-${index}`}>{group.start.toFixed(2)}s — {group.end.toFixed(2)}s</small>
          </div>
          <div className="caption-row-actions">
            {uncertain && <WarningCircle size={16} title="Contains words to verify" data-testid={`caption-group-warning-${index}`} />}
            <button onClick={(event) => { event.stopPropagation(); onSplit(group.id); }} title="Split phrase" data-testid={`split-caption-group-${index}`}><Scissors size={15} /></button>
            <button onClick={(event) => { event.stopPropagation(); onMerge(group.id); }} title="Merge with next" data-testid={`merge-caption-group-${index}`}><ArrowsMerge size={15} /></button>
          </div>
        </article>;
      })}
    </div>
  </section>
);