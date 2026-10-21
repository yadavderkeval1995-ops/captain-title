import { Palette, Rows, Sparkle, SquaresFour, TextT } from "@phosphor-icons/react";
import { Slider } from "@/components/ui/slider";

const wordsPerCaptionOptions = [null, 1, 2, 3, 4, 5, 6, 8];
const positions = ["top", "middle", "bottom"];
const tabs = [
  { id: "templates", label: "Templates", icon: SquaresFour },
  { id: "customize", label: "Customize", icon: Rows },
  { id: "text", label: "Text", icon: TextT },
];

// `card.*` is purely for the Templates grid preview below - it never feeds
// the actual render pipeline (that's baseColor/color/accentFont/tiers,
// mirrored exactly from backend/captions.py's THEMES), it just has to look
// like a faithful small-scale sample of what that combination produces.
export const templates = [
  { id: "viral", name: "Viral", baseColor: "#FFFFFF", color: "#FF3B30", accentFont: "Anton",
    card: { stroke: "1.5px #000", shadow: "0 3px 0 #000", glow: null, highlight: false } },
  { id: "cinematic", name: "Cinematic", baseColor: "#FFF7DB", color: "#FFB800", accentFont: "Caveat",
    card: { stroke: null, shadow: "0 2px 10px rgba(0,0,0,.6)", glow: "0 0 14px rgba(255,184,0,.65)", highlight: false } },
  { id: "minimal", name: "Minimal", baseColor: "#FFFFFF", color: "#007AFF", accentFont: null,
    card: { stroke: null, shadow: "0 1px 3px rgba(0,0,0,.5)", glow: null, highlight: false } },
  { id: "podcast", name: "Podcast", baseColor: "#FFFFFF", color: "#A855F7", accentFont: null,
    card: { stroke: null, shadow: "0 2px 8px rgba(0,0,0,.55)", glow: "0 0 10px rgba(168,85,247,.5)", highlight: false } },
  { id: "meme_mix", name: "Meme Mix", baseColor: "#FFFFFF", color: "#FFEB3B", accentFont: "Permanent Marker",
    card: { stroke: "1.5px #000", shadow: "0 3px 0 #000", glow: null, highlight: true } },
  { id: "street_pop", name: "Street Pop", baseColor: "#FFFFFF", color: "#FF6EC7", accentFont: "Caveat",
    card: { stroke: "1px #fff", shadow: "0 2px 8px rgba(0,0,0,.6)", glow: "0 0 12px rgba(255,110,199,.55)", highlight: false } },
  // Designer "tiered" templates: a 3-way support/feature/key reading of each
  // word instead of a flat important/normal split, each tier with its own
  // font/color/size - mirrors backend/captions.py's THEMES tiers exactly.
  { id: "editorial_pop", name: "Editorial Pop", color: "#FFEB3B", tiers: {
    support: { font: "'Poppins', sans-serif", color: "#FFFFFF", size: 40 },
    feature: { font: "'Playfair Display', serif", color: "#FFFFFF", size: 58 },
    key: { font: "'Anton', sans-serif", color: "#FFEB3B", size: 82 },
  }, card: { stroke: null, shadow: "0 2px 6px rgba(0,0,0,.6)", glow: null, highlight: true } },
  { id: "clean_vogue", name: "Clean Vogue", color: "#FF8FC7", tiers: {
    support: { font: "'Poppins', sans-serif", color: "#E4E4E7", size: 38 },
    feature: { font: "'Playfair Display', serif", color: "#FF8FC7", size: 56 },
    key: { font: "'Bebas Neue', sans-serif", color: "#FFFFFF", size: 86 },
  }, card: { stroke: null, shadow: "0 2px 6px rgba(0,0,0,.6)", glow: "0 0 10px rgba(255,143,199,.5)", highlight: false } },
  { id: "street_heat", name: "Street Heat", color: "#FF4D00", tiers: {
    support: { font: "'Poppins', sans-serif", color: "#FFFFFF", size: 40 },
    feature: { font: "'Permanent Marker', cursive", color: "#FFFFFF", size: 54 },
    key: { font: "'Anton', sans-serif", color: "#FF4D00", size: 84 },
  }, card: { stroke: "1px #000", shadow: "0 3px 0 #000", glow: "0 0 12px rgba(255,77,0,.55)", highlight: true } },
];

// Two or three sample words rendered at card scale, reusing each template's
// real font/color choices - a flat template contrasts its base vs accent
// word exactly like `word.important` does; a tiered one walks its tiers.
function previewWords(template) {
  if (template.tiers) {
    const order = ["support", "feature", "key"].filter((tier) => template.tiers[tier]);
    return order.map((tier) => {
      const config = template.tiers[tier];
      return { text: tier === "key" ? "HOOK" : tier, font: config.font, color: config.color, size: Math.min(26, Math.max(12, Math.round(config.size * 0.32))), weight: tier === "support" ? 600 : 800 };
    });
  }
  const accentFont = template.accentFont ? `'${template.accentFont}', sans-serif` : "'Poppins', sans-serif";
  return [
    { text: "the", font: "'Poppins', sans-serif", color: template.baseColor, size: 15, weight: 600 },
    { text: "HOOK", font: accentFont, color: template.color, size: 25, weight: 700 },
  ];
}

// Template style variants (Captik's "VARIANTS" row) - a render-only layer
// on top of whichever template is selected: font family, text stroke/
// shadow, and the accent color used for active/emphasized words. Applied
// as CSS on the caption overlay itself, never by touching word data, so
// switching variants can never lose a word's own text/splits/position edits.
export const variants = [
  { id: "rock", label: "Rock", fontFamily: "'Anton', sans-serif", textShadow: "3px 3px 0 #000, -2px -2px 0 #000", stroke: "2px #000", accent: "#FF4D00" },
  { id: "glow", label: "Glow", fontFamily: "'Outfit', sans-serif", textShadow: "0 0 20px currentColor, 0 0 8px currentColor", stroke: null, accent: "#22d3ee" },
  { id: "swiss", label: "Swiss", fontFamily: "'IBM Plex Sans', sans-serif", textShadow: "none", stroke: null, accent: "#007AFF" },
  { id: "clean", label: "Clean", fontFamily: "'Poppins', sans-serif", textShadow: "0 2px 6px rgba(0,0,0,.55)", stroke: null, accent: "#EAB308" },
];

export const fonts = [
  { id: "poppins", name: "Poppins", family: "'Poppins', sans-serif" },
  { id: "anton", name: "Anton", family: "'Anton', sans-serif" },
  { id: "bebas", name: "Bebas Neue", family: "'Bebas Neue', sans-serif" },
  { id: "classic", name: "Classic", family: "'DejaVu Sans', sans-serif" },
];

export const ThemePanel = ({ theme, onTheme, fontId, onFont, wordsPerCaption, onWordsPerCaption,
                             captionLines, onCaptionLines, captionPosition, onCaptionPosition,
                             selectedWord, onWordStyle, tab, onTab, variant, onVariant,
                             captionStyle, onCaptionStyle, bold, onBold, italic, onItalic }) => {
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
      <div className="template-grid" data-testid="caption-theme-selector">
        {templates.map((item) => {
          const words = previewWords(item);
          return (
          <button key={item.id} className={theme === item.id ? "active" : ""} onClick={() => onTheme(item.id)} data-testid={`theme-${item.id}-button`}>
            <span className="template-card-preview">
              {words.map((word, index) => <span key={index} className="template-card-word"
                style={{
                  fontFamily: word.font, color: word.color, fontSize: `${word.size}px`, fontWeight: word.weight,
                  WebkitTextStroke: item.card.stroke || undefined,
                  textShadow: [item.card.shadow, item.card.glow].filter(Boolean).join(", ") || undefined,
                  background: item.card.highlight && index === words.length - 1 ? "rgba(255,255,255,.12)" : undefined,
                  padding: item.card.highlight && index === words.length - 1 ? "1px 5px" : undefined,
                  borderRadius: item.card.highlight && index === words.length - 1 ? "3px" : undefined,
                }}>{word.text}</span>)}
            </span>
            <span className="template-card-name">{item.name}</span>
          </button>
          );
        })}
      </div>
      <div className="tool-divider" />
      <label className="control-label" data-testid="variant-selector-label"><span>Variants</span></label>
      <div className="variant-pills" data-testid="variant-selector">
        {variants.map((item) => <button key={item.id} className={variant === item.id ? "active" : ""} onClick={() => onVariant(variant === item.id ? null : item.id)}
          style={{ fontFamily: item.fontFamily, color: item.accent }} data-testid={`variant-${item.id}-button`}>{item.label}</button>)}
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
      <label className="control-label" data-testid="font-weight-style-label">Weight &amp; style</label>
      <div className="layout-grid two" data-testid="font-weight-style-selector">
        <button className={bold ? "active" : ""} onClick={() => onBold(!bold)} data-testid="bold-toggle-button" style={{ fontWeight: 800 }}>Bold</button>
        <button className={italic ? "active" : ""} onClick={() => onItalic(!italic)} data-testid="italic-toggle-button" style={{ fontStyle: "italic" }}>Italic</button>
      </div>
      <label className="control-label" data-testid="caption-style-label">Text style</label>
      <div className="layout-grid two" data-testid="caption-style-selector">
        <button className={captionStyle === "clean" ? "active" : ""} onClick={() => onCaptionStyle("clean")} data-testid="caption-style-clean-button">Clean</button>
        <button className={captionStyle === "outlined" ? "active" : ""} onClick={() => onCaptionStyle("outlined")} data-testid="caption-style-outlined-button">Outlined</button>
      </div>
      <p className="panel-note" data-testid="caption-style-note">{captionStyle === "outlined"
        ? "A bold black outline and shadow around every caption."
        : "A soft glow, no hard border - the default look."}
        {variant && " A selected Variant's own outline always takes priority over this."}</p>
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
