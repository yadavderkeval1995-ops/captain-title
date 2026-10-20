import { Palette, Rows, Sparkle, SquaresFour, TextT } from "@phosphor-icons/react";
import { Slider } from "@/components/ui/slider";

const wordsPerCaptionOptions = [null, 1, 2, 3, 4, 5, 6, 8];
const positions = ["top", "middle", "bottom"];
const tabs = [
  { id: "templates", label: "Templates", icon: SquaresFour },
  { id: "customize", label: "Customize", icon: Rows },
  { id: "text", label: "Text", icon: TextT },
];

export const templates = [
  { id: "viral", name: "Viral", baseColor: "#FFFFFF", color: "#FF3B30", accentFont: "Anton" },
  { id: "cinematic", name: "Cinematic", baseColor: "#FFF7DB", color: "#FFB800", accentFont: "Caveat" },
  { id: "minimal", name: "Minimal", baseColor: "#FFFFFF", color: "#007AFF", accentFont: null },
  { id: "podcast", name: "Podcast", baseColor: "#FFFFFF", color: "#A855F7", accentFont: null },
  { id: "meme_mix", name: "Meme Mix", baseColor: "#FFFFFF", color: "#FFEB3B", accentFont: "Permanent Marker" },
  { id: "street_pop", name: "Street Pop", baseColor: "#FFFFFF", color: "#FF6EC7", accentFont: "Caveat" },
  // Designer "tiered" templates: a 3-way support/feature/key reading of each
  // word instead of a flat important/normal split, each tier with its own
  // font/color/size - mirrors backend/captions.py's THEMES tiers exactly.
  { id: "editorial_pop", name: "Editorial Pop", color: "#FFEB3B", tiers: {
    support: { font: "'Poppins', sans-serif", color: "#FFFFFF", size: 40 },
    feature: { font: "'Playfair Display', serif", color: "#FFFFFF", size: 58 },
    key: { font: "'Anton', sans-serif", color: "#FFEB3B", size: 82 },
  } },
  { id: "clean_vogue", name: "Clean Vogue", color: "#FF8FC7", tiers: {
    support: { font: "'Poppins', sans-serif", color: "#E4E4E7", size: 38 },
    feature: { font: "'Playfair Display', serif", color: "#FF8FC7", size: 56 },
    key: { font: "'Bebas Neue', sans-serif", color: "#FFFFFF", size: 86 },
  } },
  { id: "street_heat", name: "Street Heat", color: "#FF4D00", tiers: {
    support: { font: "'Poppins', sans-serif", color: "#FFFFFF", size: 40 },
    feature: { font: "'Permanent Marker', cursive", color: "#FFFFFF", size: 54 },
    key: { font: "'Anton', sans-serif", color: "#FF4D00", size: 84 },
  } },
];

export const fonts = [
  { id: "poppins", name: "Poppins", family: "'Poppins', sans-serif" },
  { id: "anton", name: "Anton", family: "'Anton', sans-serif" },
  { id: "bebas", name: "Bebas Neue", family: "'Bebas Neue', sans-serif" },
  { id: "classic", name: "Classic", family: "'DejaVu Sans', sans-serif" },
];

export const ThemePanel = ({ theme, onTheme, fontId, onFont, wordsPerCaption, onWordsPerCaption,
                             captionLines, onCaptionLines, captionPosition, onCaptionPosition,
                             selectedWord, onWordStyle, tab, onTab }) => {
  const activeTiers = templates.find((item) => item.id === theme)?.tiers;
  const isTiered = !!activeTiers;
  const setEmphasis = (tier) => {
    const config = activeTiers[tier];
    onWordStyle({ emphasis: tier, important: tier !== "support", color: config.color, font_size: config.size });
  };
  return (
  <aside className="tool-panel" data-testid="caption-tools-panel">
    <div className="panel-tabs" data-testid="caption-tool-tabs">
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => onTab(id)} data-testid={`caption-tab-${id}-button`}>
        <Icon size={17} /> {label}
      </button>)}
    </div>

    {tab === "templates" && <>
      <div className="panel-heading"><Sparkle size={18} /><div><span>STYLE ENGINE</span><h2 data-testid="theme-panel-heading">Caption template</h2></div></div>
      <div className="theme-grid" data-testid="caption-theme-selector">
        {templates.map((item) => <button key={item.id} className={theme === item.id ? "active" : ""} onClick={() => onTheme(item.id)} data-testid={`theme-${item.id}-button`}>
          <i style={{ background: item.color }} /> {item.name}
        </button>)}
      </div>
    </>}

    {tab === "customize" && <>
      <div className="panel-heading"><TextT size={18} /><div><span>TYPEFACE</span><h2 data-testid="font-panel-heading">Caption font</h2></div></div>
      {isTiered && <p className="panel-note" data-testid="tiered-font-note">This template sets its own three fonts - the picker below doesn't apply.</p>}
      <div className="font-grid" data-testid="caption-font-selector">
        {fonts.map((item) => <button key={item.id} className={fontId === item.id ? "active" : ""} disabled={isTiered} style={{ fontFamily: item.family }} onClick={() => onFont(item.id)} data-testid={`font-${item.id}-button`}>
          {item.name}
        </button>)}
      </div>
      <div className="tool-divider" />
      <div className="panel-heading compact"><Rows size={18} /><div><span>LAYOUT</span><h2 data-testid="layout-panel-heading">Caption layout</h2></div></div>
      <label className="control-label" data-testid="words-per-caption-label">Words per caption</label>
      <div className="layout-grid" data-testid="words-per-caption-selector">
        {wordsPerCaptionOptions.map((n) => <button key={n ?? "auto"} className={wordsPerCaption === n ? "active" : ""} onClick={() => onWordsPerCaption(n)} data-testid={`words-per-caption-${n ?? "auto"}-button`}>{n ?? "Auto"}</button>)}
      </div>
      <label className="control-label" data-testid="caption-lines-label">Lines</label>
      <div className="layout-grid two" data-testid="caption-lines-selector">
        <button className={captionLines === 1 ? "active" : ""} onClick={() => onCaptionLines(1)} data-testid="caption-lines-1-button">One line</button>
        <button className={captionLines === 2 ? "active" : ""} onClick={() => onCaptionLines(2)} data-testid="caption-lines-2-button">Two lines</button>
      </div>
      <label className="control-label" data-testid="caption-position-label">Position</label>
      <div className="layout-grid three" data-testid="caption-position-selector">
        {positions.map((p) => <button key={p} className={captionPosition === p ? "active" : ""} onClick={() => onCaptionPosition(p)} data-testid={`caption-position-${p}-button`}>{p[0].toUpperCase() + p.slice(1)}</button>)}
      </div>
    </>}

    {tab === "text" && <>
      <div className="panel-heading"><TextT size={18} /><div><span>SELECTED WORD</span><h2 data-testid="selected-word-heading">{selectedWord?.text || "Select a word"}</h2></div></div>
      <label className="control-label" data-testid="font-size-control-label">Font size <b data-testid="selected-word-font-size">{selectedWord?.font_size || 52}px</b></label>
      <Slider min={24} max={92} step={1} value={[selectedWord?.font_size || 52]} disabled={!selectedWord} onValueChange={([value]) => onWordStyle({ font_size: value })} data-testid="font-size-slider" />
      <label className="control-label" data-testid="word-color-control-label"><span><Palette size={16} /> Word colour</span>
        <input type="color" value={selectedWord?.color || "#FFFFFF"} disabled={!selectedWord} onChange={(e) => onWordStyle({ color: e.target.value })} data-testid="word-color-input" />
      </label>
      {isTiered ? <>
        <label className="control-label" data-testid="word-emphasis-label">Role in caption</label>
        <div className="layout-grid three" data-testid="word-emphasis-selector">
          {["support", "feature", "key"].map((tier) => <button key={tier} className={selectedWord?.emphasis === tier ? "active" : ""} disabled={!selectedWord} onClick={() => setEmphasis(tier)} data-testid={`word-emphasis-${tier}-button`}>{tier[0].toUpperCase() + tier.slice(1)}</button>)}
        </div>
      </> : <button className={`emphasis-toggle ${selectedWord?.important ? "active" : ""}`} disabled={!selectedWord} onClick={() => onWordStyle({ important: !selectedWord?.important })} data-testid="important-word-toggle">
        <span>Impact emphasis</span><i />
      </button>}
      <label className="control-label" data-testid="line-break-label">Line break before this word</label>
      <div className="layout-grid three" data-testid="line-break-selector">
        <button className={(selectedWord?.new_line ?? null) === null ? "active" : ""} disabled={!selectedWord} onClick={() => onWordStyle({ new_line: null })} data-testid="line-break-auto-button">Auto</button>
        <button className={selectedWord?.new_line === false ? "active" : ""} disabled={!selectedWord} onClick={() => onWordStyle({ new_line: false })} data-testid="line-break-merge-button">Merge up</button>
        <button className={selectedWord?.new_line === true ? "active" : ""} disabled={!selectedWord} onClick={() => onWordStyle({ new_line: true })} data-testid="line-break-split-button">Split here</button>
      </div>
    </>}
  </aside>
  );
};
