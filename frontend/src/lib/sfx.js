import { Balloon, Camera, Money, SpeakerHigh, Wind } from "@phosphor-icons/react";

// No licensed SFX audio is bundled - every free/CC0 sample host tried from
// the dev sandbox that built this (Freesound, Pixabay, Mixkit, Zapsplat,
// SoundBible, OpenGameArt) was unreachable, so each type gets a short
// synthesized stand-in instead of a marker having no audible effect at all.
// Mirrors backend/captions.py's _sfx_source_filter exactly, technique for
// technique, so the editor preview and the export sound the same:
// whoosh/pop/shutter are fundamentally noisy, transient sounds (air
// movement, a sharp impact) - a pure tone sweep reads as a generic "beep"
// no matter the frequency, so those three are filtered white noise, not an
// oscillator. bass_drop (a real pitch-dropping sine, same technique actual
// trailer/EDM bass drops use) and cash (two short bell notes, like a cash
// register's two-note "cha-ching") stay tone-based since that's genuinely
// the right technique for what they're imitating.
export const SFX_TYPES = [
  { id: "whoosh", label: "Whoosh", icon: Wind, color: "#22d3ee" },
  { id: "bass_drop", label: "Bass Drop", icon: SpeakerHigh, color: "#a78bfa" },
  { id: "pop", label: "Pop", icon: Balloon, color: "#ffeb3b" },
  { id: "cash", label: "Cash", icon: Money, color: "#5ee6a0" },
  { id: "shutter", label: "Shutter", icon: Camera, color: "#ff8fc7" },
];
export const SFX_BY_TYPE = Object.fromEntries(SFX_TYPES.map((item) => [item.id, item]));

// A dedicated AudioContext, separate from the <video> element's own audio
// graph entirely - playing a sound here never touches or mutes the main
// video/audio playback, it just mixes in at the OS/speaker level.
let sharedContext = null;
function getContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedContext || sharedContext.state === "closed") sharedContext = new AudioContextClass();
  if (sharedContext.state === "suspended") sharedContext.resume().catch(() => {});
  return sharedContext;
}

// A short burst of white noise, as an AudioBufferSourceNode ready to
// connect onward to a filter - the noise-based building block for
// whoosh/pop/shutter, same role anoisesrc plays on the backend.
function noiseBurst(ctx, duration, amplitude) {
  const length = Math.max(1, Math.round(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * amplitude;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

// Linear attack then exponential decay, applied to a GainNode - the same
// envelope shape _sfx_source_filter's afade/aevalsrc chains use.
function applyEnvelope(ctx, gain, now, attack, duration, peak) {
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
}

function playWhoosh(ctx, now) {
  const source = noiseBurst(ctx, 0.3, 0.6);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass"; filter.frequency.value = 1100; filter.Q.value = 1.2;
  const gain = ctx.createGain();
  applyEnvelope(ctx, gain, now, 0.02, 0.3, 0.5);
  source.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  source.start(now); source.stop(now + 0.31);
}

function playPop(ctx, now) {
  const source = noiseBurst(ctx, 0.08, 0.5);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass"; filter.frequency.value = 2200; filter.Q.value = 1.2;
  const gain = ctx.createGain();
  applyEnvelope(ctx, gain, now, 0.002, 0.08, 0.6);
  source.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  source.start(now); source.stop(now + 0.09);
}

function playShutter(ctx, now) {
  const source = noiseBurst(ctx, 0.05, 0.5);
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass"; filter.frequency.value = 3500;
  const gain = ctx.createGain();
  applyEnvelope(ctx, gain, now, 0.001, 0.05, 0.5);
  source.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  source.start(now); source.stop(now + 0.06);
}

function playTone(ctx, now, freq, duration, peak, startAt = 0) {
  const osc = ctx.createOscillator();
  osc.type = "sine"; osc.frequency.value = freq;
  const gain = ctx.createGain();
  applyEnvelope(ctx, gain, now + startAt, 0.01, duration, peak);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(now + startAt); osc.stop(now + startAt + duration + 0.02);
}

function playCash(ctx, now) {
  // Two short bell notes a fifth apart, the second landing ~70ms after the
  // first - the classic two-note "cha-ching" shape.
  playTone(ctx, now, 880, 0.15, 0.5);
  playTone(ctx, now, 1320, 0.15, 0.4, 0.07);
}

function playBassDrop(ctx, now) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(90, now);
  osc.frequency.exponentialRampToValueAtTime(27, now + 0.4);
  // A soft tanh-style saturation curve - the same role asoftclip plays on
  // the backend, giving the drop some harmonic weight instead of sounding
  // like a thin, clean sine.
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
  }
  shaper.curve = curve;
  const gain = ctx.createGain();
  applyEnvelope(ctx, gain, now, 0.015, 0.4, 0.6);
  osc.connect(shaper); shaper.connect(gain); gain.connect(ctx.destination);
  osc.start(now); osc.stop(now + 0.42);
}

export function playSfx(type) {
  const ctx = getContext();
  if (!ctx || !SFX_BY_TYPE[type]) return;
  const now = ctx.currentTime;
  if (type === "whoosh") return playWhoosh(ctx, now);
  if (type === "pop") return playPop(ctx, now);
  if (type === "shutter") return playShutter(ctx, now);
  if (type === "cash") return playCash(ctx, now);
  return playBassDrop(ctx, now);
}
