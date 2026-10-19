import { useEffect, useMemo, useRef, useState } from "react";
import { DownloadSimple, FileText, FloppyDisk, Play, SpinnerGap } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, API_ROOT, errorMessage } from "@/lib/api";
import { ThemePanel, templates, fonts } from "@/components/ThemePanel";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { Timeline } from "@/components/Timeline";

const palettes = Object.fromEntries(templates.map((item) => [item.id, [item.baseColor, item.color]]));
const accentFontById = Object.fromEntries(templates.map((item) => [item.id, item.accentFont ? `'${item.accentFont}', sans-serif` : null]));
const fontFamilyById = Object.fromEntries(fonts.map((item) => [item.id, item.family]));
const tiersById = Object.fromEntries(templates.map((item) => [item.id, item.tiers || null]));

// Mirrors backend/captions.py's _write_ass: a tiered template breaks into a
// new line whenever the support/feature/key tier changes, instead of the
// plain one/two-line split used by the simpler templates.
function splitIntoRows(groupWords, tiers, captionLines) {
  if (tiers) {
    const rows = [];
    let current = [];
    let previousTier = null;
    for (const word of groupWords) {
      const tier = tiers[word.emphasis] ? word.emphasis : "support";
      if (current.length && tier !== previousTier) {
        rows.push(current);
        current = [];
      }
      current.push(word);
      previousTier = tier;
    }
    if (current.length) rows.push(current);
    return rows;
  }
  if (captionLines === 2 && groupWords.length > 1) {
    const mid = Math.ceil(groupWords.length / 2);
    return [groupWords.slice(0, mid), groupWords.slice(mid)];
  }
  return [groupWords];
}

const MIN_DISPLAY_SECONDS = 0.35;
const MAX_WORDS_PER_LINE = 3;
const MAX_GROUP_GAP = 0.4;
const SENTENCE_END_CHARS = ".!?।॥"; // includes Devanagari danda/double danda
const POSITION_DEFAULTS = { top: { x: 50, y: 14 }, middle: { x: 50, y: 50 }, bottom: { x: 50, y: 86 } };

function endsSentence(word) {
  const original = (word.original || "").trim();
  return !!original && SENTENCE_END_CHARS.includes(original[original.length - 1]);
}

// Mirrors backend/captions.py's _group_words_for_display: fast/short
// consecutive words get shown together instead of flashing past one at a
// time faster than the player's own timeupdate resolution can catch. With an
// explicit wordsPerCaption (not "Auto"), always pack up to that many words
// instead of stopping early once MIN_DISPLAY_SECONDS is met. A sentence-
// ending word is always the last word of its group, so a caption never
// splices the tail of one sentence onto the start of the next.
function groupWordsForDisplay(words, wordsPerCaption) {
  const maxWords = wordsPerCaption || MAX_WORDS_PER_LINE;
  const strict = wordsPerCaption != null;
  const groups = [];
  let index = 0;
  while (index < words.length) {
    const group = [words[index]];
    let groupEnd = words[index].end;
    let next = index + 1;
    while (next < words.length && group.length < maxWords && !endsSentence(group[group.length - 1])
          && words[next].start - groupEnd < MAX_GROUP_GAP
          && (strict || groupEnd - words[index].start < MIN_DISPLAY_SECONDS)) {
      group.push(words[next]);
      groupEnd = words[next].end;
      next += 1;
    }
    groups.push(group);
    index = next;
  }
  return groups;
}

export const CaptionStudio = ({ initialProject, onNew }) => {
  const [project, setProject] = useState(initialProject);
  const [words, setWords] = useState(initialProject.words);
  const [theme, setTheme] = useState(initialProject.theme);
  const [fontId, setFontId] = useState(initialProject.font_id || "poppins");
  const [wordsPerCaption, setWordsPerCaption] = useState(initialProject.words_per_caption ?? null);
  const [captionLines, setCaptionLines] = useState(initialProject.caption_lines || 1);
  const [captionPosition, setCaptionPosition] = useState(initialProject.caption_position || "bottom");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [relistening, setRelistening] = useState(false);
  const [mediaRetry, setMediaRetry] = useState(0);
  const [dragPreview, setDragPreview] = useState(null);
  const [resizePreview, setResizePreview] = useState(null);
  const [scopePrompt, setScopePrompt] = useState(null);
  const videoRef = useRef(null);
  const videoFrameRef = useRef(null);

  // The video element's own timeupdate event fires at a coarse, inconsistent
  // rate (often just 4-10x/sec), which visibly lags captions behind the
  // actual audio. Poll currentTime every animation frame instead while
  // playing, for tight word-level sync.
  useEffect(() => {
    if (!playing) return undefined;
    let frameId;
    const tick = () => {
      if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playing]);

  const activeIndex = words.findIndex((word) => currentTime >= word.start && currentTime <= word.end);
  const wordGroups = useMemo(() => groupWordsForDisplay(words, wordsPerCaption), [words, wordsPerCaption]);
  const visibleWords = useMemo(() => {
    const group = wordGroups.find((candidate) =>
      currentTime >= candidate[0].start && currentTime <= candidate[candidate.length - 1].end);
    return group || [];
  }, [wordGroups, currentTime]);
  const anchorWord = visibleWords[0];
  const tiers = tiersById[theme];
  const basePos = POSITION_DEFAULTS[captionPosition] || POSITION_DEFAULTS.bottom;
  const boxX = dragPreview?.x ?? anchorWord?.pos_x ?? basePos.x;
  const boxY = dragPreview?.y ?? anchorWord?.pos_y ?? basePos.y;
  const boxFontSize = resizePreview ?? anchorWord?.font_size ?? 52;

  const updateWord = (index, changes) => setWords((current) => current.map((word, i) => i === index ? { ...word, ...changes } : word));
  const chooseTheme = (next) => {
    setTheme(next);
    const nextTiers = tiersById[next];
    if (nextTiers) {
      setWords((current) => current.map((word) => {
        const tier = nextTiers[word.emphasis] ? word.emphasis : "support";
        const config = nextTiers[tier];
        return { ...word, color: config.color, font_size: config.size };
      }));
    } else {
      setWords((current) => current.map((word) => ({ ...word, color: palettes[next][word.important ? 1 : 0] })));
    }
  };
  const payload = () => ({ theme, font_id: fontId, words_per_caption: wordsPerCaption,
                           caption_lines: captionLines, caption_position: captionPosition, words });
  const save = async () => {
    await api.put(`/projects/${project.project_id}`, payload());
    toast.success("Caption edits saved");
  };
  const render = async () => {
    setRendering(true);
    try {
      await api.put(`/projects/${project.project_id}`, payload());
      const { data } = await api.post(`/projects/${project.project_id}/render`);
      setProject({ ...project, status: "rendered", download_url: data.download_url });
      toast.success("Your captioned video is ready");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setRendering(false); }
  };
  const relisten = async () => {
    setRelistening(true);
    try {
      let data = (await api.post(`/projects/${project.project_id}/retranscribe`, { speech_language: "auto" })).data;
      while (["queued", "processing"].includes(data.status)) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
        data = (await api.get(`/projects/${project.project_id}`)).data;
      }
      if (data.status === "failed") throw new Error(data.error_message || "Re-listen failed");
      setWords(data.words);
      setProject((current) => ({ ...current, ...data }));
      setSelectedIndex(0);
      toast.success("A fresh trusted transcript is ready");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setRelistening(false); }
  };
  const download = async () => {
    const response = await api.get(`/projects/${project.project_id}/download`, { responseType: "blob" });
    const url = URL.createObjectURL(response.data); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "captain-title.mp4"; anchor.click(); URL.revokeObjectURL(url);
  };
  const downloadSrt = async () => {
    try {
      await api.put(`/projects/${project.project_id}`, payload());
      const response = await api.get(`/projects/${project.project_id}/srt`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "captain-title.srt"; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { toast.error(errorMessage(error)); }
  };
  const togglePlayback = () => videoRef.current?.paused ? videoRef.current.play() : videoRef.current.pause();
  const seek = (time) => { if (videoRef.current) { videoRef.current.currentTime = time; setCurrentTime(time); } };

  const startMove = (e) => {
    if (!visibleWords.length) return;
    e.preventDefault();
    const frameRect = videoFrameRef.current.getBoundingClientRect();
    const startClientX = e.clientX, startClientY = e.clientY;
    const startX = boxX, startY = boxY;
    const onMove = (moveEvent) => {
      const dx = ((moveEvent.clientX - startClientX) / frameRect.width) * 100;
      const dy = ((moveEvent.clientY - startClientY) / frameRect.height) * 100;
      setDragPreview({ x: Math.min(100, Math.max(0, startX + dx)), y: Math.min(100, Math.max(0, startY + dy)) });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDragPreview((current) => { if (current) setScopePrompt({ kind: "position", x: current.x, y: current.y }); return null; });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startResize = (e) => {
    if (!visibleWords.length) return;
    e.preventDefault(); e.stopPropagation();
    const startClientY = e.clientY;
    const startSize = boxFontSize;
    const onMove = (moveEvent) => {
      // The handle sits at the box's bottom-right corner, so dragging it
      // down/away (increasing clientY) should grow the text, matching the
      // familiar "stretch a window corner outward to make it bigger" feel.
      const delta = (moveEvent.clientY - startClientY) * 0.3;
      setResizePreview(Math.min(92, Math.max(24, Math.round(startSize + delta))));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizePreview((current) => { if (current != null) setScopePrompt({ kind: "size", fontSize: current }); return null; });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const applyScope = (scope) => {
    if (!scopePrompt) return;
    const changes = scopePrompt.kind === "position"
      ? { pos_x: scopePrompt.x, pos_y: scopePrompt.y }
      : { font_size: scopePrompt.fontSize };
    if (scope === "this") {
      const indices = new Set(visibleWords.map((word) => word.index));
      setWords((current) => current.map((word) => indices.has(word.index) ? { ...word, ...changes } : word));
    } else {
      setWords((current) => current.map((word) => ({ ...word, ...changes })));
    }
    setScopePrompt(null);
  };

  return (
    <main className="studio" data-testid="caption-editor-workspace">
      <div className="studio-topbar" data-testid="project-command-bar">
        <div><button onClick={onNew} data-testid="new-project-button">← New session</button><h1 data-testid="current-project-name">{project.name}</h1></div>
        <div className="project-actions">
          <Button variant="outline" onClick={save} data-testid="save-project-button"><FloppyDisk size={18} /> Save</Button>
          <Button variant="outline" onClick={downloadSrt} data-testid="download-srt-button"><FileText size={18} /> SRT</Button>
          {project.status === "rendered" ? <Button onClick={download} data-testid="download-video-button"><DownloadSimple size={19} /> Download MP4</Button> :
            <Button onClick={render} disabled={rendering} data-testid="render-video-button">{rendering ? <SpinnerGap className="spin" size={19} /> : <Play size={18} weight="fill" />} {rendering ? "Rendering…" : "Render video"}</Button>}
        </div>
      </div>
      <div className="studio-grid">
        <ThemePanel theme={theme} onTheme={chooseTheme} fontId={fontId} onFont={setFontId}
          wordsPerCaption={wordsPerCaption} onWordsPerCaption={setWordsPerCaption}
          captionLines={captionLines} onCaptionLines={setCaptionLines}
          captionPosition={captionPosition} onCaptionPosition={setCaptionPosition}
          selectedWord={words[selectedIndex]} onWordStyle={(change) => updateWord(selectedIndex, change)} />
        <section className="preview-panel" data-testid="video-preview-panel">
          <div className="video-frame" ref={videoFrameRef}>
            <video ref={videoRef} src={`${API_ROOT}/projects/${project.project_id}/media?attempt=${mediaRetry}`} onError={() => { if (mediaRetry < 1) window.setTimeout(() => setMediaRetry(1), 1200); }} onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} playsInline data-testid="caption-video-player" />
            <button className="preview-play" onClick={togglePlayback} data-testid="video-preview-play-button"><Play size={28} weight="fill" /></button>
            {visibleWords.length > 0 && <div className={`caption-overlay theme-${theme} ${(captionLines === 2 || tiers) ? "lines-2" : ""}`}
              style={{ left: `${boxX}%`, top: `${boxY}%` }} onMouseDown={startMove} data-testid="live-caption-preview">
              {splitIntoRows(visibleWords, tiers, captionLines).map((row, rowIndex) => <div className="caption-row" key={rowIndex}>
                {row.map((word) => {
                  // Color/size always come from the word itself (editable,
                  // defaulted from the theme at generation/theme-switch
                  // time) - a tiered theme only still decides the font.
                  const fontFamily = tiers
                    ? tiers[tiers[word.emphasis] ? word.emphasis : "support"].font
                    : (word.important && accentFontById[theme]) || fontFamilyById[fontId];
                  const style = { color: word.color, fontSize: `${Math.max(20, (resizePreview != null ? boxFontSize : word.font_size) * .62)}px`, fontFamily };
                  return <span key={word.index} className={activeIndex === word.index ? "active" : ""} style={style} data-testid={`preview-caption-word-${word.index}`}>{word.text}</span>;
                })}
              </div>)}
              <div className="selection-box">
                {["tl", "tc", "tr", "ml", "mr", "bl", "bc", "br"].map((pos) => <i key={pos} className={`resize-handle handle-${pos}`} onMouseDown={startResize} data-testid={`caption-resize-handle-${pos}`} />)}
              </div>
            </div>}
            {scopePrompt && <div className="position-scope-prompt" style={{ left: `${boxX}%`, top: `${Math.min(92, boxY + 8)}%` }} data-testid="position-scope-prompt">
              <button onClick={() => applyScope("this")} data-testid="apply-this-caption-button">This caption</button>
              <button onClick={() => applyScope("all")} data-testid="apply-all-captions-button">All captions</button>
            </div>}
          </div>
          <div className="preview-meta"><span data-testid="preview-format-label">9:16 PREVIEW</span><span data-testid="caption-engine-label">WORD SYNC · {theme.toUpperCase()}</span></div>
        </section>
        <TranscriptPanel words={words} originalTranscript={project.source_transcript} transcriptionMode={project.transcription_mode} activeIndex={activeIndex} selectedIndex={selectedIndex} onSelect={setSelectedIndex} onText={(index, text) => updateWord(index, { text })} onRelisten={relisten} relistening={relistening} />
      </div>
      <Timeline words={words} duration={project.duration} currentTime={currentTime} playing={playing} onToggle={togglePlayback} onSeek={seek} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
    </main>
  );
};