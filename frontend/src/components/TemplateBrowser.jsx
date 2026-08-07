import { MagnifyingGlass, Sparkle } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { CAPTION_TEMPLATES } from "@/lib/editorCatalog";

export const TemplateBrowser = ({ activeTemplate, onApply }) => {
  const [query, setQuery] = useState("");
  const templates = useMemo(() => CAPTION_TEMPLATES.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase())), [query]);
  return <section className="template-browser" data-testid="caption-template-browser">
    <div className="pro-panel-header"><div><span>20 BUILT-IN STYLES</span><h2>Templates</h2></div><Sparkle size={18} /></div>
    <label className="template-search"><MagnifyingGlass size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a template" data-testid="template-search-input" /></label>
    <div className="template-card-list">
      {templates.map((template) => <button key={template.id} className={`template-card ${activeTemplate === template.id ? "active" : ""}`} onClick={() => onApply(template)} data-testid={`caption-template-${template.id}`}>
        <span>{template.name}<small>{template.category}</small></span>
        <div style={{ fontFamily: template.style.fontFamily, color: template.style.color, background: template.style.backgroundColor, textTransform: template.style.uppercase ? "uppercase" : "none", WebkitTextStroke: `${Math.min(2, template.style.outlineWidth)}px ${template.style.outlineColor}` }}>{template.sample}</div>
      </button>)}
    </div>
  </section>;
};