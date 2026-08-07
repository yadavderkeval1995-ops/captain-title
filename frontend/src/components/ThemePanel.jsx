import { Palette, TextT, MagicWand } from "@phosphor-icons/react";
import { Slider } from "@/components/ui/slider";

const themes = [
  { id: "viral", name: "Viral", color: "#FF3B30" },
  { id: "cinematic", name: "Cinematic", color: "#FFB800" },
  { id: "minimal", name: "Minimal", color: "#F8FAFC" },
  { id: "podcast", name: "Podcast", color: "#A855F7" },
];

export const ThemePanel = ({ theme, onTheme, selectedWord, onWordStyle }) => (
  <aside className="tool-panel" data-testid="caption-tools-panel">
    <div className="panel-heading"><MagicWand size={18} /><div><span>STYLE ENGINE</span><h2 data-testid="theme-panel-heading">Caption mood</h2></div></div>
    <div className="theme-grid" data-testid="caption-theme-selector">
      {themes.map((item) => <button key={item.id} className={theme === item.id ? "active" : ""} onClick={() => onTheme(item.id)} data-testid={`theme-${item.id}-button`}>
        <i style={{ background: item.color }} /> {item.name}
      </button>)}
    </div>
    <div className="tool-divider" />
    <div className="panel-heading compact"><TextT size={18} /><div><span>SELECTED WORD</span><h2 data-testid="selected-word-heading">{selectedWord?.text || "Select a word"}</h2></div></div>
    <label className="control-label" data-testid="font-size-control-label">Font size <b data-testid="selected-word-font-size">{selectedWord?.font_size || 52}px</b></label>
    <Slider min={24} max={92} step={1} value={[selectedWord?.font_size || 52]} disabled={!selectedWord} onValueChange={([value]) => onWordStyle({ font_size: value })} data-testid="font-size-slider" />
    <label className="control-label" data-testid="word-color-control-label"><span><Palette size={16} /> Word colour</span>
      <input type="color" value={selectedWord?.color || "#FFFFFF"} disabled={!selectedWord} onChange={(e) => onWordStyle({ color: e.target.value })} data-testid="word-color-input" />
    </label>
    <button className={`emphasis-toggle ${selectedWord?.important ? "active" : ""}`} disabled={!selectedWord} onClick={() => onWordStyle({ important: !selectedWord?.important })} data-testid="important-word-toggle">
      <span>Impact emphasis</span><i />
    </button>
  </aside>
);