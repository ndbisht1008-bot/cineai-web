// A test song with exactly known tempo, beats and sections (same as the Android project's SongSynth).
import type { SectionLabel } from "../src/lib/beat";

interface Part { label: SectionLabel; bars: number; kick: number; snare: number; hat: number; bass: number; pad: number; lead: number }
export const structure: Part[] = [
  { label: "Intro", bars: 4, kick: 0, snare: 0, hat: 0.05, bass: 0, pad: 0.25, lead: 0 },
  { label: "Verse", bars: 8, kick: 0.6, snare: 0.4, hat: 0.15, bass: 0.25, pad: 0.15, lead: 0 },
  { label: "Chorus", bars: 8, kick: 0.9, snare: 0.7, hat: 0.25, bass: 0.5, pad: 0.25, lead: 0.35 },
  { label: "Breakdown", bars: 4, kick: 0, snare: 0, hat: 0.08, bass: 0, pad: 0.3, lead: 0.1 },
  { label: "Drop", bars: 8, kick: 1, snare: 0.8, hat: 0.3, bass: 0.9, pad: 0.2, lead: 0.4 },
  { label: "Outro", bars: 4, kick: 0, snare: 0, hat: 0.04, bass: 0, pad: 0.2, lead: 0 },
];

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export function makeSong(bpm: number, rate = 22050, seed = 3): Float32Array {
  const beat = 60 / bpm;
  const total = structure.reduce((s, p) => s + p.bars, 0);
  const o = new Float32Array(Math.floor(total * 4 * beat * rate) + rate);
  const rnd = rng(seed);
  const tone = (t: number, dur: number, f: number, a: number, attack: number) => {
    const s0 = Math.floor(t * rate);
    for (let i = 0; i < Math.floor(dur * rate) && s0 + i < o.length; i++) {
      const tt = i / rate; const env = Math.min(1, tt / attack) * Math.exp(-tt * 1.5);
      o[s0 + i] += a * env * (Math.sin(2 * Math.PI * f * tt) + 0.3 * Math.sin(4 * Math.PI * f * tt));
    }
  };
  const kick = (t: number, a: number) => {
    const s0 = Math.floor(t * rate); let ph = 0;
    for (let i = 0; i < Math.floor(0.25 * rate) && s0 + i < o.length; i++) {
      const tt = i / rate; ph += (2 * Math.PI * (50 + 90 * Math.exp(-tt * 30))) / rate;
      o[s0 + i] += a * 1.6 * Math.exp(-tt * 12) * Math.sin(ph);
    }
  };
  const noise = (t: number, dur: number, a: number, bright = false) => {
    const s0 = Math.floor(t * rate); let prev = 0;
    for (let i = 0; i < Math.floor(dur * rate) && s0 + i < o.length; i++) {
      const w = rnd() * 2 - 1; const v = bright ? w - prev : w; prev = w;
      o[s0 + i] += a * v * Math.exp(-i / rate / (dur / 4));
    }
  };
  const chords = [57, 53, 60, 55];
  let bar = 0;
  for (const p of structure) for (let r = 0; r < p.bars; r++, bar++) {
    const bs = bar * 4 * beat, root = chords[bar % 4];
    if (p.pad > 0) for (const iv of [0, 4, 7]) tone(bs, 4 * beat, hz(root + iv), p.pad / 3, 0.3);
    for (let b = 0; b < 4; b++) {
      const t = bs + b * beat;
      if (p.kick > 0 && (b === 0 || b === 2)) kick(t, p.kick);
      if (p.snare > 0 && (b === 1 || b === 3)) noise(t, 0.12, p.snare);
      if (p.hat > 0) { noise(t, 0.03, p.hat, true); noise(t + beat / 2, 0.03, p.hat * 0.6, true); }
      if (p.bass > 0) tone(t, beat * 0.9, hz(root - 24), p.bass, 0.005);
      if (p.lead > 0 && b % 2 === 0) tone(t, beat * 0.8, hz(root + 12 + [0, 4, 7, 12][(bar + b) % 4]), p.lead, 0.01);
    }
  }
  let peak = 1e-6; for (const v of o) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < o.length; i++) o[i] = (o[i] / peak) * 0.9;
  return o;
}

export const beatTimes = (bpm: number) => Array.from({ length: structure.reduce((s, p) => s + p.bars, 0) * 4 }, (_, i) => (i * 60) / bpm);
export function sectionStarts(bpm: number) { let bar = 0; return structure.map((p) => { const t = (bar * 4 * 60) / bpm; bar += p.bars; return t; }); }

export function fMeasure(est: number[], ref: number[], tol = 0.07): number {
  const used = new Array(est.length).fill(false); let hit = 0;
  for (const r of ref) { const i = est.findIndex((e, k) => !used[k] && Math.abs(e - r) <= tol); if (i >= 0) { used[i] = true; hit++; } }
  const p = hit / est.length, rr = hit / ref.length;
  return p + rr === 0 ? 0 : (2 * p * rr) / (p + rr);
}
