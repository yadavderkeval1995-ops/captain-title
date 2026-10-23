import { useState } from "react";
import { Plus, TextT, Trash } from "@phosphor-icons/react";
import { Slider } from "@/components/ui/slider";
import { fonts } from "@/components/ThemePanel";

export const TextPanel = ({ elements, selectedId, onSelect, onAdd, onUpdate, onDelete, currentTime, duration }) => {
  const [draft, setDraft] = useState("");
  const textLayers = elements.filter((item) => item.kind === "text");
  const selected = textLayers.find((item) => item.id === selectedId);
  const submit = () => {
    if (!draft.trim()) return;
    onAdd(draft.trim());
    setDraft("");
  };
  return (
    <aside className="tool-panel" data-testid="text-panel">
      <div className="panel-heading"><TextT size={18} /><div><span>TEXT LAYER</span><h2 data-testid="text-panel-heading">Add a title or label</h2></div></div>
      <div className="text-add-row" data-testid="text-add-row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Type text…" maxLength={60} data-testid="text-draft-input" />
        <button onClick={submit} title="Add to video" data-testid="add-text-button"><Plus size={16} /></button>
      </div>
      <div className="tool-divider" />
      <div className="panel-heading compact"><div><span>PLACED</span><h2 data-testid="text-layer-list-heading">On this video</h2></div></div>
      {!textLayers.length && <p className="panel-note" data-testid="no-text-layers-note">No text layers yet - type something above and add it at the current playhead time.</p>}
      <div className="element-list" data-testid="text-layer-list">
        {textLayers.map((item) => <div key={item.id} className={`element-row ${selectedId === item.id ? "selected" : ""}`} onClick={() => onSelect(item.id)} data-testid={`text-layer-row-${item.id}`}>
          <span className="element-glyph" style={{ color: item.color, fontSize: 11 }}>{item.char}</span>
          <span className="element-time" data-testid={`text-layer-time-${item.id}`}>{item.start.toFixed(1)}s – {item.end.toFixed(1)}s</span>
          <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} title="Remove text" data-testid={`text-layer-delete-${item.id}`}><Trash size={14} /></button>
        </div>)}
      </div>
      {selected && <>
        <div className="tool-divider" />
        <label className="control-label" data-testid="text-font-label">Font</label>
        <div className="font-grid" data-testid="text-font-selector">
          {fonts.map((item) => <button key={item.id} className={selected.font_id === item.id ? "active" : ""} style={{ fontFamily: item.family }} onClick={() => onUpdate(selected.id, { font_id: item.id })} data-testid={`text-font-${item.id}-button`}>{item.name}</button>)}
        </div>
        <label className="control-label" data-testid="text-size-label">Size <b data-testid="text-size-value">{selected.font_size}px</b></label>
        <Slider min={20} max={160} step={2} value={[selected.font_size]} onValueChange={([value]) => onUpdate(selected.id, { font_size: value })} data-testid="text-size-slider" />
        <label className="control-label" data-testid="text-color-label"><span>Colour</span>
          <input type="color" value={selected.color} onChange={(e) => onUpdate(selected.id, { color: e.target.value })} data-testid="text-color-input" />
        </label>
        <label className="control-label" data-testid="text-layer-depth-label">Layer</label>
        <div className="layout-grid two layer-depth-toggle" data-testid="text-layer-depth-toggle">
          <button className={(selected.layer || "front") === "front" ? "active" : ""} onClick={() => onUpdate(selected.id, { layer: "front" })} data-testid="text-layer-front-button">In Front</button>
          <button className={selected.layer === "behind" ? "active" : ""} onClick={() => onUpdate(selected.id, { layer: "behind" })} data-testid="text-layer-behind-button">Behind Speaker</button>
        </div>
        <label className="control-label" data-testid="text-timing-label">Timing</label>
        <div className="layout-grid two">
          <button onClick={() => onUpdate(selected.id, { start: Math.min(currentTime, selected.end - 0.1) })} data-testid="text-set-start-button">Start here</button>
          <button onClick={() => onUpdate(selected.id, { end: Math.max(Math.min(duration, currentTime), selected.start + 0.1) })} data-testid="text-set-end-button">End here</button>
        </div>
      </>}
    </aside>
  );
};
