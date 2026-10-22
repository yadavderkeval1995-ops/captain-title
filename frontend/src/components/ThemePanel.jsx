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

// Exactly two fixed, fully-designed "motion graphic" templates - not a
// skinnable N-theme system any more. Each owns its complete look AND its
// own bespoke motion, mirrored exactly from backend/captions.py's THEMES
// (street_glow's line1/line2, doodle_marker's tiers) so the editor preview
// and the export always agree. Rendering for both lives directly in
// CaptionStudio.jsx (street_glow's two independently-animated lines,
// doodle_marker's pill/pencil-loop decorations) rather than through the
// old generic `card`-driven template-grid preview + tiers lookup - these
// are bespoke designs, not a data-driven skin.
export const templates = [
  { id: "street_glow", name: "Street Glow" },
  { id: "doodle_marker", name: "Doodle Marker", tiers: {
    support: { font: "'Caveat', cursive", color: "#FFFFFF", size: 56 },
    feature: { font: "'Caveat', cursive", color: "#FFFFFF", size: 56 },
    key: { font: "'Caveat', cursive", color: "#111111", size: 56 },
  } },
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
                             selectedWord, onWordStyle, tab, onTab,
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
        <button className={theme === "street_glow" ? "active" : ""} onClick={() => onTheme("street_glow")} data-testid="theme-street_glow-button">
          <span className="template-card-preview">
            <span className="template-card-word" style={{ fontFamily: "'Anton', sans-serif", color: "#FF2E2E", fontSize: "19px", fontWeight: 700, textShadow: "0 0 7px rgba(255,46,46,.95), 0 0 14px rgba(255,46,46,.6)" }}>STAY</span>
            <span className="template-card-word" style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic", fontWeight: 600, color: "#FFFFFF", fontSize: "15px", marginTop: "-3px" }}>hungry</span>
          </span>
          <span className="template-card-name">Street Glow</span>
        </button>
        <button className={theme === "doodle_marker" ? "active" : ""} onClick={() => onTheme("doodle_marker")} data-testid="theme-doodle_marker-button">
          <span className="template-card-preview">
            <span className="template-card-word" style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, color: "#FFFFFF", fontSize: "18px" }}>this</span>
            <span className="template-card-word" style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, color: "#111111", fontSize: "18px", background: "#FACC15", padding: "0 6px", borderRadius: "255px 15px 225px 15px/15px 225px 15px 255px" }}>changes</span>
          </span>
          <span className="template-card-name">Doodle Marker</span>
        </button>
      </div>
    </>}

    {tab === "customize" && <>
      {theme === "street_glow" ? <>
        <div className="panel-heading"><TextT size={18} /><div><span>STYLE ENGINE</span><h2 data-testid="font-panel-heading">Fixed design</h2></div></div>
        <p className="panel-note" data-testid="street-glow-fixed-note">Street Glow is a complete, fixed design - its fonts, colours, and glow/shadow are built into the template, not configurable here.</p>
      </> : <>
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
        </>}
      </>}
      <div className="tool-divider" />
      <div className="panel-heading compact"><Rows size={18} /><div><span>LAYOUT</span><h2 data-testid="layout-panel-heading">Caption layout</h2></div></div>
      <label className="control-label" data-testid="words-per-caption-label">Words per caption</label>
      <div className="layout-grid" data-testid="words-per-caption-selector">
        {wordsPerCaptionOptions.map((n) => <button key={n ?? "auto"} className={wordsPerCaption === n ? "active" : ""} onClick={() => onWordsPerCaption(n)} data-testid={`words-per-caption-${n ?? "auto"}-button`}>{n ?? "Auto"}</button>)}
      </div>
      <label className="control-label" data-testid="caption-lines-label">Lines</label>
      {(isTiered || theme === "street_glow") && <p className="panel-note" data-testid="tiered-lines-note">{theme === "street_glow" ? "Street Glow is always a fixed two-line headline/subline - the picker below doesn't apply." : "This template breaks lines at each tier change, not a fixed line count - the picker below doesn't apply."}</p>}
      <div className="layout-grid two" data-testid="caption-lines-selector">
        <button className={captionLines === 1 ? "active" : ""} disabled={isTiered || theme === "street_glow"} onClick={() => onCaptionLines(1)} data-testid="caption-lines-1-button">One line</button>
        <button className={captionLines === 2 ? "active" : ""} disabled={isTiered || theme === "street_glow"} onClick={() => onCaptionLines(2)} data-testid="caption-lines-2-button">Two lines</button>
      </div>
      <label className="control-label" data-testid="caption-position-label">Position</label>
      <div className="layout-grid three" data-testid="caption-position-selector">
        {positions.map((p) => <button key={p} className={captionPosition === p ? "active" : ""} onClick={() => onCaptionPosition(p)} data-testid={`caption-position-${p}-button`}>{p[0].toUpperCase() + p.slice(1)}</button>)}
      </div>
    </>}

    {tab === "text" && <>
      <div className="panel-heading"><TextT size={18} /><div><span>SELECTED WORD</span><h2 data-testid="selected-word-heading">{selectedWord?.text || "Select a word"}</h2></div></div>
      {theme === "street_glow" && <p className="panel-note" data-testid="street-glow-word-note">Street Glow's size and colour come from which line a word is on (set below), not per word.</p>}
      <label className="control-label" data-testid="font-size-control-label">Font size <b data-testid="selected-word-font-size">{selectedWord?.font_size || 52}px</b></label>
      <Slider min={16} max={120} step={1} value={[selectedWord?.font_size || 52]} disabled={!selectedWord || theme === "street_glow"} onValueChange={([value]) => onWordStyle({ font_size: value })} data-testid="font-size-slider" />
      <label className="control-label" data-testid="word-color-control-label"><span><Palette size={16} /> Word colour</span>
        <input type="color" value={selectedWord?.color || "#FFFFFF"} disabled={!selectedWord || theme === "street_glow"} onChange={(e) => onWordStyle({ color: e.target.value })} data-testid="word-color-input" />
      </label>
      {isTiered && <>
        <label className="control-label" data-testid="word-emphasis-label">Role in caption</label>
        <div className="layout-grid three" data-testid="word-emphasis-selector">
          {["support", "feature", "key"].map((tier) => <button key={tier} className={selectedWord?.emphasis === tier ? "active" : ""} disabled={!selectedWord} onClick={() => setEmphasis(tier)} data-testid={`word-emphasis-${tier}-button`}>{tier[0].toUpperCase() + tier.slice(1)}</button>)}
        </div>
      </>}
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
