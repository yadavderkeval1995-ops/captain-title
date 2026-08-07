import { FloppyDisk, Trash } from "@phosphor-icons/react";
import { useState } from "react";

export const PresetLibrary = ({ presets, onSave, onApply, onDelete }) => {
  const [name, setName] = useState("");
  return <section className="preset-library" data-testid="preset-library-panel">
    <div className="pro-panel-header"><div><span>REUSABLE BRAND STYLES</span><h2>My presets</h2></div></div>
    <div className="preset-create"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Preset name" data-testid="preset-name-input" /><button onClick={() => { if (name.trim()) { onSave(name.trim()); setName(""); } }} data-testid="save-current-preset-button"><FloppyDisk size={16} /> Save</button></div>
    <div className="preset-list">
      {presets.map((preset, index) => <div key={preset.preset_id} className="preset-row" data-testid={`preset-row-${index}`}>
        <button onClick={() => onApply(preset)} data-testid={`apply-preset-${index}`}><i style={{ background: preset.style?.accentColor || "#007AFF" }} />{preset.name}</button>
        <button onClick={() => onDelete(preset.preset_id)} title="Delete preset" data-testid={`delete-preset-${index}`}><Trash size={15} /></button>
      </div>)}
      {!presets.length && <p className="panel-empty" data-testid="preset-empty-state">Save a style once, reuse it everywhere.</p>}
    </div>
  </section>;
};