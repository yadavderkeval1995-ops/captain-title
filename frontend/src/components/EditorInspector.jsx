import { AlignCenterHorizontal, AlignLeft, AlignRight, TextB, TextItalic, TextUnderline } from "@phosphor-icons/react";
import { CURATED_FONTS } from "@/lib/editorCatalog";

export const EditorInspector = ({ style, customFonts, applyAll, onApplyAll, onChange }) => {
  const set = (key, value) => onChange({ [key]: value });
  return <aside className="editor-inspector" data-testid="caption-style-inspector">
    <div className="inspector-tabs"><button className="active" data-testid="inspector-text-tab">Text</button><button data-testid="inspector-effects-tab">Effects</button></div>
    <label className="scope-toggle"><span>Apply to all captions</span><input type="checkbox" checked={applyAll} onChange={(event) => onApplyAll(event.target.checked)} data-testid="apply-style-all-toggle" /></label>
    <section><h3>Fonts</h3>
      <label>Family<select value={style.fontFamily} onChange={(event) => set("fontFamily", event.target.value)} data-testid="inspector-font-family-select">
        {[...CURATED_FONTS, ...customFonts.map((font) => font.family)].filter((font, index, array) => array.indexOf(font) === index).map((font) => <option key={font}>{font}</option>)}
      </select></label>
      <div className="inspector-two"><label>Weight<select value={style.fontWeight} onChange={(event) => set("fontWeight", Number(event.target.value))} data-testid="inspector-font-weight-select">{[400,500,600,700,800,900].map((weight) => <option key={weight}>{weight}</option>)}</select></label><label>Size<input type="number" min="24" max="120" value={style.fontSize} onChange={(event) => set("fontSize", Number(event.target.value))} data-testid="inspector-font-size-input" /></label></div>
    </section>
    <section><h3>Format</h3><div className="icon-segments">
      <button className={style.fontWeight >= 700 ? "active" : ""} onClick={() => set("fontWeight", style.fontWeight >= 700 ? 500 : 800)} data-testid="inspector-bold-button"><TextB /></button>
      <button className={style.italic ? "active" : ""} onClick={() => set("italic", !style.italic)} data-testid="inspector-italic-button"><TextItalic /></button>
      <button className={style.underline ? "active" : ""} onClick={() => set("underline", !style.underline)} data-testid="inspector-underline-button"><TextUnderline /></button>
    </div><div className="icon-segments">
      <button className={style.align === "left" ? "active" : ""} onClick={() => set("align", "left")} data-testid="inspector-align-left-button"><AlignLeft /></button>
      <button className={style.align === "center" ? "active" : ""} onClick={() => set("align", "center")} data-testid="inspector-align-center-button"><AlignCenterHorizontal /></button>
      <button className={style.align === "right" ? "active" : ""} onClick={() => set("align", "right")} data-testid="inspector-align-right-button"><AlignRight /></button>
    </div></section>
    <section><h3>Position</h3><label>X <b>{style.x}%</b><input type="range" min="10" max="90" value={style.x} onChange={(event) => set("x", Number(event.target.value))} data-testid="inspector-position-x-slider" /></label><label>Y <b>{style.y}%</b><input type="range" min="15" max="92" value={style.y} onChange={(event) => set("y", Number(event.target.value))} data-testid="inspector-position-y-slider" /></label></section>
    <section><h3>Color</h3><div className="mode-segments"><button className={style.colorMode === "solid" ? "active" : ""} onClick={() => set("colorMode", "solid")} data-testid="inspector-solid-color-button">Solid</button><button className={style.colorMode === "gradient" ? "active" : ""} onClick={() => set("colorMode", "gradient")} data-testid="inspector-gradient-color-button">Gradient</button></div><div className="color-row"><label>Base<input type="color" value={style.color} onChange={(event) => set("color", event.target.value)} data-testid="inspector-base-color-input" /></label><label>Accent<input type="color" value={style.accentColor} onChange={(event) => set("accentColor", event.target.value)} data-testid="inspector-accent-color-input" /></label></div></section>
    <section><h3>Effects</h3><label>Outline <b>{style.outlineWidth}px</b><input type="range" min="0" max="10" value={style.outlineWidth} onChange={(event) => set("outlineWidth", Number(event.target.value))} data-testid="inspector-outline-slider" /></label><label>Shadow <b>{style.shadow}px</b><input type="range" min="0" max="10" value={style.shadow} onChange={(event) => set("shadow", Number(event.target.value))} data-testid="inspector-shadow-slider" /></label><label>Transition<select value={style.animation} onChange={(event) => set("animation", event.target.value)} data-testid="inspector-transition-select"><option value="pop">Pop</option><option value="fade">Fade</option><option value="rise">Rise</option><option value="punch">Punch</option><option value="draw">Draw</option></select></label></section>
  </aside>;
};