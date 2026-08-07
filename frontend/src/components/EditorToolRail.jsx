import { ClosedCaptioning, FolderOpen, TextT, Sparkle, SlidersHorizontal } from "@phosphor-icons/react";

const tools = [
  ["captions", ClosedCaptioning, "Captions"], ["templates", Sparkle, "Templates"],
  ["fonts", TextT, "Fonts"], ["presets", FolderOpen, "Presets"],
  ["inspector", SlidersHorizontal, "Style"],
];

export const EditorToolRail = ({ active, onChange }) => (
  <nav className="pro-tool-rail" data-testid="editor-tool-rail">
    {tools.map(([id, Icon, label]) => <button key={id} className={active === id ? "active" : ""} onClick={() => onChange(id)} title={label} data-testid={`editor-tool-${id}-button`}>
      <Icon size={20} weight={active === id ? "fill" : "regular"} /><span>{label}</span>
    </button>)}
  </nav>
);