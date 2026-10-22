import { ArrowsOutCardinal, Palette, Rows, Sparkle, SquaresFour, TextT } from "@phosphor-icons/react";
import { Slider } from "@/components/ui/slider";

const wordsPerCaptionOptions = [null, 1, 2, 3, 4, 5, 6, 8];
const positions = ["top", "middle", "bottom"];
const tabs = [
  { id: "templates", label: "Templates", icon: SquaresFour },
  { id: "customize", label: "Customize", icon: Rows },
  { id: "text", label: "Text", icon: TextT },
  { id: "transform", label: "Transform", icon: ArrowsOutCardinal },
];
// Quick Position Y presets inside the Transform tab - the same percentages
// POSITION_DEFAULTS (CaptionStudio.jsx) and _group_center (captions.py) use
// for the Top/Middle/Bottom layout preset buttons, so a preset here lands
// exactly where that preset would.
const TRANSFORM_Y_PRESETS = [{ label: "Top", y: 14 }, { label: "Middle", y: 50 }, { label: "Bottom", y: 80 }];

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
  // "Hormozi style": the single most common pattern across today's top
  // caption apps (Kapwing/CapCut) - plain bold white text, punchline word
  // in bright yellow, in an even heavier font.
  { id: "bold_impact", name: "Bold Impact", baseColor: "#FFFFFF", color: "#FFD60A", accentFont: "Archivo Black",
    card: { stroke: "1px #000", shadow: "0 2px 0 #000", glow: null, highlight: false } },
  { id: "tech_editorial", name: "Tech Editorial", baseColor: "#E4E4E7", color: "#5EEAD4", accentFont: "Space Grotesk",
    card: { stroke: null, shadow: "0 2px 8px rgba(0,0,0,.55)", glow: "0 0 10px rgba(94,234,212,.5)", highlight: false } },
  // Hindi-first tiered templates - same layered design as the three above,
  // built entirely on fonts with real Devanagari coverage (see backend/
  // captions.py's DEVANAGARI_CAPABLE_FONTS) so a Hindi creator gets the
  // same designed look switching to Native Script, not a fallback font.
  { id: "hindi_bold", name: "Hindi Bold", color: "#FFD60A", tiers: {
    support: { font: "'Hind', sans-serif", color: "#FFFFFF", size: 40 },
    feature: { font: "'Mukta', sans-serif", color: "#FFFFFF", size: 58 },
    key: { font: "'Baloo 2', sans-serif", color: "#FFD60A", size: 84 },
  }, card: { stroke: null, shadow: "0 2px 6px rgba(0,0,0,.6)", glow: null, highlight: true } },
  { id: "hindi_editorial", name: "Hindi Editorial", color: "#FFB800", tiers: {
    support: { font: "'Hind', sans-serif", color: "#E4E4E7", size: 38 },
    feature: { font: "'Tiro Devanagari Hindi', serif", color: "#FFFFFF", size: 56 },
    key: { font: "'Rozha One', serif", color: "#FFB800", size: 82 },
  }, card: { stroke: null, shadow: "0 2px 10px rgba(0,0,0,.6)", glow: "0 0 14px rgba(255,184,0,.5)", highlight: false } },
  { id: "hindi_street", name: "Hindi Street", color: "#FF4D9E", tiers: {
    support: { font: "'Mukta', sans-serif", color: "#FFFFFF", size: 40 },
    feature: { font: "'Yatra One', cursive", color: "#FFFFFF", size: 54 },
    key: { font: "'Baloo 2', sans-serif", color: "#FF4D9E", size: 84 },
  }, card: { stroke: "1px #000", shadow: "0 3px 0 #000", glow: "0 0 12px rgba(255,77,158,.5)", highlight: true } },
  { id: "hindi_minimal", name: "Hindi Minimal", color: "#38BDF8", tiers: {
    support: { font: "'Hind', sans-serif", color: "#E4E4E7", size: 38 },
    feature: { font: "'Mukta', sans-serif", color: "#FFFFFF", size: 54 },
    key: { font: "'Noto Sans Devanagari', sans-serif", color: "#38BDF8", size: 78 },
  }, card: { stroke: null, shadow: "0 1px 4px rgba(0,0,0,.5)", glow: "0 0 8px rgba(56,189,248,.4)", highlight: false } },
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
  { id: "archivo", name: "Archivo Black", family: "'Archivo Black', sans-serif" },
  { id: "space_grotesk", name: "Space Grotesk", family: "'Space Grotesk', sans-serif" },
  { id: "baloo2", name: "Baloo 2", family: "'Baloo 2', sans-serif" },
  { id: "hind", name: "Hind", family: "'Hind', sans-serif" },
  { id: "mukta", name: "Mukta", family: "'Mukta', sans-serif" },
  { id: "kalam", name: "Kalam", family: "'Kalam', cursive" },
];

export const ThemePanel = ({ theme, onTheme, fontId, onFont, wordsPerCaption, onWordsPerCaption,
                             captionLines, onCaptionLines, captionPosition, onCaptionPosition,
                             selectedWord, onWordStyle, tab, onTab, variant, onVariant,
                             textStyle, onTextStyle, bold, onBold, italic, onItalic,
                             hasActiveCaption, boxX, boxY, boxFontSize, boxRotation,
                             onCaptionPos, onCaptionScale, onCaptionRotation,
                             onApplyTransformToAll, onResetTransform }) => {
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
        <Icon size={14} /> {label}
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
      <label className="control-label" data-testid="background-toggle-label">Background box</label>
      <div className="layout-grid two" data-testid="background-toggle-selector">
        <button className={!textStyle.background_enabled ? "active" : ""} onClick={() => onTextStyle({ background_enabled: false })} data-testid="background-off-button">Off</button>
        <button className={textStyle.background_enabled ? "active" : ""} onClick={() => onTextStyle({ background_enabled: true })} data-testid="background-on-button">On</button>
      </div>
      {textStyle.background_enabled ? <>
        <label className="control-label" data-testid="background-color-label"><span><Palette size={16} /> Box colour</span>
          <input type="color" value={textStyle.background_color} onChange={(e) => onTextStyle({ background_color: e.target.value })} data-testid="background-color-input" />
        </label>
        <label className="control-label" data-testid="background-opacity-label">Box opacity <b>{Math.round(textStyle.background_opacity * 100)}%</b></label>
        <Slider min={0.1} max={1} step={0.05} value={[textStyle.background_opacity]} onValueChange={([v]) => onTextStyle({ background_opacity: v })} data-testid="background-opacity-slider" />
        <p className="panel-note" data-testid="background-note">A solid box behind each caption line. Outline, Shadow and Glow turn off while a Background is on - an ASS export can't combine both.</p>
      </> : <>
        <label className="control-label" data-testid="outline-toggle-label">Outline</label>
        <div className="layout-grid two" data-testid="outline-toggle-selector">
          <button className={!textStyle.outline_enabled ? "active" : ""} onClick={() => onTextStyle({ outline_enabled: false })} data-testid="outline-off-button">Off</button>
          <button className={textStyle.outline_enabled ? "active" : ""} onClick={() => onTextStyle({ outline_enabled: true })} data-testid="outline-on-button">On</button>
        </div>
        {textStyle.outline_enabled && <>
          <label className="control-label" data-testid="outline-width-label">Outline width <b>{textStyle.outline_width}px</b></label>
          <Slider min={0.5} max={8} step={0.5} value={[textStyle.outline_width]} onValueChange={([v]) => onTextStyle({ outline_width: v })} data-testid="outline-width-slider" />
          <label className="control-label" data-testid="outline-color-label"><span><Palette size={16} /> Outline colour</span>
            <input type="color" value={textStyle.outline_color} onChange={(e) => onTextStyle({ outline_color: e.target.value })} data-testid="outline-color-input" />
          </label>
        </>}
        <label className="control-label" data-testid="shadow-toggle-label">Shadow</label>
        <div className="layout-grid two" data-testid="shadow-toggle-selector">
          <button className={!textStyle.shadow_enabled ? "active" : ""} onClick={() => onTextStyle({ shadow_enabled: false })} data-testid="shadow-off-button">Off</button>
          <button className={textStyle.shadow_enabled ? "active" : ""} onClick={() => onTextStyle({ shadow_enabled: true })} data-testid="shadow-on-button">On</button>
        </div>
        {textStyle.shadow_enabled && <>
          <label className="control-label" data-testid="shadow-angle-label">Direction <b>{textStyle.shadow_angle}°</b></label>
          <Slider min={0} max={360} step={15} value={[textStyle.shadow_angle]} onValueChange={([v]) => onTextStyle({ shadow_angle: v })} data-testid="shadow-angle-slider" />
          <label className="control-label" data-testid="shadow-distance-label">Distance <b>{textStyle.shadow_distance}px</b></label>
          <Slider min={0} max={15} step={1} value={[textStyle.shadow_distance]} onValueChange={([v]) => onTextStyle({ shadow_distance: v })} data-testid="shadow-distance-slider" />
          <label className="control-label" data-testid="shadow-blur-label">Smoothness <b>{textStyle.shadow_blur}</b></label>
          <Slider min={0} max={15} step={1} value={[textStyle.shadow_blur]} onValueChange={([v]) => onTextStyle({ shadow_blur: v })} data-testid="shadow-blur-slider" />
          <label className="control-label" data-testid="shadow-opacity-label">Opacity <b>{Math.round(textStyle.shadow_opacity * 100)}%</b></label>
          <Slider min={0.1} max={1} step={0.05} value={[textStyle.shadow_opacity]} onValueChange={([v]) => onTextStyle({ shadow_opacity: v })} data-testid="shadow-opacity-slider" />
          <label className="control-label" data-testid="shadow-color-label"><span><Palette size={16} /> Shadow colour</span>
            <input type="color" value={textStyle.shadow_color} onChange={(e) => onTextStyle({ shadow_color: e.target.value })} data-testid="shadow-color-input" />
          </label>
        </>}
        <label className="control-label" data-testid="glow-toggle-label">Glow</label>
        <div className="layout-grid two" data-testid="glow-toggle-selector">
          <button className={!textStyle.glow_enabled ? "active" : ""} onClick={() => onTextStyle({ glow_enabled: false })} data-testid="glow-off-button">Off</button>
          <button className={textStyle.glow_enabled ? "active" : ""} onClick={() => onTextStyle({ glow_enabled: true })} data-testid="glow-on-button">On</button>
        </div>
        {textStyle.glow_enabled && <>
          <label className="control-label" data-testid="glow-blur-label">Intensity <b>{textStyle.glow_blur}</b></label>
          <Slider min={0} max={24} step={1} value={[textStyle.glow_blur]} onValueChange={([v]) => onTextStyle({ glow_blur: v })} data-testid="glow-blur-slider" />
          <label className="control-label" data-testid="glow-opacity-label">Opacity <b>{Math.round(textStyle.glow_opacity * 100)}%</b></label>
          <Slider min={0.1} max={1} step={0.05} value={[textStyle.glow_opacity]} onValueChange={([v]) => onTextStyle({ glow_opacity: v })} data-testid="glow-opacity-slider" />
          <label className="control-label" data-testid="glow-color-mode-label">Glow colour</label>
          <div className="layout-grid two" data-testid="glow-color-mode-selector">
            <button className={textStyle.glow_color === null ? "active" : ""} onClick={() => onTextStyle({ glow_color: null })} data-testid="glow-color-auto-button">Word's own</button>
            <button className={textStyle.glow_color !== null ? "active" : ""} onClick={() => onTextStyle({ glow_color: textStyle.glow_color || "#FFD400" })} data-testid="glow-color-custom-button">Custom</button>
          </div>
          {textStyle.glow_color !== null && <label className="control-label" data-testid="glow-color-label"><span><Palette size={16} /> Glow colour</span>
            <input type="color" value={textStyle.glow_color} onChange={(e) => onTextStyle({ glow_color: e.target.value })} data-testid="glow-color-input" />
          </label>}
        </>}
        {variant && <p className="panel-note" data-testid="caption-style-note">A selected Variant's own outline/shadow always takes priority over these.</p>}
      </>}
      <div className="tool-divider" />
      <div className="panel-heading compact"><Rows size={18} /><div><span>LAYOUT</span><h2 data-testid="layout-panel-heading">Caption layout</h2></div></div>
      <label className="control-label" data-testid="words-per-caption-label">Words per caption</label>
      <div className="layout-grid" data-testid="words-per-caption-selector">
        {wordsPerCaptionOptions.map((n) => <button key={n ?? "auto"} className={wordsPerCaption === n ? "active" : ""} onClick={() => onWordsPerCaption(n)} data-testid={`words-per-caption-${n ?? "auto"}-button`}>{n ?? "Auto"}</button>)}
      </div>
      <label className="control-label" data-testid="caption-lines-label">Lines</label>
      {isTiered && <p className="panel-note" data-testid="tiered-lines-note">This template breaks lines at each tier change, not a fixed line count - the picker below doesn't apply.</p>}
      <div className="layout-grid two" data-testid="caption-lines-selector">
        <button className={captionLines === 1 ? "active" : ""} disabled={isTiered} onClick={() => onCaptionLines(1)} data-testid="caption-lines-1-button">One line</button>
        <button className={captionLines === 2 ? "active" : ""} disabled={isTiered} onClick={() => onCaptionLines(2)} data-testid="caption-lines-2-button">Two lines</button>
      </div>
      <label className="control-label" data-testid="caption-position-label">Position</label>
      <div className="layout-grid three" data-testid="caption-position-selector">
        {positions.map((p) => <button key={p} className={captionPosition === p ? "active" : ""} onClick={() => onCaptionPosition(p)} data-testid={`caption-position-${p}-button`}>{p[0].toUpperCase() + p.slice(1)}</button>)}
      </div>
    </>}

    {tab === "text" && <>
      <div className="panel-heading"><TextT size={18} /><div><span>SELECTED WORD</span><h2 data-testid="selected-word-heading">{selectedWord?.text || "Select a word"}</h2></div></div>
      <label className="control-label" data-testid="font-size-control-label">Font size <b data-testid="selected-word-font-size">{selectedWord?.font_size || 52}px</b></label>
      <Slider min={16} max={120} step={1} value={[selectedWord?.font_size || 52]} disabled={!selectedWord} onValueChange={([value]) => onWordStyle({ font_size: value })} data-testid="font-size-slider" />
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
      <label className="control-label" data-testid="caption-break-label">Caption split before this word</label>
      <div className="layout-grid three" data-testid="caption-break-selector">
        <button className={(selectedWord?.new_caption ?? null) === null ? "active" : ""} disabled={!selectedWord} onClick={() => onWordStyle({ new_caption: null })} data-testid="caption-break-auto-button">Auto</button>
        <button className={selectedWord?.new_caption === false ? "active" : ""} disabled={!selectedWord} onClick={() => onWordStyle({ new_caption: false })} data-testid="caption-break-merge-button">Merge up</button>
        <button className={selectedWord?.new_caption === true ? "active" : ""} disabled={!selectedWord} onClick={() => onWordStyle({ new_caption: true })} data-testid="caption-break-split-button">Split here</button>
      </div>
      <p className="panel-note" data-testid="caption-break-note">A caption split starts a whole new caption box (own position/size/timing) here - a line break above only wraps text within the same box.</p>
    </>}

    {tab === "transform" && <>
      <div className="panel-heading"><ArrowsOutCardinal size={18} /><div><span>THIS CAPTION</span><h2 data-testid="transform-panel-heading">Transform &amp; style</h2></div></div>
      {!hasActiveCaption && <p className="panel-note" data-testid="transform-no-caption-note">Play or scrub to a caption to transform it.</p>}
      <label className="control-label" data-testid="transform-scale-label">Scale / size <b data-testid="transform-scale-value">{Math.round(boxFontSize)}px</b></label>
      <Slider min={16} max={120} step={1} value={[boxFontSize]} disabled={!hasActiveCaption} onValueChange={([value]) => onCaptionScale(value)} data-testid="transform-scale-slider" />

      <label className="control-label" data-testid="transform-pos-y-label">Position Y <b data-testid="transform-pos-y-value">{Math.round(boxY)}%</b></label>
      <Slider min={5} max={95} step={1} value={[boxY]} disabled={!hasActiveCaption} onValueChange={([value]) => onCaptionPos({ y: value })} data-testid="transform-pos-y-slider" />
      <div className="layout-grid three" data-testid="transform-pos-y-presets">
        {TRANSFORM_Y_PRESETS.map(({ label, y }) => <button key={label} disabled={!hasActiveCaption} onClick={() => onCaptionPos({ y })} data-testid={`transform-pos-y-preset-${label.toLowerCase()}-button`}>{label}</button>)}
      </div>

      <label className="control-label" data-testid="transform-pos-x-label">Position X <b data-testid="transform-pos-x-value">{Math.round(boxX)}%</b></label>
      <Slider min={0} max={100} step={1} value={[boxX]} disabled={!hasActiveCaption} onValueChange={([value]) => onCaptionPos({ x: value })} data-testid="transform-pos-x-slider" />

      <label className="control-label" data-testid="transform-rotation-label">Rotation <b data-testid="transform-rotation-value">{Math.round(boxRotation)}&deg;</b></label>
      <Slider min={-45} max={45} step={1} value={[boxRotation]} disabled={!hasActiveCaption} onValueChange={([value]) => onCaptionRotation(value)} data-testid="transform-rotation-slider" />

      <div className="tool-divider" />
      <div className="layout-grid two" data-testid="transform-actions">
        <button disabled={!hasActiveCaption} onClick={onApplyTransformToAll} data-testid="transform-apply-all-button">Apply to All Captions</button>
        <button disabled={!hasActiveCaption} onClick={onResetTransform} data-testid="transform-reset-button">Reset to Default</button>
      </div>
    </>}
  </aside>
  );
};
