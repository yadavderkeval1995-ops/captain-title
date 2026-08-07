import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowClockwise, DownloadSimple, FloppyDisk, Play, SpinnerGap } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, API_ROOT, errorMessage } from "@/lib/api";
import { buildCaptionGroups, CAPTION_TEMPLATES, DEFAULT_EDITOR_STYLE } from "@/lib/editorCatalog";
import { EditorToolRail } from "@/components/EditorToolRail";
import { CaptionListPanel } from "@/components/CaptionListPanel";
import { TemplateBrowser } from "@/components/TemplateBrowser";
import { FontLibrary } from "@/components/FontLibrary";
import { PresetLibrary } from "@/components/PresetLibrary";
import { EditorInspector } from "@/components/EditorInspector";
import { ProTimeline } from "@/components/ProTimeline";

const clone = (value) => JSON.parse(JSON.stringify(value));

export const CaptionStudio = ({ initialProject, onNew }) => {
  const [project, setProject] = useState(initialProject);
  const [words] = useState(initialProject.words);
  const [groups, setGroups] = useState(initialProject.caption_groups?.length ? initialProject.caption_groups : buildCaptionGroups(initialProject.words));
  const [editorStyle, setEditorStyle] = useState({ ...DEFAULT_EDITOR_STYLE, ...(initialProject.editor_style || {}) });
  const [selectedId, setSelectedId] = useState((initialProject.caption_groups?.[0] || buildCaptionGroups(initialProject.words)[0])?.id || null);
  const [activeTool, setActiveTool] = useState("captions");
  const [applyAll, setApplyAll] = useState(true);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [customFonts, setCustomFonts] = useState([]);
  const [presets, setPresets] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [saveState, setSaveState] = useState("Saved");
  const [showSafeZone, setShowSafeZone] = useState(true);
  const [mediaRetry, setMediaRetry] = useState(0);
  const videoRef = useRef(null);
  const undoStack = useRef([]); const redoStack = useRef([]); const initialSave = useRef(true);

  const selectedGroup = groups.find((group) => group.id === selectedId) || groups[0];
  const effectiveStyle = { ...editorStyle, ...(selectedGroup?.style || {}) };
  const activeGroup = groups.find((group) => currentTime >= group.start && currentTime <= group.end);

  const loadFont = useCallback(async (font) => {
    try { const face = new FontFace(font.family, `url(${API_ROOT}/editor/fonts/${font.font_id}/file)`); await face.load(); document.fonts.add(face); } catch (_) {}
  }, []);
  const refreshAssets = useCallback(async () => {
    const [fontResponse, presetResponse] = await Promise.all([api.get("/editor/fonts"), api.get("/editor/presets")]);
    setCustomFonts(fontResponse.data); setPresets(presetResponse.data);
    fontResponse.data.forEach(loadFont);
  }, [loadFont]);
  useEffect(() => { refreshAssets().catch(() => {}); }, [refreshAssets]);

  const payload = useCallback(() => ({ theme: project.theme, words, caption_groups: groups, editor_style: editorStyle }), [editorStyle, groups, project.theme, words]);
  const save = useCallback(async (silent = false) => {
    setSaveState("Saving…");
    try { await api.put(`/projects/${project.project_id}`, payload()); setSaveState("Saved"); if (!silent) toast.success("Project saved"); }
    catch (error) { setSaveState("Save failed"); if (!silent) toast.error(errorMessage(error)); }
  }, [payload, project.project_id]);
  useEffect(() => {
    if (initialSave.current) { initialSave.current = false; return; }
    setSaveState("Unsaved"); const timer = window.setTimeout(() => save(true), 1800); return () => window.clearTimeout(timer);
  }, [editorStyle, groups, save]);

  const checkpoint = useCallback(() => { undoStack.current.push({ groups: clone(groups), style: clone(editorStyle) }); if (undoStack.current.length > 40) undoStack.current.shift(); redoStack.current = []; }, [editorStyle, groups]);
  const undo = useCallback(() => { const previous = undoStack.current.pop(); if (!previous) return; redoStack.current.push({ groups: clone(groups), style: clone(editorStyle) }); setGroups(previous.groups); setEditorStyle(previous.style); }, [editorStyle, groups]);
  const redo = useCallback(() => { const next = redoStack.current.pop(); if (!next) return; undoStack.current.push({ groups: clone(groups), style: clone(editorStyle) }); setGroups(next.groups); setEditorStyle(next.style); }, [editorStyle, groups]);

  const togglePlayback = useCallback(() => videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause(), []);
  const seek = useCallback((time) => { if (videoRef.current) videoRef.current.currentTime = time; setCurrentTime(time); }, []);
  useEffect(() => {
    const keys = (event) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (event.code === "Space" && !typing) { event.preventDefault(); togglePlayback(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey && !typing) { event.preventDefault(); undo(); }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z")) && !typing) { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  }, [redo, togglePlayback, undo]);

  const updateGroup = (id, changes) => setGroups((current) => current.map((group) => group.id === id ? { ...group, ...changes } : group));
  const splitGroup = (id) => {
    const index = groups.findIndex((group) => group.id === id); const group = groups[index]; if (!group || group.word_indices.length < 2) return toast.info("This phrase cannot be split further");
    checkpoint(); const middle = Math.ceil(group.word_indices.length / 2); const leftIndices = group.word_indices.slice(0, middle); const rightIndices = group.word_indices.slice(middle);
    const tokens = group.text.trim().split(/\s+/); const tokenMiddle = Math.ceil(tokens.length / 2);
    const left = { ...group, id: `${group.id}-a-${Date.now()}`, word_indices: leftIndices, text: tokens.slice(0, tokenMiddle).join(" "), end: words[leftIndices[leftIndices.length - 1]]?.end || (group.start + group.end) / 2 };
    const right = { ...group, id: `${group.id}-b-${Date.now()}`, word_indices: rightIndices, text: tokens.slice(tokenMiddle).join(" ") || words[rightIndices[0]]?.text || "Caption", start: words[rightIndices[0]]?.start || left.end };
    const next = [...groups.slice(0, index), left, right, ...groups.slice(index + 1)]; setGroups(next); setSelectedId(left.id);
  };
  const mergeGroup = (id) => {
    const index = groups.findIndex((group) => group.id === id); if (index < 0 || index === groups.length - 1) return toast.info("Select a phrase with another phrase after it");
    checkpoint(); const first = groups[index]; const second = groups[index + 1]; const merged = { ...first, id: `${first.id}-merged-${Date.now()}`, word_indices: [...first.word_indices, ...second.word_indices], text: `${first.text} ${second.text}`.trim(), end: second.end };
    setGroups([...groups.slice(0, index), merged, ...groups.slice(index + 2)]); setSelectedId(merged.id);
  };

  const changeStyle = (changes) => { checkpoint(); if (applyAll) setEditorStyle((current) => ({ ...current, ...changes })); else updateGroup(selectedId, { style: { ...(selectedGroup?.style || {}), ...changes } }); };
  const applyTemplate = (template) => { checkpoint(); setEditorStyle({ ...template.style }); setGroups((current) => current.map((group) => ({ ...group, template_id: template.id, style: {} }))); setActiveTemplate(template.id); };
  const uploadFont = async (file) => { if (!file) return; const form = new FormData(); form.append("file", file); try { const { data } = await api.post("/editor/fonts", form, { headers: { "Content-Type": "multipart/form-data" } }); await loadFont(data); setCustomFonts((current) => [data, ...current]); changeStyle({ fontFamily: data.family, fontId: data.font_id }); toast.success("Custom font added"); } catch (error) { toast.error(errorMessage(error)); } };
  const deleteFont = async (fontId) => { await api.delete(`/editor/fonts/${fontId}`); setCustomFonts((current) => current.filter((font) => font.font_id !== fontId)); };
  const savePreset = async (name) => { const { data } = await api.post("/editor/presets", { name, style: effectiveStyle, template_id: activeTemplate }); setPresets((current) => [data, ...current]); toast.success("Preset saved"); };
  const deletePreset = async (presetId) => { await api.delete(`/editor/presets/${presetId}`); setPresets((current) => current.filter((preset) => preset.preset_id !== presetId)); };

  const render = async () => { setRendering(true); try { await save(true); const { data } = await api.post(`/projects/${project.project_id}/render`); setProject((current) => ({ ...current, status: "rendered", download_url: data.download_url })); toast.success("Captioned video ready"); } catch (error) { toast.error(errorMessage(error)); } finally { setRendering(false); } };
  const download = async () => { const response = await api.get(`/projects/${project.project_id}/download`, { responseType: "blob" }); const url = URL.createObjectURL(response.data); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "captain-title.mp4"; anchor.click(); URL.revokeObjectURL(url); };

  const renderLeftPanel = () => {
    if (activeTool === "templates") return <TemplateBrowser activeTemplate={activeTemplate} onApply={applyTemplate} />;
    if (activeTool === "fonts") return <FontLibrary selectedFont={effectiveStyle.fontFamily} customFonts={customFonts} onSelect={(fontFamily, fontId) => changeStyle({ fontFamily, fontId })} onUpload={uploadFont} onDelete={deleteFont} />;
    if (activeTool === "presets") return <PresetLibrary presets={presets} onSave={savePreset} onApply={(preset) => { checkpoint(); setEditorStyle({ ...DEFAULT_EDITOR_STYLE, ...preset.style }); setActiveTemplate(preset.template_id); }} onDelete={deletePreset} />;
    return <CaptionListPanel groups={groups} words={words} selectedId={selectedId} onSelect={setSelectedId} onText={(id, text) => updateGroup(id, { text })} onSplit={splitGroup} onMerge={mergeGroup} />;
  };

  const previewStyle = { ...editorStyle, ...(activeGroup?.style || {}) };
  const phraseTokens = activeGroup?.text?.split(/\s+/) || [];
  return <main className={`pro-editor tool-${activeTool}`} data-testid="pro-caption-editor">
    <div className="pro-editor-topbar"><div><button onClick={onNew} data-testid="pro-editor-new-session-button">← Projects</button><h1 data-testid="pro-editor-project-name">{project.name}</h1></div><div className="pro-command-actions"><span data-testid="project-save-state">{saveState}</span><button onClick={undo} title="Undo" data-testid="undo-editor-button"><ArrowCounterClockwise /></button><button onClick={redo} title="Redo" data-testid="redo-editor-button"><ArrowClockwise /></button><Button variant="outline" onClick={() => save(false)} data-testid="pro-save-button"><FloppyDisk /> Save</Button>{project.status === "rendered" ? <Button onClick={download} data-testid="pro-download-button"><DownloadSimple /> Download</Button> : <Button onClick={render} disabled={rendering} data-testid="pro-render-button">{rendering ? <SpinnerGap className="spin" /> : <Play weight="fill" />} {rendering ? "Rendering" : "Render video"}</Button>}</div></div>
    <div className="pro-editor-workspace">
      <EditorToolRail active={activeTool} onChange={setActiveTool} />
      <div className={`pro-left-panel tool-${activeTool}`}>{renderLeftPanel()}</div>
      <section className="pro-preview" data-testid="pro-video-preview"><div className="preview-toolbar"><span>9:16</span><button className={showSafeZone ? "active" : ""} onClick={() => setShowSafeZone((current) => !current)} data-testid="safe-zone-toggle">Safe zone</button></div><div className="pro-video-shell">
        <video ref={videoRef} src={`${API_ROOT}/projects/${project.project_id}/media?attempt=${mediaRetry}`} onError={() => { if (mediaRetry < 1) setMediaRetry(1); }} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} playsInline data-testid="pro-caption-video" />
        {showSafeZone && <div className="safe-zone" data-testid="video-safe-zone-guide" />}
        {activeGroup && <div key={activeGroup.id} className={`pro-caption-preview animation-${previewStyle.animation}`} style={{ left: `${previewStyle.x}%`, top: `${previewStyle.y}%`, width: `${previewStyle.width ?? 82}%`, maxWidth: "96%", transform: `translate(-50%, -50%) scale(${(previewStyle.scaleX ?? 100) / 100}, ${(previewStyle.scaleY ?? 100) / 100})`, transformOrigin: "center", whiteSpace: "normal", overflowWrap: "normal", wordBreak: "keep-all", textAlign: previewStyle.align, fontFamily: previewStyle.fontFamily, fontWeight: previewStyle.fontWeight, fontSize: `${Math.max(18, previewStyle.fontSize * .56)}px`, fontStyle: previewStyle.italic ? "italic" : "normal", textDecoration: previewStyle.underline ? "underline" : "none", letterSpacing: `${previewStyle.letterSpacing}px`, textTransform: previewStyle.uppercase ? "uppercase" : "none", WebkitTextStroke: `${previewStyle.outlineWidth * .45}px ${previewStyle.outlineColor}`, textShadow: `${previewStyle.shadow}px ${previewStyle.shadow}px ${previewStyle.shadow * 2}px #000`, background: previewStyle.backgroundColor }} data-testid="phrase-caption-preview">
          {phraseTokens.map((token, index) => { const sourceWord = words[activeGroup.word_indices[index]]; const tokenStyle = sourceWord?.important ? { color: previewStyle.accentColor } : previewStyle.colorMode === "gradient" ? { background: `linear-gradient(90deg, ${previewStyle.color}, ${previewStyle.accentColor})`, WebkitBackgroundClip: "text", color: "transparent" } : { color: previewStyle.color }; return <span key={`${token}-${index}`} style={tokenStyle}>{token}{index < phraseTokens.length - 1 ? " " : ""}</span>; })}
        </div>}
        <button className="pro-preview-play" onClick={togglePlayback} data-testid="pro-preview-play-button">{playing ? "Pause" : "Play"}</button>
      </div></section>
      <EditorInspector style={effectiveStyle} customFonts={customFonts} applyAll={applyAll} onApplyAll={setApplyAll} onChange={changeStyle} />
    </div>
    <ProTimeline groups={groups} waveform={project.waveform} duration={project.duration} currentTime={currentTime} playing={playing} selectedId={selectedId} onSelect={setSelectedId} onSeek={seek} onToggle={togglePlayback} onUpdateGroup={updateGroup} onCheckpoint={checkpoint} onSplit={splitGroup} onMerge={mergeGroup} />
  </main>;
};