import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkSimple, ChatCircle, DotsThreeVertical, DownloadSimple, FileText, FloppyDisk, FrameCorners, Heart, Play, Share, SpinnerGap } from "@phosphor-icons/react";
import { toast } from "sonner";
import { api, API_ROOT, errorMessage } from "@/lib/api";
import { ThemePanel, templates, fonts, variants } from "@/components/ThemePanel";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { Timeline } from "@/components/Timeline";
import { LeftRail } from "@/components/LeftRail";
import { MediaPanel } from "@/components/MediaPanel";
import { AudioPanel } from "@/components/AudioPanel";
import { ElementsPanel } from "@/components/ElementsPanel";
import { TextPanel } from "@/components/TextPanel";
import { AdjustmentPanel } from "@/components/AdjustmentPanel";
import { AiToolsPanel } from "@/components/AiToolsPanel";
import { MomentPopover } from "@/components/MomentPopover";
import { playSfx } from "@/lib/sfx";

const palettes = Object.fromEntries(templates.map((item) => [item.id, [item.baseColor, item.color]]));
const accentFontById = Object.fromEntries(templates.map((item) => [item.id, item.accentFont ? `'${item.accentFont}', sans-serif` : null]));
const fontFamilyById = Object.fromEntries(fonts.map((item) => [item.id, item.family]));
const tiersById = Object.fromEntries(templates.map((item) => [item.id, item.tiers || null]));

// Mirrors backend/captions.py's _auto_line_breaks/_resolve_line_breaks: the
// automatic default (a tier change for a tiered template, the midpoint for
// a plain two-line template) with any word's explicit new_line (set by a
// manual merge/split edit) taking precedence over it.
function autoLineBreaks(groupWords, tiers, captionLines) {
  if (tiers) {
    let previousTier = null;
    return groupWords.map((word, index) => {
      const tier = tiers[word.emphasis] ? word.emphasis : "support";
      const brk = index > 0 && tier !== previousTier;
      previousTier = tier;
      return brk;
    });
  }
  if (captionLines === 2 && groupWords.length > 1) {
    const mid = Math.ceil(groupWords.length / 2);
    return groupWords.map((_, index) => index === mid);
  }
  return groupWords.map(() => false);
}

function splitIntoRows(groupWords, tiers, captionLines) {
  const auto = autoLineBreaks(groupWords, tiers, captionLines);
  const breaks = groupWords.map((word, index) => word.new_line ?? auto[index]);
  const rows = [];
  let current = [];
  groupWords.forEach((word, index) => {
    if (index > 0 && breaks[index]) {
      rows.push(current);
      current = [];
    }
    current.push(word);
  });
  if (current.length) rows.push(current);
  return rows;
}

const MIN_DISPLAY_SECONDS = 0.35;
const MAX_WORDS_PER_LINE = 3;
const MAX_GROUP_GAP = 0.4;
const SENTENCE_END_CHARS = ".!?।॥"; // includes Devanagari danda/double danda
const POSITION_DEFAULTS = { top: { x: 50, y: 14 }, middle: { x: 50, y: 50 }, bottom: { x: 50, y: 86 } };

// Per-handle resize behaviour: which sign of the mouse delta on each axis
// grows the box, and whether that axis is touched at all by this handle.
// Edge handles (tc/bc/ml/mr) touch exactly one axis; corner handles touch
// both. The box is always resized symmetrically around its own fixed
// center (same point dragging moves), so a signed per-axis delta - never
// an unsigned distance - is what keeps a drag past the center from ever
// "inverting" the box: growth only ever follows the handle's own outward
// direction, clamped at a floor instead of crossing through zero.
const RESIZE_HANDLES = {
  tl: { x: -1, y: -1 }, tc: { x: 0, y: -1 }, tr: { x: 1, y: -1 },
  ml: { x: -1, y: 0 }, mr: { x: 1, y: 0 },
  bl: { x: -1, y: 1 }, bc: { x: 0, y: 1 }, br: { x: 1, y: 1 },
};
const MIN_BOX_WIDTH_PX = 60;
const MIN_BOX_HEIGHT_PX = 30;

// Shared by the caption box and every element/sticker overlay: resize a
// rectangle from its own center using a signed, direction-aware delta
// (never an unsigned radius), clamped to a pixel floor so it can't invert.
// Returns the new size in px plus a font-scale factor derived from however
// much the touched axes actually changed (area-based, so a single-axis
// edge drag still nudges the font a sensible amount).
function resizeBox(handle, dx, dy, startWidthPx, startHeightPx) {
  const dir = RESIZE_HANDLES[handle];
  const widthTouched = dir.x !== 0;
  const heightTouched = dir.y !== 0;
  const nextWidthPx = widthTouched ? Math.max(MIN_BOX_WIDTH_PX, startWidthPx + dx * dir.x * 2) : startWidthPx;
  const nextHeightPx = heightTouched ? Math.max(MIN_BOX_HEIGHT_PX, startHeightPx + dy * dir.y * 2) : startHeightPx;
  const scale = Math.sqrt((nextWidthPx * nextHeightPx) / (startWidthPx * startHeightPx));
  return { widthTouched, heightTouched, nextWidthPx, nextHeightPx, scale };
}

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function aspectLabel(width, height) {
  const divisor = gcd(width, height) || 1;
  return `${width / divisor}:${height / divisor}`;
}

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
  const [themeTab, setThemeTab] = useState("templates");
  // Selecting a word from the Captions list or the bottom timeline should
  // land you straight on its edit controls - requiring a separate click
  // over to the right panel's Text tab every time was exactly the kind of
  // hidden-UI friction that made editing feel clunky. It should also seek
  // the video there, matching how a real script/transcript editor works -
  // clicking a line is how you navigate the footage, not just an editing
  // affordance.
  const selectWord = (index) => {
    setSelectedIndex(index);
    setThemeTab("text");
    const word = words[index];
    if (word && videoRef.current) {
      videoRef.current.currentTime = word.start;
      setCurrentTime(word.start);
    }
  };
  // "FOR THIS MOMENT": a single click on a word - from the Script Panel, the
  // Timeline, or directly on the canvas - seeks/selects it exactly as
  // before, and additionally opens the moment popover for it.
  const openMoment = (index) => {
    selectWord(index);
    setMomentPopover(index);
  };
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [relistening, setRelistening] = useState(false);
  const [mediaRetry, setMediaRetry] = useState(0);
  const [dragPreview, setDragPreview] = useState(null);
  const [resizePreview, setResizePreview] = useState(null);
  // { width, height } in % of frame, during an active caption-box drag -
  // only the axis/axes the grabbed handle actually touches are populated,
  // so an edge-only drag never silently pins the other dimension.
  const [boxSizePreview, setBoxSizePreview] = useState(null);
  const [scopePrompt, setScopePrompt] = useState(null);
  const [leftTab, setLeftTab] = useState("captions");
  const [elements, setElements] = useState(initialProject.elements || []);
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [audioVolume, setAudioVolume] = useState(initialProject.audio_volume ?? 100);
  const [audioMuted, setAudioMuted] = useState(initialProject.audio_muted ?? false);
  const [brightness, setBrightness] = useState(initialProject.brightness ?? 0);
  const [contrast, setContrast] = useState(initialProject.contrast ?? 100);
  const [saturation, setSaturation] = useState(initialProject.saturation ?? 100);
  const [renderQuality, setRenderQuality] = useState(initialProject.render_quality ?? "high");
  const [sfxMarkers, setSfxMarkers] = useState(initialProject.sfx_markers || []);
  const [momentPopover, setMomentPopover] = useState(null); // word index, or null when closed
  const [variant, setVariant] = useState(initialProject.variant || null); // null = template default
  // Dual-Script Toggle: which text shows on canvas/Timeline/exports -
  // the Romanized Hinglish word.text, or the native-script word.original
  // Sarvam's codemix transcription already produced for Hindi/mixed speech.
  const [scriptMode, setScriptMode] = useState(initialProject.script_mode || "roman");
  // Independent of theme/variant: a project-wide text-style toggle (Clean
  // soft-glow vs a bold Outlined black border+shadow) and plain Bold/Italic
  // font-weight toggles - mirrors backend/captions.py's ProjectEdit fields
  // and _write_ass's caption_style/bold/italic handling exactly.
  const [captionStyle, setCaptionStyle] = useState(initialProject.caption_style || "clean");
  const [bold, setBold] = useState(initialProject.bold ?? true);
  const [italic, setItalic] = useState(initialProject.italic ?? false);
  const [reassigning, setReassigning] = useState(false);
  const [safeZone, setSafeZone] = useState(false);
  const [frameWidth, setFrameWidth] = useState(0);
  const [frameBox, setFrameBox] = useState({ w: 360, h: 640 });
  const videoRef = useRef(null);
  const videoFrameRef = useRef(null);
  const stageRef = useRef(null);

  // The 9:16 video box should be sized to the largest rectangle that fits
  // the actual available area (not a flat vh guess, which left a lot of
  // dead black space around a too-small box on most screens) - whichever
  // dimension is the binding constraint, width or height, depends on the
  // stage's own shape, so this has to be measured rather than assumed.
  useEffect(() => {
    const node = stageRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const unit = Math.max(0, Math.min(width / 9, height / 16));
      setFrameBox({ w: Math.floor(unit * 9), h: Math.floor(unit * 16) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The <video> element's own volume tops out at 1.0 (100%) - boosting past
  // that only happens in the exported render's ffmpeg volume filter, not here.
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = Math.min(1, Math.max(0, audioVolume / 100));
    videoRef.current.muted = audioMuted;
  }, [audioVolume, audioMuted]);

  // Caption/element font sizes are defined against the 1080x1920 canvas the
  // backend bakes into the ASS script (see captions.py's PlayResX/PlayResY),
  // so the preview has to know its own on-screen pixel width to scale a
  // font_size down to a matching on-screen size - a fixed guess here was the
  // actual bug behind "caption looks fine in the editor but tiny in the
  // rendered video": the preview box's real size depends on the viewer's
  // window/screen, not a constant.
  useEffect(() => {
    const node = videoFrameRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => setFrameWidth(entries[0].contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const previewScale = frameWidth ? frameWidth / 1080 : 0.62;

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

  // Fire each SFX marker's (synthesized) tone once as playback crosses its
  // timestamp - a separate AudioContext mixed alongside the <video>'s own
  // audio, so the main video audio is never touched. lastTimeRef detects a
  // seek backward (or a loop) to let markers re-trigger on a later pass,
  // and the played set keeps a forward pass from re-firing the same one.
  const playedSfxRef = useRef(new Set());
  const lastTimeRef = useRef(0);
  useEffect(() => {
    if (currentTime < lastTimeRef.current - 0.25) playedSfxRef.current.clear();
    lastTimeRef.current = currentTime;
    if (!playing) return;
    for (const marker of sfxMarkers) {
      if (playedSfxRef.current.has(marker.id)) continue;
      if (currentTime >= marker.time && currentTime - marker.time < 0.5) {
        playedSfxRef.current.add(marker.id);
        playSfx(marker.type);
      }
    }
  }, [currentTime, playing, sfxMarkers]);

  const activeIndex = words.findIndex((word) => currentTime >= word.start && currentTime <= word.end);
  const wordGroups = useMemo(() => groupWordsForDisplay(words, wordsPerCaption), [words, wordsPerCaption]);
  // The Captions list and the Timeline's "Lines" view both show the same
  // cue grouping the live preview and the final render use, each word
  // paired with its real position in `words` (not reconstructed by identity
  // lookup) so selecting/editing a word from either place stays correct
  // even after words get deleted (e.g. by the AI tools filler cleanup).
  const indexedWordGroups = useMemo(() => {
    let position = 0;
    return wordGroups.map((group) => group.map((word) => ({ word, index: position++ })));
  }, [wordGroups]);
  const visibleWords = useMemo(() => {
    const group = wordGroups.find((candidate) =>
      currentTime >= candidate[0].start && currentTime <= candidate[candidate.length - 1].end);
    return group || [];
  }, [wordGroups, currentTime]);
  const anchorWord = visibleWords[0];
  const tiers = tiersById[theme];
  const activeVariant = variants.find((item) => item.id === variant) || null;
  const basePos = POSITION_DEFAULTS[captionPosition] || POSITION_DEFAULTS.bottom;
  const boxX = dragPreview?.x ?? anchorWord?.pos_x ?? basePos.x;
  const boxY = dragPreview?.y ?? anchorWord?.pos_y ?? basePos.y;
  const boxFontSize = resizePreview ?? anchorWord?.font_size ?? 52;
  // null means "auto" (sized to content, as before) - only set once a
  // handle that touches that axis has actually been dragged.
  const boxWidthPct = boxSizePreview?.width ?? anchorWord?.box_width ?? null;
  const boxHeightPct = boxSizePreview?.height ?? anchorWord?.box_height ?? null;

  const updateWord = (index, changes) => setWords((current) => current.map((word, i) => i === index ? { ...word, ...changes } : word));
  // Script panel popover: toggle a manual caption-line break before this word.
  const toggleWordNewLine = (index) => setWords((current) => current.map((word, i) => i === index ? { ...word, new_line: !word.new_line } : word));
  // Script panel popover: split one word into two adjacent words, time-sliced
  // proportionally to where the character split falls, inserted in place.
  const splitWord = (index, splitPos) => setWords((current) => {
    const word = current[index];
    if (!word) return current;
    const text = word.text;
    const pos = Math.min(Math.max(1, splitPos ?? Math.ceil(text.length / 2)), text.length - 1);
    const left = text.slice(0, pos).trim();
    const right = text.slice(pos).trim();
    if (!left || !right) return current;
    const mid = word.start + (word.end - word.start) * (pos / text.length);
    const wordLeft = { ...word, text: left, original: left, end: mid };
    const wordRight = { ...word, text: right, original: right, start: mid, new_line: null, box_width: null, box_height: null };
    const next = [...current.slice(0, index), wordLeft, wordRight, ...current.slice(index + 1)];
    // .index is a dense array-position id (see caption_ai.py's transcript
    // builder) that deleteWords() matches against - an insert has to
    // renumber everything after it so no two words ever share one.
    return next.map((item, i) => ({ ...item, index: i }));
  });
  // Script panel popover: set one word's emphasis tier, recoloring it the
  // same way a full theme switch would (tiered theme's tier palette, or the
  // plain important/not-important palette for a non-tiered theme).
  const setWordEmphasis = (index, emphasis) => setWords((current) => current.map((word, i) => {
    if (i !== index) return word;
    const nextTiers = tiersById[theme];
    if (nextTiers) {
      const config = nextTiers[nextTiers[emphasis] ? emphasis : "support"];
      return { ...word, emphasis, color: config.color, font_size: config.size };
    }
    const important = emphasis !== "support";
    return { ...word, emphasis, important, color: palettes[theme][important ? 1 : 0] };
  }));
  // "FOR THIS MOMENT" popover: a standalone accent highlight, independent of
  // the tiered-template emphasis above - just an on/off boolean the canvas
  // renders as a fixed accent color + scale while the word is active.
  const toggleWordEmphasize = (index) => setWords((current) => current.map((word, i) => i === index ? { ...word, emphasize: !word.emphasize } : word));
  // "FOR THIS MOMENT" popover: the kinetic animation tag the canvas plays
  // while this word is active (null/"none" pill clears it).
  const setWordKinetic = (index, kinetic) => setWords((current) => current.map((word, i) => i === index ? { ...word, kinetic } : word));
  // "FOR THIS MOMENT" popover: merge this word into its previous/next
  // neighbor - combined text and time span, the other word removed. Mirrors
  // splitWord's reindex (word.index stays a dense array-position id).
  const mergeWord = (index, direction) => setWords((current) => {
    const otherIndex = direction === "previous" ? index - 1 : index + 1;
    if (otherIndex < 0 || otherIndex >= current.length) return current;
    const lowIndex = Math.min(index, otherIndex);
    const a = current[lowIndex], b = current[lowIndex + 1];
    const merged = { ...a, text: `${a.text} ${b.text}`.trim(), original: `${a.original} ${b.original}`.trim(),
                      start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
    const next = [...current.slice(0, lowIndex), merged, ...current.slice(lowIndex + 2)];
    return next.map((item, i) => ({ ...item, index: i }));
  });
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
                           caption_lines: captionLines, caption_position: captionPosition, words,
                           audio_volume: audioVolume, audio_muted: audioMuted,
                           brightness, contrast, saturation, render_quality: renderQuality, elements,
                           sfx_markers: sfxMarkers, variant, script_mode: scriptMode,
                           caption_style: captionStyle, bold, italic });
  // Dual-Script Toggle: what a word's canvas/Timeline label actually shows -
  // falls back to the Romanized text when scriptMode is "native" but this
  // word has no native-script transcription (e.g. a user-typed edit).
  const scriptText = (word) => (scriptMode === "native" && word.original) ? word.original : word.text;

  const addSfxMarker = (type, time, wordIndex) => {
    const id = `sfx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const markerTime = Math.round((time ?? currentTime) * 100) / 100;
    setSfxMarkers((current) => [...current, { id, type, time: markerTime, word_index: wordIndex ?? null }]);
  };
  const moveSfxMarker = (id, time) => setSfxMarkers((current) => current.map((marker) => marker.id === id ? { ...marker, time } : marker));
  const deleteSfxMarker = (id) => setSfxMarkers((current) => current.filter((marker) => marker.id !== id));

  const addElement = (char, kind = "sticker") => {
    const id = `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const start = currentTime;
    const end = Math.min(project.duration, currentTime + 2);
    const fontSize = kind === "text" ? 48 : 120;
    setElements((current) => [...current, { id, kind, char, font_id: fontId, color: "#FFFFFF", font_size: fontSize, start, end, pos_x: 50, pos_y: 30, layer: "front" }]);
    setSelectedElementId(id);
  };
  const updateElement = (id, changes) => setElements((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  const deleteElement = (id) => {
    setElements((current) => current.filter((item) => item.id !== id));
    setSelectedElementId((current) => current === id ? null : current);
  };
  const deleteWords = (indices) => {
    const indexSet = new Set(indices);
    setWords((current) => current.filter((word) => !indexSet.has(word.index)));
  };
  const reassignEmphasis = async () => {
    setReassigning(true);
    try {
      const { data } = await api.post(`/projects/${project.project_id}/ai/emphasis`);
      setWords(data.words);
      toast.success("Emphasis re-tagged by AI");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setReassigning(false); }
  };
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
    // A ref, not a nested setState-inside-an-updater read, is what reliably
    // carries the drag's final position to onUp (see startResize's note).
    const liveRef = { current: null };
    const onMove = (moveEvent) => {
      const dx = ((moveEvent.clientX - startClientX) / frameRect.width) * 100;
      const dy = ((moveEvent.clientY - startClientY) / frameRect.height) * 100;
      const next = { x: Math.min(100, Math.max(0, startX + dx)), y: Math.min(100, Math.max(0, startY + dy)) };
      liveRef.current = next;
      setDragPreview(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDragPreview(null);
      if (liveRef.current) setScopePrompt({ kind: "position", x: liveRef.current.x, y: liveRef.current.y });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Direction-aware: tc/bc only touch height, ml/mr only touch width,
  // corners touch both - and every axis is clamped to a pixel floor, so
  // dragging a handle inward (even past where the opposite edge would be)
  // settles at the minimum instead of inverting/flipping the box.
  const startResize = (handle) => (e) => {
    if (!visibleWords.length) return;
    e.preventDefault(); e.stopPropagation();
    const overlayEl = e.currentTarget.closest(".caption-overlay");
    const overlayRect = overlayEl.getBoundingClientRect();
    const frameRect = videoFrameRef.current.getBoundingClientRect();
    const startWidthPx = overlayRect.width, startHeightPx = overlayRect.height;
    const startClientX = e.clientX, startClientY = e.clientY;
    const startFontSize = boxFontSize;
    // setState updater functions run on React's own schedule, not
    // synchronously at the call site - nesting a second setState inside one
    // updater to read "the value the first one just computed" is unreliable
    // (it can observe a stale/pre-drag value). A plain ref sidesteps that:
    // onMove always has the true latest numbers for onUp to read back.
    const liveRef = { current: null };
    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startClientX;
      const dy = moveEvent.clientY - startClientY;
      const { widthTouched, heightTouched, nextWidthPx, nextHeightPx, scale } =
        resizeBox(handle, dx, dy, startWidthPx, startHeightPx);
      const fontSize = Math.min(92, Math.max(24, Math.round(startFontSize * scale)));
      const size = {
        width: widthTouched ? Math.min(96, (nextWidthPx / frameRect.width) * 100) : undefined,
        height: heightTouched ? Math.min(96, (nextHeightPx / frameRect.height) * 100) : undefined,
      };
      liveRef.current = { fontSize, size };
      setResizePreview(fontSize);
      setBoxSizePreview(size);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizePreview(null);
      setBoxSizePreview(null);
      if (liveRef.current) setScopePrompt({ kind: "box", fontSize: liveRef.current.fontSize, ...liveRef.current.size });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const applyScope = (scope) => {
    if (!scopePrompt) return;
    const changes = scopePrompt.kind === "position" ? { pos_x: scopePrompt.x, pos_y: scopePrompt.y }
      : scopePrompt.kind === "box" ? {
        font_size: scopePrompt.fontSize,
        ...(scopePrompt.width !== undefined ? { box_width: scopePrompt.width } : {}),
        ...(scopePrompt.height !== undefined ? { box_height: scopePrompt.height } : {}),
      }
      : { font_size: scopePrompt.fontSize };
    if (scope === "this") {
      const indices = new Set(visibleWords.map((word) => word.index));
      setWords((current) => current.map((word) => indices.has(word.index) ? { ...word, ...changes } : word));
    } else {
      setWords((current) => current.map((word) => ({ ...word, ...changes })));
    }
    setScopePrompt(null);
  };

  // Elements are standalone stickers (not word-synced cues), so a drag or
  // resize applies straight to that one element - no "this/all" scope
  // prompt needed, unlike the shared caption box above.
  const startMoveElement = (id) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const element = elements.find((item) => item.id === id);
    if (!element) return;
    const frameRect = videoFrameRef.current.getBoundingClientRect();
    const startClientX = e.clientX, startClientY = e.clientY;
    const startX = element.pos_x, startY = element.pos_y;
    const onMove = (moveEvent) => {
      const dx = ((moveEvent.clientX - startClientX) / frameRect.width) * 100;
      const dy = ((moveEvent.clientY - startClientY) / frameRect.height) * 100;
      updateElement(id, { pos_x: Math.min(100, Math.max(0, startX + dx)), pos_y: Math.min(100, Math.max(0, startY + dy)) });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // An element is a single glyph/short text, not a wrapping box, so there's
  // no separate width/height to track - but it shares the same flip bug fix:
  // a signed delta projected onto the handle's own outward direction (never
  // an unsigned radius), clamped to a floor, so no handle can ever drive the
  // size through zero and out the other side.
  const startResizeElement = (id, handle) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const element = elements.find((item) => item.id === id);
    if (!element) return;
    const dir = RESIZE_HANDLES[handle];
    const norm = Math.hypot(dir.x, dir.y) || 1;
    const unitX = dir.x / norm, unitY = dir.y / norm;
    const startClientX = e.clientX, startClientY = e.clientY;
    const startSize = element.font_size;
    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startClientX;
      const dy = moveEvent.clientY - startClientY;
      const signedDelta = (dx * unitX + dy * unitY) * 1.6;
      updateElement(id, { font_size: Math.min(280, Math.max(20, Math.round(startSize + signedDelta))) });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <main className="studio" data-testid="caption-editor-workspace">
      <div className="studio-topbar" data-testid="project-command-bar">
        <div><button onClick={onNew} data-testid="new-project-button">← New session</button><h1 data-testid="current-project-name">{project.name}</h1></div>
        <div className="project-actions">
          {project.width && project.height && <span className="resolution-badge" data-testid="resolution-badge">{project.width}×{project.height} · {aspectLabel(project.width, project.height)}</span>}
          <select className="quality-select" value={renderQuality} onChange={(e) => setRenderQuality(e.target.value)} title="Export quality" data-testid="render-quality-select">
            <option value="high">High quality</option>
            <option value="draft">Draft (fast)</option>
          </select>
          <button className="utility-chip" onClick={save} data-testid="save-project-button"><FloppyDisk size={16} /> Save</button>
          <button className="utility-chip" onClick={downloadSrt} data-testid="download-srt-button"><FileText size={16} /> SRT</button>
          {project.status === "rendered" ? <button className="export-button" onClick={download} data-testid="download-video-button"><DownloadSimple size={19} weight="bold" /> Download MP4</button> :
            <button className="export-button" onClick={render} disabled={rendering} data-testid="render-video-button">{rendering ? <SpinnerGap className="spin" size={19} /> : <DownloadSimple size={19} weight="bold" />} {rendering ? "Exporting…" : "Export Video"}</button>}
        </div>
      </div>
      <div className="studio-grid">
        <LeftRail active={leftTab} onSelect={setLeftTab} />
        {leftTab === "captions" && <TranscriptPanel words={words} originalTranscript={project.source_transcript} transcriptionMode={project.transcription_mode} activeIndex={activeIndex} selectedIndex={selectedIndex} onSelect={openMoment} onText={(index, text) => updateWord(index, { text })} onNewLine={toggleWordNewLine} onSplitWord={splitWord} onEmphasis={setWordEmphasis} onRelisten={relisten} relistening={relistening} scriptMode={scriptMode} onScriptMode={setScriptMode} />}
        {leftTab === "media" && <MediaPanel project={project} />}
        {leftTab === "audio" && <AudioPanel volume={audioVolume} onVolume={setAudioVolume} muted={audioMuted} onMuted={setAudioMuted} />}
        {leftTab === "elements" && <ElementsPanel elements={elements.filter((item) => item.kind !== "text")} selectedId={selectedElementId} onSelect={setSelectedElementId} onAdd={(char) => addElement(char, "sticker")} onUpdate={updateElement} onDelete={deleteElement} currentTime={currentTime} duration={project.duration} />}
        {leftTab === "text" && <TextPanel elements={elements} selectedId={selectedElementId} onSelect={setSelectedElementId} onAdd={(text) => addElement(text, "text")} onUpdate={updateElement} onDelete={deleteElement} currentTime={currentTime} duration={project.duration} />}
        {leftTab === "adjustment" && <AdjustmentPanel brightness={brightness} contrast={contrast} saturation={saturation} onBrightness={setBrightness} onContrast={setContrast} onSaturation={setSaturation} onReset={() => { setBrightness(0); setContrast(100); setSaturation(100); }} />}
        {leftTab === "ai" && <AiToolsPanel words={words} onDeleteWords={deleteWords} onReassignEmphasis={reassignEmphasis} reassigning={reassigning} />}
        <section className="preview-panel" data-testid="video-preview-panel">
          <div className="video-stage" ref={stageRef}>
          <div className="video-frame" ref={videoFrameRef} style={{ width: `${frameBox.w}px`, height: `${frameBox.h}px` }}>
            <video ref={videoRef} src={`${API_ROOT}/projects/${project.project_id}/media?attempt=${mediaRetry}`} style={{ filter: `brightness(${100 + brightness}%) contrast(${contrast}%) saturate(${saturation}%)` }} onError={() => { if (mediaRetry < 1) window.setTimeout(() => setMediaRetry(1), 1200); }} onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} playsInline data-testid="caption-video-player" />
            <button className="preview-play" onClick={togglePlayback} data-testid="video-preview-play-button"><Play size={28} weight="fill" /></button>
            <button className={`preview-safe-zone-toggle ${safeZone ? "active" : ""}`} onClick={() => setSafeZone((current) => !current)} title="Toggle Reels/Shorts safe-zone guide" data-testid="safe-zone-toggle-button"><FrameCorners size={18} weight={safeZone ? "fill" : "regular"} /></button>
            {safeZone && <div className="safe-zone-overlay" data-testid="safe-zone-overlay">
              <div className="safe-zone-icons">
                <i><Heart size={20} weight="fill" /></i>
                <i><ChatCircle size={20} weight="fill" /></i>
                <i><BookmarkSimple size={20} weight="fill" /></i>
                <i><Share size={20} weight="fill" /></i>
                <i><DotsThreeVertical size={20} weight="fill" /></i>
              </div>
              <div className="safe-zone-meta" />
            </div>}
            {visibleWords.length > 0 && <div className={`caption-overlay theme-${theme} ${(captionLines === 2 || tiers) ? "lines-2" : ""}`}
              style={{ left: `${boxX}%`, top: `${boxY}%`,
                      fontWeight: bold ? 800 : 400, fontStyle: italic ? "italic" : "normal",
                      ...(boxWidthPct != null ? { width: `${boxWidthPct}%`, maxWidth: "none" } : {}),
                      ...(boxHeightPct != null ? { height: `${boxHeightPct}%`, overflow: "hidden" } : {}),
                      // "Outlined" text style: a bold black stroke + offset
                      // shadow, independent of theme/variant - a variant's
                      // own stroke/shadow design always wins when one is
                      // active, mirroring _write_ass's own priority.
                      ...(!activeVariant && captionStyle === "outlined" ? { WebkitTextStroke: "2px #000", textShadow: "2px 2px 0 #000" } : {}),
                      ...(activeVariant ? { fontFamily: activeVariant.fontFamily, textShadow: activeVariant.textShadow, WebkitTextStroke: activeVariant.stroke || undefined, "--variant-accent": activeVariant.accent } : {}) }}
              onMouseDown={startMove} data-testid="live-caption-preview">
              {splitIntoRows(visibleWords, tiers, captionLines).map((row, rowIndex) => <div className="caption-row" key={rowIndex}>
                {row.map((word) => {
                  // Color/size always come from the word itself (editable,
                  // defaulted from the theme at generation/theme-switch
                  // time) - a tiered theme only still decides the font.
                  const fontFamily = activeVariant ? activeVariant.fontFamily : tiers
                    ? tiers[tiers[word.emphasis] ? word.emphasis : "support"].font
                    : (word.important && accentFontById[theme]) || fontFamilyById[fontId];
                  const style = { color: word.color, fontSize: `${Math.max(20, (resizePreview != null ? boxFontSize : word.font_size) * previewScale)}px`, fontFamily };
                  const isActiveWord = activeIndex === word.index;
                  const className = [
                    isActiveWord ? "active" : "",
                    isActiveWord && word.kinetic ? `kinetic-${word.kinetic}` : "",
                    isActiveWord && word.emphasize ? "emphasize-accent" : "",
                  ].filter(Boolean).join(" ");
                  return <span key={word.index} className={className} style={style}
                    onClick={(e) => { e.stopPropagation(); openMoment(word.index); }}
                    data-testid={`preview-caption-word-${word.index}`}>{scriptText(word)}</span>;
                })}
              </div>)}
              <div className="selection-box">
                {["tl", "tc", "tr", "ml", "mr", "bl", "bc", "br"].map((pos) => <i key={pos} className={`resize-handle handle-${pos}`} onMouseDown={startResize(pos)} data-testid={`caption-resize-handle-${pos}`} />)}
              </div>
            </div>}
            {scopePrompt && <div className="position-scope-prompt" style={{ left: `${boxX}%`, top: `${Math.min(92, boxY + 8)}%` }} data-testid="position-scope-prompt">
              <button onClick={() => applyScope("this")} data-testid="apply-this-caption-button">This caption</button>
              <button onClick={() => applyScope("all")} data-testid="apply-all-captions-button">All captions</button>
            </div>}
            {elements.filter((item) => currentTime >= item.start && currentTime <= item.end).map((item) => {
              const interactive = leftTab === "elements" || leftTab === "text";
              return <div key={item.id} className={`element-overlay ${interactive && selectedElementId === item.id ? "selected" : ""}`}
                style={{ left: `${item.pos_x}%`, top: `${item.pos_y}%`, fontSize: `${item.font_size * previewScale}px`, color: item.color,
                        fontFamily: item.kind === "text" ? fontFamilyById[item.font_id] : undefined,
                        fontWeight: item.kind === "text" ? 700 : undefined,
                        // Behind-the-Person Text Layering: standard z-index
                        // staging relative to the caption overlay (z-index 3)
                        // - no video matting/segmentation here, so "behind"
                        // sits behind the captions, not behind an actual
                        // person in the footage (matches the backend's ASS
                        // Layer field in _write_element_dialogue).
                        zIndex: item.layer === "behind" ? 1 : 4,
                        cursor: interactive ? "grab" : "default", pointerEvents: interactive ? "auto" : "none" }}
                onMouseDown={interactive ? (e) => { setSelectedElementId(item.id); startMoveElement(item.id)(e); } : undefined}
                data-testid={`element-overlay-${item.id}`}>
                {item.char}
                {interactive && selectedElementId === item.id && <div className="selection-box">
                  {["tl", "tc", "tr", "ml", "mr", "bl", "bc", "br"].map((pos) => <i key={pos} className={`resize-handle handle-${pos}`} onMouseDown={startResizeElement(item.id, pos)} data-testid={`element-resize-handle-${pos}`} />)}
                </div>}
              </div>;
            })}
          </div>
          </div>
          <div className="preview-meta"><span data-testid="preview-format-label">9:16 PREVIEW</span><span data-testid="caption-engine-label">WORD SYNC · {theme.toUpperCase()}</span></div>
        </section>
        <ThemePanel theme={theme} onTheme={chooseTheme} fontId={fontId} onFont={setFontId}
          wordsPerCaption={wordsPerCaption} onWordsPerCaption={setWordsPerCaption}
          captionLines={captionLines} onCaptionLines={setCaptionLines}
          captionPosition={captionPosition} onCaptionPosition={setCaptionPosition}
          selectedWord={words[selectedIndex]} onWordStyle={(change) => updateWord(selectedIndex, change)}
          tab={themeTab} onTab={setThemeTab} variant={variant} onVariant={setVariant}
          captionStyle={captionStyle} onCaptionStyle={setCaptionStyle}
          bold={bold} onBold={setBold} italic={italic} onItalic={setItalic} />
      </div>
      {momentPopover != null && words[momentPopover] && <MomentPopover
        word={words[momentPopover]} index={momentPopover}
        frameRect={videoFrameRef.current?.getBoundingClientRect() ?? null}
        onClose={() => setMomentPopover(null)}
        onText={(index, text) => updateWord(index, { text })}
        onNewLine={toggleWordNewLine}
        onMerge={(index, direction) => { mergeWord(index, direction); setMomentPopover(null); }}
        onKinetic={setWordKinetic}
        onEmphasize={toggleWordEmphasize}
        onAddSfx={addSfxMarker}
        canMergePrevious={momentPopover > 0}
        canMergeNext={momentPopover < words.length - 1}
      />}
      <Timeline words={words} groups={indexedWordGroups} duration={project.duration} currentTime={currentTime} playing={playing} onToggle={togglePlayback} onSeek={seek} selectedIndex={selectedIndex} onSelect={openMoment} onRetimeWord={updateWord} mediaUrl={`${API_ROOT}/projects/${project.project_id}/media?attempt=${mediaRetry}`} sfxMarkers={sfxMarkers} onAddSfx={addSfxMarker} onMoveSfx={moveSfxMarker} onDeleteSfx={deleteSfxMarker} scriptMode={scriptMode} />
    </main>
  );
};