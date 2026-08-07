import { Trash, UploadSimple } from "@phosphor-icons/react";
import { useRef } from "react";
import { CURATED_FONTS } from "@/lib/editorCatalog";

export const FontLibrary = ({ selectedFont, customFonts, onSelect, onUpload, onDelete }) => {
  const input = useRef(null);
  return <section className="font-library" data-testid="font-library-panel">
    <div className="pro-panel-header"><div><span>LICENSED WEB FONTS</span><h2>25 font families</h2></div><button onClick={() => input.current.click()} data-testid="upload-custom-font-button"><UploadSimple size={17} /></button></div>
    <input ref={input} hidden type="file" accept=".ttf,.otf,.woff,.woff2" onChange={(event) => onUpload(event.target.files[0])} data-testid="custom-font-file-input" />
    <div className="font-grid" data-testid="curated-font-grid">
      {CURATED_FONTS.map((font, index) => <button key={font} className={selectedFont === font ? "active" : ""} style={{ fontFamily: font }} onClick={() => onSelect(font, null)} data-testid={`curated-font-${index}`}>{font}</button>)}
    </div>
    <h3>My uploaded fonts</h3>
    {customFonts.length ? customFonts.map((font, index) => <div className="custom-font-row" key={font.font_id} data-testid={`custom-font-row-${index}`}>
      <button style={{ fontFamily: font.family }} onClick={() => onSelect(font.family, font.font_id)} data-testid={`select-custom-font-${index}`}>{font.family}</button>
      <button onClick={() => onDelete(font.font_id)} title="Remove font" data-testid={`delete-custom-font-${index}`}><Trash size={15} /></button>
    </div>) : <p className="panel-empty" data-testid="custom-font-empty-state">Upload your own licensed font file.</p>}
  </section>;
};