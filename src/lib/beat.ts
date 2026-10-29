// Music analysis, ported line by line from the Android app's BeatAnalyzer (tested against librosa
// and synthetic songs with known tempo, see the Android repo's TEST_RESULTS.md). Runs in a Web Worker;
// the song never leaves the device.
//
// - onset strength: positive log-spectral flux over 40 log-spaced bands
// - tempo: onset autocorrelation with a log-normal prior around 120 BPM
// - beats: Ellis (2007) dynamic-programming beat tracker
// - downbeats: the beat phase (of 4) with the strongest bass onsets
// - sections: novelty on a bar-level self-similarity matrix (Foote 2000) + loudness steps

export type SectionLabel = "Intro" | "Verse" | "Chorus" | "Drop" | "Breakdown" | "Outro";

export interface MusicSection { label: SectionLabel; startSec: number; endSec: number; energy: number; bass: number; repeatOf: number }

export interface MusicAnalysis {
  durationSec: number;
  bpm: number;
  /** 0..1; below about 0.3 the beat grid is a guess. */
  tempoConfidence: number;
  beats: number[];
  beatStrength: number[];
  downbeats: number[];
  sections: MusicSection[];
  energyCurve: number[];
  curveStepSec: number;
  waveform: number[];
  loudnessDb: number;
  impacts: number[];
}

export const SR = 22050;
const N_FFT = 2048;
const HOP = 512;
const BANDS = 40;
const ONSET_FFT = 1024;
const TIME_OFFSET = (N_FFT / 2 + HOP / 2) / SR;
const STEP_DB = 2.5;
export const FRAME_SEC = HOP / SR;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const avg = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; };
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const maxBy = <T>(xs: T[], f: (x: T) => number): T => xs.reduce((m, x) => (f(x) > f(m) ? x : m));

/** Linear-interpolation resampler (the browser path resamples with OfflineAudioContext instead). */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const n = Math.floor(x.length * to / from);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * from / to; const j = Math.floor(p); const f = p - j;
    out[i] = (x[j] ?? 0) * (1 - f) + (x[j + 1] ?? x[j] ?? 0) * f;
  }
  return out;
}

export function analyzeMusic(samples: Float32Array, sampleRate: number, waveformColumns = 600, onProgress: (f: number) => void = () => {}): MusicAnalysis {
  const x = resample(samples, sampleRate, SR);
  const duration = x.length / SR;
  if (duration < 5) throw new Error("The song is too short to analyse (under 5 s).");

  const nFrames = Math.max(1, Math.floor((x.length - N_FFT) / HOP) + 1);
  const win = Float64Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT));
  const cmap = chromaMap();
  const logBands = Array.from({ length: nFrames }, () => new Float32Array(BANDS));
  const rms = new Float32Array(nFrames), centroid = new Float32Array(nFrames), bassShare = new Float32Array(nFrames);
  const chroma = Array.from({ length: nFrames }, () => new Float32Array(12));
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);
  const owin = Float64Array.from({ length: ONSET_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / ONSET_FFT));
  const ore = new Float64Array(ONSET_FFT), oim = new Float64Array(ONSET_FFT);
  const oEdges = bandEdges(ONSET_FFT);
  const bassBin = Math.round((150 * N_FFT) / SR);
  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    let e = 0;
    for (let i = 0; i < N_FFT; i++) { const s = off + i < x.length ? x[off + i] : 0; e += s * s; re[i] = s * win[i]; im[i] = 0; }
    rms[f] = Math.sqrt(e / N_FFT);
    fft(re, im);
    let tot = 0, wsum = 0, bass = 0;
    for (let k = 0; k <= N_FFT / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      tot += p; wsum += p * k; if (k <= bassBin) bass += p;
      const c = cmap[k]; if (c >= 0) chroma[f][c] += p;
    }
    centroid[f] = tot > 0 ? (wsum / tot) * SR / N_FFT : 0;
    bassShare[f] = tot > 0 ? bass / tot : 0;
    const o0 = off + (N_FFT - ONSET_FFT) / 2;
    for (let i = 0; i < ONSET_FFT; i++) { const s = o0 + i < x.length ? x[o0 + i] : 0; ore[i] = s * owin[i]; oim[i] = 0; }
    fft(ore, oim);
    for (let b = 0; b < BANDS; b++) {
      let s = 0;
      for (let k = oEdges[b]; k < oEdges[b + 1]; k++) s += ore[k] * ore[k] + oim[k] * oim[k];
      logBands[f][b] = 10 * Math.log10(1e-6 + s / Math.max(1, oEdges[b + 1] - oEdges[b]));
    }
    if (f % 500 === 0) onProgress((0.6 * f) / nFrames);
  }

  const onsetRaw = new Float32Array(nFrames), bassOnset = new Float32Array(nFrames);
  for (let f = 1; f < nFrames; f++) {
    let s = 0, sb = 0;
    for (let b = 0; b < BANDS; b++) { const d = logBands[f][b] - logBands[f - 1][b]; if (d > 0) { s += d; if (b < 8) sb += d; } }
    onsetRaw[f] = s; bassOnset[f] = sb;
  }
  const onset = detrend(onsetRaw, Math.round(0.5 / FRAME_SEC));
  let om = 1e-6; for (const v of onset) om = Math.max(om, v);
  for (let i = 0; i < onset.length; i++) onset[i] /= om;
  onProgress(0.65);

  const [bpm0, conf] = tempo(onset);
  const first = trackBeats(onset, 60 / bpm0 / FRAME_SEC);
  let ibi = 0;
  if (first.length >= 8) {
    const n = first.length, mx = (n - 1) / 2, my = avg(first);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (i - mx) * (first[i] - my); den += (i - mx) ** 2; }
    ibi = num / den;
  }
  const bpm = ibi > 0 && Math.abs(60 / (ibi * FRAME_SEC) / bpm0 - 1) < 0.04 ? 60 / (ibi * FRAME_SEC) : bpm0;
  onProgress(0.7);

  const period = 60 / bpm / FRAME_SEC;
  const beatFrames = [...new Set(trackBeats(onset, period).map((f) => {
    const r = range(Math.max(0, f - 3), Math.min(onset.length - 1, f + 3) + 1);
    const m = maxBy(r, (i) => onset[i]);
    return onset[m] > 0.05 ? m : f;
  }))];
  const times0 = beatFrames.map((f) => f * FRAME_SEC + TIME_OFFSET);
  const str0 = beatFrames.map((f) => localMax(onset, f, 2));
  const sMax = Math.max(1e-6, ...str0, 0);
  const [beats, strength] = extendGrid(times0, str0.map((v) => v / sMax), 60 / bpm, duration, (t) => {
    const f = clamp(Math.floor(t / FRAME_SEC), 0, nFrames - 1);
    for (let i = Math.max(0, f - 20); i <= Math.min(nFrames - 1, f + 20); i++) if (rms[i] > 0.003) return true;
    return false;
  });
  onProgress(0.8);

  const grid = beats.map((t) => clamp(Math.round((t - TIME_OFFSET) / FRAME_SEC), 0, nFrames - 1));
  const phase = grid.length >= 8 ? maxBy([0, 1, 2, 3], (ph) => {
    const idx = grid.map((_, i) => i).filter((i) => i % 4 === ph);
    return idx.reduce((s, i) => s + localMax(bassOnset, grid[i], 2) + 0.5 * localMax(onset, grid[i], 2), 0) / Math.max(1, idx.length);
  }) : 0;
  const downbeats = beats.filter((_, i) => i % 4 === phase);

  const step = 0.25;
  const perStep = Math.max(1, Math.round(step / FRAME_SEC));
  const dbCurve: number[] = [];
  for (let s = 0; s < nFrames; s += perStep) {
    let e = 0; for (let i = s; i < Math.min(nFrames, s + perStep); i++) e += rms[i] * rms[i];
    dbCurve.push(10 * Math.log10(e / perStep + 1e-10));
  }
  const lo = percentile(dbCurve, 0.05), hi = percentile(dbCurve, 0.98);
  const energyCurve = dbCurve.map((d) => clamp((d - lo) / Math.max(1e-6, hi - lo), 0, 1));
  const active = dbCurve.filter((d) => d > -60);
  const loudness = active.length ? 10 * Math.log10(avg(active.map((d) => 10 ** (d / 10)))) : -90;

  const sections = findSections(downbeats, duration, rms, centroid, bassShare, onset, chroma, lo, hi);
  onProgress(0.95);

  const rise = energyCurve.map((v, i) => (i < 4 ? 0 : v - avg(energyCurve.slice(Math.max(0, i - 8), i - 2))));
  const impacts: number[] = [];
  for (const i of rise.map((_, i) => i).sort((a, b) => rise[b] - rise[a])) {
    if (rise[i] < 0.25 || impacts.length >= 8) break;
    const t = i * step;
    if (impacts.every((v) => Math.abs(v - t) >= 4)) impacts.push(snap(t, downbeats.length ? downbeats : beats));
  }

  const col = Math.max(1, Math.floor(x.length / waveformColumns));
  const wave: number[] = [];
  for (let c = 0; c < Math.min(waveformColumns, Math.floor(x.length / col)); c++) {
    let p = 0; for (let i = c * col; i < Math.min(x.length, (c + 1) * col); i++) p = Math.max(p, Math.abs(x[i]));
    wave.push(p);
  }
  const wMax = Math.max(1e-6, ...wave);
  onProgress(1);
  return {
    durationSec: duration, bpm: Math.round(bpm * 10) / 10, tempoConfidence: conf,
    beats: beats.map(r3), beatStrength: strength, downbeats: downbeats.map(r3), sections,
    energyCurve, curveStepSec: step, waveform: wave.map((v) => v / wMax),
    loudnessDb: Math.round(loudness * 10) / 10, impacts: impacts.sort((a, b) => a - b).map(r3),
  };
}

export function extendGrid(beats: number[], strength: number[], period: number, duration: number, audible: (t: number) => boolean): [number[], number[]] {
  if (beats.length < 2) return [beats, strength];
  const gaps = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b);
  const med = gaps[Math.floor(gaps.length / 2)];
  const p = med > 0.2 ? med : period;
  const before: number[] = []; let t = beats[0] - p;
  while (t >= 0.05 && audible(t)) { before.push(t); t -= p; }
  const after: number[] = []; t = beats[beats.length - 1] + p;
  while (t <= duration - 0.05 && audible(t)) { after.push(t); t += p; }
  return [[...before.reverse(), ...beats, ...after], [...before.map(() => 0), ...strength, ...after.map(() => 0)]];
}

function snap(t: number, grid: number[]): number {
  if (!grid.length) return t;
  const g = maxBy(grid, (v) => -Math.abs(v - t));
  return Math.abs(g - t) < 1 ? g : t;
}

export function tempo(onset: Float32Array): [number, number] {
  const minLag = Math.floor(60 / 220 / FRAME_SEC);
  const maxLag = Math.floor(60 / 50 / FRAME_SEC) + 1;
  const n = onset.length;
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0; for (let i = 0; i < n - lag; i++) s += onset[i] * onset[i + lag];
    ac[lag] = s / Math.max(1, n - lag);
  }
  const score = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    const b = 60 / (lag * FRAME_SEC);
    const prior = Math.exp(-0.5 * Math.log2(b / 120) ** 2);
    let s = ac[lag];
    for (const m of [2, 3]) { const l2 = lag * m; if (l2 + 1 < ac.length) s += 0.5 * Math.max(ac[l2 - 1], ac[l2], ac[l2 + 1]); }
    score[lag] = s * prior;
  }
  const lags = range(minLag, maxLag + 1);
  let best = maxBy(lags, (l) => score[l]);
  const bestBpm = 60 / (best * FRAME_SEC);
  if (bestBpm > 150 && best * 2 <= maxLag && ac[best * 2] >= 0.5 * ac[best]) best = maxBy([best * 2 - 1, best * 2, best * 2 + 1], (l) => ac[l]);
  else if (bestBpm < 75 && Math.floor(best / 2) >= minLag && ac[Math.floor(best / 2)] >= 0.4 * ac[best]) { const h = Math.floor(best / 2); best = maxBy([h - 1, h, h + 1], (l) => ac[l]); }
  const y0 = score[best - 1] ?? score[best], y1 = score[best], y2 = score[best + 1] ?? score[best];
  const den = 2 * (y0 - 2 * y1 + y2);
  const d = (y0 - y2) / (den === 0 ? 1e9 : den);
  const lag = best + clamp(d, -0.5, 0.5);
  const sorted = lags.map((l) => score[l]).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  return [60 / (lag * FRAME_SEC), clamp((y1 - med) / (y1 + 1e-12), 0, 1)];
}

export function trackBeats(onset: Float32Array, period: number, tightness = 100): number[] {
  const n = onset.length;
  if (n < 4) return [];
  const local = gaussianSmooth(onset, period / 32);
  let ms = 0; for (const v of local) ms += v * v;
  const std = Math.max(1e-9, Math.sqrt(ms / n));
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.max(1, Math.round(period / 2)), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = -Infinity, arg = -1;
    for (let tau = Math.max(0, t - hi); tau <= t - lo; tau++) {
      const v = score[tau] - tightness * Math.log((t - tau) / period) ** 2;
      if (v > best) { best = v; arg = tau; }
    }
    score[t] = local[t] / std + (arg >= 0 ? best : 0);
    back[t] = arg;
  }
  let t = maxBy(range(Math.max(0, n - Math.round(period) - 1), n), (i) => score[i]);
  const out: number[] = [];
  while (t >= 0) { out.push(t); t = back[t]; }
  out.reverse();
  const thresh = 0.5 * Math.sqrt(ms / n);
  const win = (f: number) => { let m = 0; for (let i = Math.max(0, f - 3); i <= Math.min(n - 1, f + 3); i++) m = Math.max(m, local[i]); return m; };
  while (out.length > 2 && local[out[0]] < thresh && win(out[0]) < thresh) out.shift();
  while (out.length > 2 && win(out[out.length - 1]) < thresh) out.pop();
  return out;
}

function findSections(
  downbeats: number[], duration: number, rms: Float32Array, centroid: Float32Array, bass: Float32Array,
  onset: Float32Array, chroma: Float32Array[], dbLo: number, dbHi: number,
): MusicSection[] {
  const b0 = downbeats.length >= 4 ? [0, ...downbeats.filter((d) => d > 0.5)] : range(0, Math.floor(duration / 2)).map((i) => i * 2);
  const bounds = [...new Set([...b0, duration])].sort((a, b) => a - b);
  const raw: [number, number][] = bounds.slice(1).map((b, i) => [bounds[i], b] as [number, number]).filter(([a, b]) => b - a > 0.2);
  const lens = raw.map(([a, b]) => b - a).sort((a, b) => a - b);
  const typical = lens.length ? lens[Math.floor(lens.length / 2)] : 2;
  const bars: [number, number][] = [];
  for (const b of raw) {
    if (bars.length && b[1] - b[0] < typical * 0.5) bars[bars.length - 1] = [bars[bars.length - 1][0], b[1]];
    else bars.push(b);
  }
  if (bars.length < 4) return [{ label: "Verse", startSec: 0, endSec: duration, energy: 0.5, bass: avg(bass), repeatOf: -1 }];
  const fr = (t: number) => clamp(Math.floor(t / FRAME_SEC), 0, rms.length - 1);
  const feats = bars.map(([a, b]) => {
    const r = range(fr(a), Math.max(fr(a) + 1, fr(b)));
    const db = 10 * Math.log10(r.reduce((s, i) => s + rms[i] * rms[i], 0) / r.length + 1e-10);
    const c = new Float64Array(12); for (const f of r) for (let k = 0; k < 12; k++) c[k] += chroma[f][k];
    const cs = Math.max(1e-9, c.reduce((s, v) => s + v, 0));
    return [db, avg(r.map((i) => centroid[i])) / 1000, avg(r.map((i) => bass[i])) * 5, avg(r.map((i) => onset[i])) * 5, ...Array.from(c, (v) => (v / cs) * 3)];
  });
  const dims = feats[0].length;
  const weight = [2, 1, 1, 1, ...Array(12).fill(0.3)];
  const z = feats.map((f) => [...f]);
  for (let d = 0; d < dims; d++) {
    const m = avg(feats.map((f) => f[d]));
    const s = Math.max(1e-6, Math.sqrt(avg(feats.map((f) => (f[d] - m) ** 2))));
    for (const row of z) row[d] = ((row[d] - m) / s) * weight[d];
  }
  const nb = bars.length;
  const cos = (a: number[], b: number[]) => { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return ab / Math.sqrt(aa * bb + 1e-12); };
  const ssm = z.map((a) => z.map((b) => cos(a, b)));
  const k = Math.max(1, Math.min(4, Math.floor(nb / 4)));
  const novelty = range(0, nb).map((i) => {
    let s = 0;
    for (let a = -k; a < k; a++) for (let b = -k; b < k; b++) {
      const ii = i + a, jj = i + b;
      if (ii < 0 || jj < 0 || ii >= nb || jj >= nb) continue;
      const sign = (a < 0) === (b < 0) ? 1 : -1;
      s += sign * Math.exp(-((a + 0.5) ** 2 + (b + 0.5) ** 2) / (2 * (k * 0.6) ** 2)) * ssm[ii][jj];
    }
    return s;
  });
  const barDb = feats.map((f) => f[0]);
  const stepDb = range(0, nb).map((i) => (i < 2 || i > nb - 2 ? 0 :
    Math.abs(avg(range(i, Math.min(nb, i + 4)).map((j) => barDb[j])) - avg(range(Math.max(0, i - 4), i).map((j) => barDb[j])))));
  const mean = avg(novelty);
  const sd = Math.max(1e-9, Math.sqrt(avg(novelty.map((v) => (v - mean) ** 2))));
  const isPeak = (v: number[], i: number) => v[i] >= v[i - 1] && v[i] >= (v[i + 1] ?? 0);
  const strength = range(0, nb).map((i) => (i < 2 || i >= nb - 1 ? 0 : Math.max(
    isPeak(novelty, i) && novelty[i] > mean + 0.5 * sd ? (novelty[i] - mean) / sd : 0,
    isPeak(stepDb, i) && stepDb[i] >= STEP_DB ? stepDb[i] / STEP_DB : 0,
  )));
  const cand = range(2, nb - 1).filter((i) => strength[i] > 0).sort((a, b) => (strength[b] + (b % 4 === 0 ? 0.5 : 0)) - (strength[a] + (a % 4 === 0 ? 0.5 : 0)));
  const cuts: number[] = [];
  for (const c of cand) if (cuts.every((x) => Math.abs(x - c) >= 4)) cuts.push(c);
  cuts.sort((a, b) => a - b);
  const pts = [0, ...cuts, nb];
  const segBars = pts.slice(1).map((b, i) => [pts[i], b] as [number, number]);
  const segs = segBars.map(([a, b]) => {
    const db = 10 * Math.log10(avg(range(a, b).map((i) => 10 ** (barDb[i] / 10))));
    const en = clamp((db - dbLo) / Math.max(1e-6, dbHi - dbLo), 0, 1);
    const bs = avg(range(a, b).map((i) => feats[i][2] / 5));
    const prof = new Array(dims).fill(0); for (const i of range(a, b)) for (let d = 0; d < dims; d++) prof[d] += z[i][d];
    return { a, b, en, bs, prof };
  });
  const sortedE = segs.map((s) => s.en).sort((a, b) => a - b);
  const highCut = sortedE[clamp(Math.ceil(sortedE.length * 0.67) - 1, 0, sortedE.length - 1)];
  const result: MusicSection[] = [];
  segs.forEach((s, i) => {
    const prev = i > 0 ? segs[i - 1].en : undefined;
    let repeat = -1;
    for (let j = 0; j < i; j++) if (cos(segs[j].prof, s.prof) > 0.85) { repeat = j; break; }
    let label: SectionLabel;
    if (i === 0 && segs.length > 2 && s.en < highCut) label = "Intro";
    else if (i === segs.length - 1 && segs.length > 2 && s.en < highCut && (prev === undefined || s.en <= prev)) label = "Outro";
    else if (s.en >= highCut && prev !== undefined && s.en - prev > 0.3 && s.bs > 0.25) label = "Drop";
    else if (s.en >= highCut) label = "Chorus";
    else if (prev !== undefined && prev >= highCut && s.en < prev - 0.25) label = "Breakdown";
    else if (repeat >= 0 && result[repeat].label === "Chorus") label = "Chorus";
    else label = "Verse";
    result.push({ label, startSec: r3(bars[s.a][0]), endSec: r3(bars[s.b - 1][1]), energy: s.en, bass: s.bs, repeatOf: repeat });
  });
  return result;
}

function bandEdges(n: number): Int32Array {
  const lo = Math.log(40), hi = Math.log(11000);
  const e = Int32Array.from({ length: BANDS + 1 }, (_, b) => Math.round((Math.exp(lo + ((hi - lo) * b) / BANDS) * n) / SR));
  for (let b = 1; b <= BANDS; b++) if (e[b] <= e[b - 1]) e[b] = e[b - 1] + 1;
  return e;
}

function chromaMap(): Int32Array {
  return Int32Array.from({ length: N_FFT / 2 + 1 }, (_, k) => {
    const f = (k * SR) / N_FFT;
    if (f < 55 || f > 4000) return -1;
    return (((Math.round(12 * Math.log2(f / 440) + 69)) % 12) + 12) % 12;
  });
}

function detrend(x: Float32Array, w: number): Float32Array {
  const pre = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) pre[i + 1] = pre[i] + x[i];
  return Float32Array.from(x, (v, i) => { const a = Math.max(0, i - w), b = Math.min(x.length, i + w + 1); return Math.max(0, v - (pre[b] - pre[a]) / (b - a)); });
}

function gaussianSmooth(x: Float32Array, sigma: number): Float32Array {
  if (sigma < 0.5) return x.slice();
  const r = Math.floor(3 * sigma);
  const k = Float64Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-0.5 * ((i - r) / sigma) ** 2));
  const ks = k.reduce((s, v) => s + v, 0);
  return Float32Array.from(x, (_, i) => { let s = 0; for (let j = -r; j <= r; j++) { const t = i + j; if (t >= 0 && t < x.length) s += x[t] * k[j + r]; } return s / ks; });
}

function localMax(x: Float32Array, at: number, r: number): number {
  let m = 0; for (let i = Math.max(0, at - r); i <= Math.min(x.length - 1, at + r); i++) m = Math.max(m, x[i]); return m;
}

function percentile(v: number[], q: number): number {
  const s = [...v].sort((a, b) => a - b); return s[Math.round((s.length - 1) * q)];
}

/** In-place iterative radix-2 FFT. */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const ar = re[b] * cr - im[b] * ci, ai = re[b] * ci + im[b] * cr;
        re[b] = re[a] - ar; im[b] = im[a] - ai; re[a] += ar; im[a] += ai;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
