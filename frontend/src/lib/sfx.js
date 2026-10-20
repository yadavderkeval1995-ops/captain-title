import { Balloon, Camera, Money, SpeakerHigh, Wind } from "@phosphor-icons/react";

// No licensed SFX audio is bundled (same constraint noted on the backend's
// SfxMarker model - see captions.py) - each type gets a short, distinct
// placeholder tone synthesized with the Web Audio API instead, so a marker
// still audibly previews/plays rather than doing nothing.
export const SFX_TYPES = [
  { id: "whoosh", label: "Whoosh", icon: Wind, color: "#22d3ee", freq: 180, kind: "sweep" },
  { id: "bass_drop", label: "Bass Drop", icon: SpeakerHigh, color: "#a78bfa", freq: 90, kind: "drop" },
  { id: "pop", label: "Pop", icon: Balloon, color: "#ffeb3b", freq: 880, kind: "blip" },
  { id: "cash", label: "Cash", icon: Money, color: "#5ee6a0", freq: 660, kind: "chime" },
  { id: "shutter", label: "Shutter", icon: Camera, color: "#ff8fc7", freq: 1400, kind: "click" },
];
export const SFX_BY_TYPE = Object.fromEntries(SFX_TYPES.map((item) => [item.id, item]));

// A dedicated AudioContext, separate from the <video> element's own audio
// graph entirely - playing a tone here never touches or mutes the main
// video/audio playback, it just mixes in at the OS/speaker level.
let sharedContext = null;
function getContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedContext || sharedContext.state === "closed") sharedContext = new AudioContextClass();
  if (sharedContext.state === "suspended") sharedContext.resume().catch(() => {});
  return sharedContext;
}

export function playSfx(type) {
  const ctx = getContext();
  const meta = SFX_BY_TYPE[type];
  if (!ctx || !meta) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = meta.kind === "drop" ? "sine" : meta.kind === "click" ? "square" : "triangle";
  osc.frequency.setValueAtTime(meta.freq, now);
  if (meta.kind === "sweep") osc.frequency.exponentialRampToValueAtTime(meta.freq * 3, now + 0.18);
  if (meta.kind === "drop") osc.frequency.exponentialRampToValueAtTime(meta.freq * 0.3, now + 0.3);
  if (meta.kind === "chime") osc.frequency.exponentialRampToValueAtTime(meta.freq * 1.5, now + 0.12);
  const duration = meta.kind === "drop" ? 0.4 : meta.kind === "click" ? 0.08 : 0.2;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.3, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.05);
}
