import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
const POSITION_DEFAULTS = { top: { x: 50, y: 14 }, middle: { x: 50, y: 50 }, bottom: { x: 50, y: 80 } };
// Fixed CSS line-height for stacked caption rows - calibrated (not guessed)
// against the export's own native `\N` line spacing in libass: rendered the
// same multi-row caption at several font-size pairs through both engines and
// solved for the multiplier that makes the browser's line-box leading match
// libass's native \N gap at every size tested (~1.46-1.50 across very
// different pairs, e.g. 38/56 and 30/70) - not a per-caption editable
// value, since nothing on the export side reads a line-height multiplier
// any more (libass's \N spacing is native, not computed) and an editable
// preview-only number would just drift back out of sync with it.
const NATIVE_LINE_HEIGHT = 1.47;

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
// Mirrors backend/captions.py's BOLD_CAPABLE_FONTS: only Poppins and Caveat
// are bundled with a real separate bold weight file for export - every
// other font is a single bundled weight (often already Bold/ExtraBold/Black
// by name). Requesting font-weight:800 on one of those makes the BROWSER
// synthesize a bolder face the same way libass/fontconfig would for the
// export, which looks different from either's take on a genuine bold face -
// and different from each other, which is exactly the preview/export
// mismatch this avoids by simply never asking for synthetic bold anywhere.
function isBoldCapableFont(family) {
  return family.includes("Poppins") || family.includes("Caveat");
}

function hexToRgba(hex, opacity) {
  const value = (hex || "#000000").replace("#", "");
  const r = parseInt(value.slice(0, 2), 16) || 0;
  const g = parseInt(value.slice(2, 4), 16) || 0;
  const b = parseInt(value.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${opacity})`;
}

// Mirrors backend/captions.py's _shadow_offset exactly: clockwise degrees
// from straight down (0=down, 90=left, 180=up, 270=right), same sign
// convention since CSS's y-axis also increases downward.
function shadowOffset(angleDeg, distance) {
  const radians = (angleDeg * Math.PI) / 180;
  return [distance * Math.sin(radians), distance * Math.cos(radians)];
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
//
// A word's own new_caption overrides all of that: true always starts a new
// group right at that word (a manual "Split" edit, from the moment popover
// or the Timeline's Split at Playhead button); false always keeps it in the
// previous group (a manual "Merge up" edit) even past maxWords/the gap/a
// sentence end - same tri-state pattern new_line already uses one level
// down, for caption boundaries instead of line wraps.
function groupWordsForDisplay(words, wordsPerCaption) {
  const maxWords = wordsPerCaption || MAX_WORDS_PER_LINE;
  const strict = wordsPerCaption != null;
  const groups = [];
  let index = 0;
  while (index < words.length) {
    const group = [words[index]];
    let groupEnd = words[index].end;
    let next = index + 1;
    while (next < words.length) {
      const nextWord = words[next];
      const forcedSplit = nextWord.new_caption === true;
      const forcedMerge = nextWord.new_caption === false;
      if (forcedSplit) break;
      if (!forcedMerge && !(group.length < maxWords && !endsSentence(group[group.length - 1])
            && nextWord.start - groupEnd < MAX_GROUP_GAP
            && (strict || groupEnd - words[index].start < MIN_DISPLAY_SECONDS))) break;
      group.push(nextWord);
      groupEnd = nextWord.end;
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
  // before, and additionally opens the moment popover for it. anchorEl, when
  // given, is the clicked chip/span itself - the popover opens right next
  // to IT instead of always next to the video frame, so clicking a word in
  // the far-left Script Panel doesn't pop the card open across the screen
  // next to the canvas.
  const openMoment = (index, anchorEl) => {
    selectWord(index);
    setMomentPopover(index);
    setMomentAnchor(anchorEl ? anchorEl.getBoundingClientRect() : null);
  };
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [relistening, setRelistening] = useState(false);
  const [mediaRetry, setMediaRetry] = useState(0);
  const [leftTab, setLeftTab] = useState("captions");
  // Shown right after a direct drag/resize on the canvas box releases -
  // the move/resize has ALREADY been committed to this caption by then
  // (no preview/commit split needed any more), so this is purely an
  // optional one-tap shortcut to also broadcast it to every caption,
  // not a gate gating anything. Dismissing it (Escape/outside click/
  // "This caption") just closes it - there's nothing to revert.
  const [scopePrompt, setScopePrompt] = useState(false);
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
  const [momentAnchor, setMomentAnchor] = useState(null); // clicked chip/span's DOMRect, or null to anchor by the video frame
  const [variant, setVariant] = useState(initialProject.variant || null); // null = template default
  // Dual-Script Toggle: which text shows on canvas/Timeline/exports -
  // the Romanized Hinglish word.text, or the native-script word.original
  // Sarvam's codemix transcription already produced for Hindi/mixed speech.
  const [scriptMode, setScriptMode] = useState(initialProject.script_mode || "roman");
  // Independent of theme/variant: granular project-wide Outline/Shadow/
  // Background controls, plus plain Bold/Italic font-weight toggles -
  // mirrors backend/captions.py's ProjectEdit fields and _write_ass's
  // two-layer outline+shadow/background-box handling exactly (field names
  // match 1:1 so the payload can spread this object straight through).
  const [textStyle, setTextStyle] = useState({
    outline_enabled: initialProject.outline_enabled ?? false,
    outline_width: initialProject.outline_width ?? 2,
    outline_color: initialProject.outline_color || "#000000",
    shadow_enabled: initialProject.shadow_enabled ?? true,
    shadow_angle: initialProject.shadow_angle ?? 0,
    shadow_distance: initialProject.shadow_distance ?? 2,
    shadow_blur: initialProject.shadow_blur ?? 2,
    shadow_opacity: initialProject.shadow_opacity ?? 0.5,
    shadow_color: initialProject.shadow_color || "#000000",
    glow_enabled: initialProject.glow_enabled ?? false,
    glow_color: initialProject.glow_color ?? null,
    glow_blur: initialProject.glow_blur ?? 8,
    glow_opacity: initialProject.glow_opacity ?? 0.6,
    background_enabled: initialProject.background_enabled ?? false,
    background_color: initialProject.background_color || "#000000",
    background_opacity: initialProject.background_opacity ?? 0.6,
  });
  const updateTextStyle = (change) => setTextStyle((current) => ({ ...current, ...change }));
  const [bold, setBold] = useState(initialProject.bold ?? true);
  const [italic, setItalic] = useState(initialProject.italic ?? false);
  const [reassigning, setReassigning] = useState(false);
  const [safeZone, setSafeZone] = useState(false);
  const [frameWidth, setFrameWidth] = useState(0);
  const [frameBox, setFrameBox] = useState({ w: 360, h: 640 });
  const videoRef = useRef(null);
  const videoFrameRef = useRef(null);
  const stageRef = useRef(null);
  // Set true mid-drag by startCaptionDrag once the cursor has actually
  // moved - read (and reset) by a word span's onClick to swallow the
  // spurious click a drag-release fires on whatever word happens to still
  // be under the cursor (the caption box follows the mouse, so that's
  // always the word you started dragging from).
  const dragMovedRef = useRef(false);

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
  // Mirrors _write_ass's own two-layer approach: a real browser already
  // blurs text-shadow independently of the glyph fill (unlike libass's
  // single \blur tag), so the preview doesn't need the backend's two-
  // Dialogue-line trick - one WebkitTextStroke (crisp) + one text-shadow
  // (independently blurred) gets the same crisp-text-plus-soft-shadow look
  // in a single CSS declaration.
  const [shadowOffsetX, shadowOffsetY] = shadowOffset(textStyle.shadow_angle, textStyle.shadow_distance);
  const outlineStroke = textStyle.outline_enabled && !textStyle.background_enabled
    ? `${Math.max(0.5, textStyle.outline_width * previewScale)}px ${textStyle.outline_color}` : "0px transparent";
  const dropShadow = textStyle.shadow_enabled && !textStyle.background_enabled
    ? `${(shadowOffsetX * previewScale).toFixed(2)}px ${(shadowOffsetY * previewScale).toFixed(2)}px ${(textStyle.shadow_blur * previewScale).toFixed(2)}px ${hexToRgba(textStyle.shadow_color, textStyle.shadow_opacity)}`
    : "none";
  // The "active word" pop (the word currently being spoken, scaled up
  // briefly) used to carry its own hardcoded text-shadow - a fixed black
  // shadow plus a "0 0 16px currentColor" neon glow - completely ignoring
  // whatever Outline/Shadow the project actually has configured, including
  // when Shadow is off or Background is on. _write_ass's own pop animation
  // (POP_BLUR_BOOST=3 in captions.py) instead just briefly blurs the SAME
  // configured shadow a little more - this mirrors that exactly, so the
  // moment a word is "active" doesn't visually diverge from the rest of
  // the caption's own styling, in preview or export.
  const dropShadowActive = textStyle.shadow_enabled && !textStyle.background_enabled
    ? `${(shadowOffsetX * previewScale).toFixed(2)}px ${(shadowOffsetY * previewScale).toFixed(2)}px ${((textStyle.shadow_blur + 3) * previewScale).toFixed(2)}px ${hexToRgba(textStyle.shadow_color, textStyle.shadow_opacity)}`
    : "none";
  // Glow is a non-directional (0,0-offset) soft light, independent of
  // Shadow - mirrors _write_ass's own separate glow Dialogue layer.
  // glow_color=null means "use this word's own colour" (a self-coloured
  // neon look, same convention variants' outline=null already uses) - that
  // has to be resolved PER WORD (different words can have different
  // colours), so unlike dropShadow/dropShadowActive this can't be computed
  // once for the whole overlay.
  const glowShadowFor = (word, active) => {
    if (!textStyle.glow_enabled || textStyle.background_enabled) return null;
    const blur = (active ? textStyle.glow_blur + 3 : textStyle.glow_blur) * previewScale;
    // "Use this word's own colour" has to track the colour actually ON
    // SCREEN, not just word.color - the "FOR THIS MOMENT" Emphasize accent
    // (App.css's .emphasize-accent, !important-overriding the fill colour
    // while this word is active) would otherwise leave the glow showing the
    // word's base colour while the text itself has visibly swapped to the
    // accent colour. Mirrors _write_ass's own word_tags, which resolves the
    // same emphasize override before computing its glow_fill.
    const displayColor = (active && word.emphasize) ? (activeVariant?.accent || "#EAB308") : word.color;
    return `0px 0px ${blur.toFixed(2)}px ${hexToRgba(textStyle.glow_color || displayColor, textStyle.glow_opacity)}`;
  };
  const basePos = POSITION_DEFAULTS[captionPosition] || POSITION_DEFAULTS.bottom;
  const boxX = anchorWord?.pos_x ?? basePos.x;
  const boxY = anchorWord?.pos_y ?? basePos.y;
  const boxFontSize = anchorWord?.font_size ?? 66;
  const boxRotation = anchorWord?.rotation ?? 0;

  const updateWord = (index, changes) => setWords((current) => current.map((word, i) => i === index ? { ...word, ...changes } : word));
  // Script panel popover: toggle a manual caption-line break before this word.
  const toggleWordNewLine = (index) => setWords((current) => current.map((word, i) => i === index ? { ...word, new_line: !word.new_line } : word));
  // "Split Caption"/Split at Playhead: force a brand-new caption group to
  // start right at this word (Segment A = everything before it, keeping its
  // own end time; Segment B = this word onward) - same "before this word"
  // convention new_line already uses one level up, just for the caption
  // boundary groupWordsForDisplay computes instead of a line wrap within one.
  const splitCaptionBeforeWord = (index) => setWords((current) => current.map((word, i) => i === index ? { ...word, new_caption: true } : word));
  // "Merge Up": force this word to join the PREVIOUS caption group even past
  // whatever auto-grouping heuristic (word count/gap/sentence-end) would
  // otherwise break here - the inverse of splitCaptionBeforeWord, and the
  // way to merge segment S with S+1: call this on S+1's own first word.
  const mergeCaptionUp = (index) => setWords((current) => current.map((word, i) => i === index ? { ...word, new_caption: false } : word));
  // Timeline's dedicated "Split at Playhead" button: splits the caption
  // currently on screen into two, right at whichever word is playing under
  // the scrubber - a no-op (and disabled) if the playhead is already sitting
  // on the first word of its group, since there'd be nothing to split off.
  const canSplitAtPlayhead = activeIndex >= 0 && anchorWord && anchorWord.index !== activeIndex;
  const splitAtPlayhead = () => { if (canSplitAtPlayhead) splitCaptionBeforeWord(activeIndex); };
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
                           ...textStyle, bold, italic });
  // Dual-Script Toggle: what a word's canvas/Timeline label actually shows -
  // falls back to the Romanized text when scriptMode is "native" but this
  // word has no native-script transcription (e.g. a user-typed edit).
  const scriptText = (word) => (scriptMode === "native" && word.original) ? word.original : word.text;
  // Top/Middle/Bottom preset buttons: also clears every word's own manual
  // pos_x/pos_y, since a per-word drag-and-drop position otherwise always
  // takes priority over the preset (same rule the export's _group_center
  // uses) - without this, clicking a preset after ever having dragged a
  // caption anywhere had no visible effect at all.
  const choosePosition = (position) => {
    setCaptionPosition(position);
    setWords((current) => current.map((word) => ({ ...word, pos_x: null, pos_y: null })));
  };

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
      // Longer than the backend's own render timeout (captions.py's
      // RENDER_TIMEOUT_SECONDS) so the server's own timeout error always
      // surfaces first - without this, a stalled request had no client-side
      // bound at all and "Exporting..." could spin forever.
      const { data } = await api.post(`/projects/${project.project_id}/render`, null, { timeout: 330000 });
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

  // The Transform & Style panel replaces the old drag-to-move/drag-to-resize
  // canvas handles (which kept flickering/snapping back) with direct sliders.
  // Every setter below writes straight into `words` for the CURRENTLY VISIBLE
  // caption (visibleWords, the group on screen at the current playhead
  // position) - no drag preview/commit dance needed, since a slider's value
  // IS the committed value the instant it changes.
  const transformThisCaption = (changes) => {
    if (!visibleWords.length) return;
    const indices = new Set(visibleWords.map((word) => word.index));
    setWords((current) => current.map((word) => indices.has(word.index) ? { ...word, ...changes } : word));
  };
  const setCaptionPos = ({ x, y }) => transformThisCaption({ pos_x: x ?? boxX, pos_y: y ?? boxY });
  // Scaling (not flattening) every word's own font_size by the ratio between
  // the new and old anchor size keeps a tiered template's relative word
  // sizes intact instead of forcing every word in the caption to one size.
  const setCaptionScale = (size) => {
    const ratio = size / (boxFontSize || 1);
    if (!visibleWords.length) return;
    const indices = new Set(visibleWords.map((word) => word.index));
    setWords((current) => current.map((word) => indices.has(word.index)
      ? { ...word, font_size: Math.min(120, Math.max(16, Math.round(word.font_size * ratio))) } : word));
  };
  const setCaptionRotation = (deg) => transformThisCaption({ rotation: deg });
  // Direct drag-to-move on the caption box itself, alongside the Transform
  // panel's Position sliders - commits straight to this caption's pos_x/
  // pos_y on every move (no separate preview/commit step or this/all scope
  // popup needed, since "Apply to All Captions" is its own explicit button
  // in the Transform panel now).
  const startCaptionDrag = (e) => {
    if (!visibleWords.length) return;
    e.preventDefault();
    const frameRect = videoFrameRef.current.getBoundingClientRect();
    const startClientX = e.clientX, startClientY = e.clientY;
    const startX = boxX, startY = boxY;
    const indices = new Set(visibleWords.map((word) => word.index));
    dragMovedRef.current = false;
    const onMove = (moveEvent) => {
      if (Math.abs(moveEvent.clientX - startClientX) > 3 || Math.abs(moveEvent.clientY - startClientY) > 3) {
        // The box visually follows the cursor as it's dragged, so the word
        // span under the pointer at mousedown is still under it at mouseup
        // - the browser fires a native click on it same as any other click.
        // Flagging a real drag here lets the word's onClick below swallow
        // that one spurious click instead of popping its "FOR THIS MOMENT"
        // card open right on top of the position you just dragged to.
        dragMovedRef.current = true;
      }
      const dx = ((moveEvent.clientX - startClientX) / frameRect.width) * 100;
      const dy = ((moveEvent.clientY - startClientY) / frameRect.height) * 100;
      const nextX = Math.min(100, Math.max(0, startX + dx));
      const nextY = Math.min(95, Math.max(5, startY + dy));
      setWords((current) => current.map((word) => indices.has(word.index) ? { ...word, pos_x: nextX, pos_y: nextY } : word));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (dragMovedRef.current) setScopePrompt(true);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  // Direction-aware resize handles around the caption box - tc/bc only
  // touch height, ml/mr only touch width, corners touch both. Resizing
  // scales this caption's font_size (same field + same clamp the Transform
  // panel's own Scale slider writes to - setCaptionScale), not a separate
  // box-dimension field, so the two controls always agree on what "size"
  // means for a caption.
  const startResize = (handle) => (e) => {
    if (!visibleWords.length) return;
    e.preventDefault(); e.stopPropagation();
    const overlayEl = e.currentTarget.closest(".caption-overlay");
    const overlayRect = overlayEl.getBoundingClientRect();
    const startWidthPx = overlayRect.width, startHeightPx = overlayRect.height;
    const startClientX = e.clientX, startClientY = e.clientY;
    const startFontSize = boxFontSize;
    const dir = RESIZE_HANDLES[handle];
    let moved = false;
    const onMove = (moveEvent) => {
      moved = true;
      const dx = moveEvent.clientX - startClientX;
      const dy = moveEvent.clientY - startClientY;
      const widthTouched = dir.x !== 0, heightTouched = dir.y !== 0;
      const nextWidthPx = widthTouched ? Math.max(40, startWidthPx + dx * dir.x * 2) : startWidthPx;
      const nextHeightPx = heightTouched ? Math.max(20, startHeightPx + dy * dir.y * 2) : startHeightPx;
      const scale = Math.sqrt((nextWidthPx * nextHeightPx) / (startWidthPx * startHeightPx));
      setCaptionScale(Math.round(startFontSize * scale));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (moved) setScopePrompt(true);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  // Broadcasts THIS caption's current position/rotation/size to every
  // caption in the project - same "every word, uniformly" semantics the
  // old resize-handle's "All captions" scope button already used for
  // font_size, just extended to the new Transform panel fields too.
  const applyTransformToAll = () => {
    const changes = { pos_x: boxX, pos_y: boxY, rotation: boxRotation || null, font_size: boxFontSize };
    setWords((current) => current.map((word) => ({ ...word, ...changes })));
  };
  const resetTransform = () => {
    if (!visibleWords.length) return;
    const indices = new Set(visibleWords.map((word) => word.index));
    setWords((current) => current.map((word) => indices.has(word.index)
      ? { ...word, pos_x: null, pos_y: null, rotation: null, box_width: null, box_height: null,
          font_size: word.important ? 76 : 66 }
      : word));
  };
  // Escape or a click outside the prompt/box just dismisses it - the
  // drag/resize it followed already committed to this caption, so there's
  // nothing to revert, only the optional "also broadcast" offer to close.
  useEffect(() => {
    if (!scopePrompt) return undefined;
    const onKeyDown = (e) => { if (e.key === "Escape") setScopePrompt(false); };
    const onMouseDown = (e) => {
      if (!e.target.closest(".position-scope-prompt") && !e.target.closest(".caption-overlay")) setScopePrompt(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("mousedown", onMouseDown); };
  }, [scopePrompt]);

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
                      transform: `translate(-50%,-50%) rotate(${boxRotation}deg)`, lineHeight: NATIVE_LINE_HEIGHT,
                      fontStyle: italic ? "italic" : "normal",
                      // Granular Outline/Shadow/Background, independent of
                      // theme/variant - a variant's own stroke/shadow design
                      // always wins when one is active, mirroring
                      // _write_ass's own priority. WebkitTextStroke and
                      // textShadow are always set explicitly here (never
                      // left to App.css's own default rule) so every
                      // combination - including both off - renders exactly
                      // what the controls say, matching the export 1:1.
                      ...(!activeVariant ? { WebkitTextStroke: outlineStroke, textShadow: dropShadow } : {}),
                      ...(activeVariant ? { fontFamily: activeVariant.fontFamily, textShadow: activeVariant.textShadow, WebkitTextStroke: activeVariant.stroke || undefined, "--variant-accent": activeVariant.accent } : {}) }}
              onMouseDown={startCaptionDrag} data-testid="live-caption-preview">
              {/* Plain text flow with a literal line break between rows -
                  no per-row wrapper <div> with hand-computed margins. A
                  browser lays out stacked lines of text using each line's
                  own natural metrics (its line-height against its own
                  tallest inline content), exactly the way libass stacks
                  \N-separated lines in the export - two different custom
                  height formulas approximating that (one in JS, one in
                  Python) were exactly what drifted apart. Letting the
                  browser do what it already does natively is what actually
                  keeps this matching the export, not a closer-but-still-
                  custom approximation of it. */}
              {splitIntoRows(visibleWords, tiers, captionLines).map((row, rowIndex) => <Fragment key={rowIndex}>
                {rowIndex > 0 && <br />}
                {/* BorderStyle=3's opaque box in libass draws around each
                    \N-separated VISUAL LINE on its own, not one box around
                    the whole multi-line Dialogue - so the background box
                    lives on a per-row wrapper (a sibling of the <br/>
                    above, not nesting it) rather than the whole overlay,
                    matching that line-by-line behaviour exactly instead of
                    a single box the export never actually draws. */}
                <span style={!activeVariant && textStyle.background_enabled
                  ? { backgroundColor: hexToRgba(textStyle.background_color, textStyle.background_opacity),
                      padding: "2px 10px", borderRadius: "3px", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }
                  : undefined}>
                {row.map((word, wordIndex) => {
                  // Color/size always come from the word itself (editable,
                  // defaulted from the theme at generation/theme-switch
                  // time) - a tiered theme only still decides the font.
                  const fontFamily = activeVariant ? activeVariant.fontFamily : tiers
                    ? tiers[tiers[word.emphasis] ? word.emphasis : "support"].font
                    : (word.important && accentFontById[theme]) || fontFamilyById[fontId];
                  const isActiveWord = activeIndex === word.index;
                  // Glow can be a different colour per word (glow_color=null
                  // means "use this word's own colour"), so it's combined
                  // into an explicit per-word textShadow rather than left to
                  // inherit from the overlay - Shadow's own entry comes along
                  // for the ride so the two combine into one CSS value
                  // instead of one replacing the other.
                  const glowEntry = glowShadowFor(word, isActiveWord);
                  const style = { color: word.color, fontSize: `${Math.max(20, word.font_size * previewScale)}px`, fontFamily,
                                  fontWeight: bold && isBoldCapableFont(fontFamily) ? 800 : 400,
                                  ...(!activeVariant && (isActiveWord || glowEntry) ? { textShadow: [isActiveWord ? dropShadowActive : dropShadow, glowEntry].filter((v) => v && v !== "none").join(", ") || "none" } : {}) };
                  const className = [
                    isActiveWord ? "active" : "",
                    isActiveWord && word.kinetic ? `kinetic-${word.kinetic}` : "",
                    isActiveWord && word.emphasize ? "emphasize-accent" : "",
                  ].filter(Boolean).join(" ");
                  return <span key={word.index}>
                    {wordIndex > 0 && " "}
                    <span className={className} style={style}
                      onClick={(e) => { e.stopPropagation(); if (dragMovedRef.current) { dragMovedRef.current = false; return; } openMoment(word.index); }}
                      data-testid={`preview-caption-word-${word.index}`}>{scriptText(word)}</span>
                  </span>;
                })}
                </span>
              </Fragment>)}
              <div className="selection-box">
                {["tl", "tc", "tr", "ml", "mr", "bl", "bc", "br"].map((pos) => <i key={pos} className={`resize-handle handle-${pos}`} onMouseDown={startResize(pos)} data-testid={`caption-resize-handle-${pos}`} />)}
              </div>
            </div>}
            {scopePrompt && <div className="position-scope-prompt" style={{ left: `${boxX}%`, top: `${Math.min(92, boxY + 8)}%` }} data-testid="position-scope-prompt">
              <button onClick={() => setScopePrompt(false)} data-testid="apply-this-caption-button">This caption</button>
              <button onClick={() => { applyTransformToAll(); setScopePrompt(false); }} data-testid="apply-all-captions-button">All captions</button>
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
          captionPosition={captionPosition} onCaptionPosition={choosePosition}
          selectedWord={words[selectedIndex]} onWordStyle={(change) => updateWord(selectedIndex, change)}
          tab={themeTab} onTab={setThemeTab} variant={variant} onVariant={setVariant}
          textStyle={textStyle} onTextStyle={updateTextStyle}
          bold={bold} onBold={setBold} italic={italic} onItalic={setItalic}
          hasActiveCaption={visibleWords.length > 0}
          boxX={boxX} boxY={boxY} boxFontSize={boxFontSize} boxRotation={boxRotation}
          onCaptionPos={setCaptionPos} onCaptionScale={setCaptionScale}
          onCaptionRotation={setCaptionRotation}
          onApplyTransformToAll={applyTransformToAll} onResetTransform={resetTransform} />
      </div>
      {momentPopover != null && words[momentPopover] && <MomentPopover
        word={words[momentPopover]} index={momentPopover}
        frameRect={videoFrameRef.current?.getBoundingClientRect() ?? null}
        anchorRect={momentAnchor}
        onClose={() => setMomentPopover(null)}
        onText={(index, text) => updateWord(index, { text })}
        onNewLine={toggleWordNewLine}
        onMerge={(index, direction) => { mergeWord(index, direction); setMomentPopover(null); }}
        onKinetic={setWordKinetic}
        onEmphasize={toggleWordEmphasize}
        onAddSfx={addSfxMarker}
        canMergePrevious={momentPopover > 0}
        canMergeNext={momentPopover < words.length - 1}
        onSplitCaption={(index) => { splitCaptionBeforeWord(index); setMomentPopover(null); }}
        onMergeCaptionUp={(index) => { mergeCaptionUp(index); setMomentPopover(null); }}
        canSplitCaption={momentPopover > 0}
        canMergeCaptionUp={momentPopover > 0}
      />}
      <Timeline words={words} groups={indexedWordGroups} duration={project.duration} currentTime={currentTime} playing={playing} onToggle={togglePlayback} onSeek={seek} selectedIndex={selectedIndex} onSelect={openMoment} onRetimeWord={updateWord} mediaUrl={`${API_ROOT}/projects/${project.project_id}/media?attempt=${mediaRetry}`} sfxMarkers={sfxMarkers} onAddSfx={addSfxMarker} onMoveSfx={moveSfxMarker} onDeleteSfx={deleteSfxMarker} scriptMode={scriptMode} onSplitAtPlayhead={splitAtPlayhead} canSplitAtPlayhead={canSplitAtPlayhead} />
    </main>
  );
};