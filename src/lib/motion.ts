// Real-motion check for generated clips, ported from the Android project's backend/motion.py
// (thresholds calibrated there on real LTX clips and on Ken Burns / static / cross-fade clips).
//
// A slideshow clip (a still with zoom, pan or fade) is explained almost entirely by one global
// transform per frame. Real video has parts that move on their own. For frame pairs ~0.4 s apart:
// track features, fit one affine transform (RANSAC), warp, and look at what is left over.
//
// Scope: RAW generated clips only. Finished edits with subtitles fool it (measured), so a finished
// film is judged by the checks of the clips it was made from.

export type Verdict = "real_motion" | "camera_only" | "static" | "invalid";

export interface MotionReport {
  frames: number;
  fps: number;
  durationSec: number;
  pairs: number;
  movingPairs: number;
  globalMotionPx: number;
  peakResidual: number;
  movingShare: number;
  sceneCuts: number;
  verdict: Verdict;
  reason: string;
}

export interface Gray { w: number; h: number; d: Float32Array }

const PEAK_RESIDUAL_MIN = 10;
const MOVING_SHARE_MIN = 0.001;
const MOVING_LEVEL = 20;
const MOVING_PAIRS_MIN = 0.4;
const BLEND_FIT_MIN = 0.1;
const CONTINUITY_MIN = 0.25;
const GAP_SEC = 0.4;
const HARD_CUT_LEVEL = 45;
export const SHORT_SIDE = 360;

type Affine = [number, number, number, number, number, number]; // x' = a x + b y + c ; y' = d x + e y + f
const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];


function bilinear(g: Gray, x: number, y: number): number {
  x = Math.min(g.w - 1, Math.max(0, x)); y = Math.min(g.h - 1, Math.max(0, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const x1 = Math.min(g.w - 1, x0 + 1), y1 = Math.min(g.h - 1, y0 + 1);
  const d = g.d, w = g.w;
  return (d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx) * (1 - fy) + (d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx) * fy;
}

function downsample(g: Gray): Gray {
  const w = g.w >> 1, h = g.h >> 1, d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 2 * y * g.w + 2 * x;
    d[y * w + x] = (g.d[i] + g.d[i + 1] + g.d[i + g.w] + g.d[i + g.w + 1]) / 4;
  }
  return { w, h, d };
}

/** Gaussian blur, 5x5, sigma 1.1 (what OpenCV uses for ksize 5), separable, edges replicated. */
export function blur5(g: Gray): Gray {
  const k0 = 0.0702, k1 = 0.2445, k2 = 0.3706;
  const { w, h } = g, src = g.d, tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const xm2 = x < 2 ? 0 : x - 2, xm1 = x < 1 ? 0 : x - 1, xp1 = x + 1 >= w ? w - 1 : x + 1, xp2 = x + 2 >= w ? w - 1 : x + 2;
      tmp[r + x] = k0 * (src[r + xm2] + src[r + xp2]) + k1 * (src[r + xm1] + src[r + xp1]) + k2 * src[r + x];
    }
  }
  for (let y = 0; y < h; y++) {
    const ym2 = (y < 2 ? 0 : y - 2) * w, ym1 = (y < 1 ? 0 : y - 1) * w, yp1 = (y + 1 >= h ? h - 1 : y + 1) * w, yp2 = (y + 2 >= h ? h - 1 : y + 2) * w, r = y * w;
    for (let x = 0; x < w; x++) out[r + x] = k0 * (tmp[ym2 + x] + tmp[yp2 + x]) + k1 * (tmp[ym1 + x] + tmp[yp1 + x]) + k2 * tmp[r + x];
  }
  return { w, h, d: out };
}

/** Summed-area table with one row/column of padding. */
function integral(v: Float32Array, w: number, h: number): Float64Array {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += v[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  return I;
}
const boxSum = (I: Float64Array, w: number, x0: number, y0: number, x1: number, y1: number) =>
  I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];

/** Margin kept free so that tracking never reads outside the frame (coarse search reaches 4*(P+R)+4 px). */
const MARGIN = 60;

/** Corner-like points (Shi-Tomasi minimum eigenvalue over a 7x7 window), at most one per 12x12 cell. */
function features(g: Gray, max = 250): [number, number][] {
  const { w, h, d } = g;
  const xx = new Float32Array(w * h), yy = new Float32Array(w * h), xy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, gx = d[i + 1] - d[i - 1], gy = d[i + w] - d[i - w];
    xx[i] = gx * gx; yy[i] = gy * gy; xy[i] = gx * gy;
  }
  const Ixx = integral(xx, w, h), Iyy = integral(yy, w, h), Ixy = integral(xy, w, h);
  const cell = 12, R = 3, out: [number, number, number][] = [];
  for (let cy = MARGIN; cy + cell <= h - MARGIN; cy += cell) for (let cx = MARGIN; cx + cell <= w - MARGIN; cx += cell) {
    let best = 0, bx = 0, by = 0;
    for (let y = cy; y < cy + cell; y += 2) for (let x = cx; x < cx + cell; x += 2) {
      const a = boxSum(Ixx, w, x - R, y - R, x + R + 1, y + R + 1), c = boxSum(Iyy, w, x - R, y - R, x + R + 1, y + R + 1), b = boxSum(Ixy, w, x - R, y - R, x + R + 1, y + R + 1);
      const tr = a + c, det = a * c - b * b;
      const lmin = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      if (lmin > best) { best = lmin; bx = x; by = y; }
    }
    if (best > 0) out.push([bx, by, best]);
  }
  const top = out.sort((p, q) => q[2] - p[2]);
  const thresh = (top[0]?.[2] ?? 0) * 0.005;
  return top.filter((p) => p[2] > thresh).slice(0, max).map(([x, y]) => [x, y]);
}

/** Sum of squared differences between the patch around (ax, ay) in A and around (ax+ox, ay+oy) in B. */
function ssd(A: Gray, B: Gray, ax: number, ay: number, ox: number, oy: number, P: number): number {
  const w = A.w, a = A.d, b = B.d;
  let e = 0;
  for (let j = -P; j <= P; j++) {
    const ra = (ay + j) * w + ax, rb = (ay + j + oy) * w + ax + ox;
    for (let i = -P; i <= P; i++) { const v = a[ra + i] - b[rb + i]; e += v * v; }
  }
  return e;
}

/** Pyramidal block matching (3 levels) with sub-pixel refinement. Returns the matched point in b, or null. */
function track(pa: Gray[], pb: Gray[], x: number, y: number): [number, number] | null {
  let dx = 0, dy = 0;
  for (let lvl = pa.length - 1; lvl >= 0; lvl--) {
    const s = 1 << lvl, A = pa[lvl], B = pb[lvl];
    const P = lvl === 0 ? 7 : 4, R = lvl === pa.length - 1 ? 8 : 2;
    const ax = Math.round(x / s), ay = Math.round(y / s);
    const cx = Math.round(dx / s), cy = Math.round(dy / s);
    let best = Infinity, bx = cx, by = cy;
    for (let oy = cy - R; oy <= cy + R; oy++) for (let ox = cx - R; ox <= cx + R; ox++) {
      if (ax + ox - P - 1 < 0 || ay + oy - P - 1 < 0 || ax + ox + P + 1 >= A.w || ay + oy + P + 1 >= A.h) continue;
      const e = ssd(A, B, ax, ay, ox, oy, P); if (e < best) { best = e; bx = ox; by = oy; }
    }
    if (best === Infinity) return null;
    let fx = bx, fy = by;
    if (lvl === 0) {
      if (best / (2 * P + 1) ** 2 > 400) return null; // no good match (occluded or changed)
      const sub = (m: number, c: number, p: number) => { const den = m - 2 * c + p; return den > 0 ? Math.max(-0.5, Math.min(0.5, (m - p) / (2 * den))) : 0; };
      fx = bx + sub(ssd(A, B, ax, ay, bx - 1, by, P), best, ssd(A, B, ax, ay, bx + 1, by, P));
      fy = by + sub(ssd(A, B, ax, ay, bx, by - 1, P), best, ssd(A, B, ax, ay, bx, by + 1, P));
    }
    dx = fx * s; dy = fy * s;
  }
  return [x + dx, y + dy];
}

function solveAffine(p0: [number, number][], p1: [number, number][]): Affine | null {
  // Least squares for x' and y' separately: [x y 1] * [a b c]^T = x'
  const n = p0.length; if (n < 3) return null;
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0;
  let bx0 = 0, bx1 = 0, bx2 = 0, by0 = 0, by1 = 0, by2 = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = p0[i], [u, v] = p1[i];
    sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y;
    bx0 += x * u; bx1 += y * u; bx2 += u; by0 += x * v; by1 += y * v; by2 += v;
  }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  if (Math.abs(det) < 1e-9) return null;
  const solve = (b: number[]) => [0, 1, 2].map((c) => {
    const m = M.map((r, i) => r.map((v, j) => (j === c ? b[i] : v)));
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])) / det;
  });
  const [a, b, c] = solve([bx0, bx1, bx2]); const [d, e, f] = solve([by0, by1, by2]);
  return [a, b, c, d, e, f];
}

const apply = (m: Affine, x: number, y: number): [number, number] => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];

/** Best global affine a->b (identity when tracking fails). Deterministic RANSAC (seeded). */
export function align(a: Gray, b: Gray): Affine {
  const pa = [a, downsample(a), downsample(downsample(a))];
  const pb = [b, downsample(b), downsample(downsample(b))];
  const p0: [number, number][] = [], p1: [number, number][] = [];
  for (const [x, y] of features(a)) { const t = track(pa, pb, x, y); if (t) { p0.push([x, y]); p1.push(t); } }
  if (p0.length < 12) return IDENTITY;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let bestIn: number[] = [];
  for (let it = 0; it < 500; it++) {
    const idx = [0, 1, 2].map(() => Math.floor(rnd() * p0.length));
    if (new Set(idx).size < 3) continue;
    const m = solveAffine(idx.map((i) => p0[i]), idx.map((i) => p1[i]));
    if (!m) continue;
    const inl: number[] = [];
    for (let i = 0; i < p0.length; i++) { const [u, v] = apply(m, ...p0[i]); if (Math.hypot(u - p1[i][0], v - p1[i][1]) < 1) inl.push(i); }
    if (inl.length > bestIn.length) bestIn = inl;
  }
  if (bestIn.length < 6) return IDENTITY;
  return solveAffine(bestIn.map((i) => p0[i]), bestIn.map((i) => p1[i])) ?? IDENTITY;
}

/** Per-pixel change a->b that the global transform m does not explain. */
export function residual(a: Gray, b: Gray, m: Affine = align(a, b)): Gray {
  // m maps a's points to b, so warped(x) = a(m^-1 x).
  const det = m[0] * m[4] - m[1] * m[3];
  const ia = m[4] / det, ib = -m[1] / det, id = -m[3] / det, ie = m[0] / det;
  const warped = new Float32Array(a.d.length);
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const X = x - m[2], Y = y - m[5];
    warped[y * a.w + x] = bilinear(a, ia * X + ib * Y, id * X + ie * Y);
  }
  const wb = blur5({ w: a.w, h: a.h, d: warped }), bb = blur5(b);
  return { w: a.w, h: a.h, d: wb.d.map((v, i) => Math.abs(v - bb.d[i])) };
}

function crop(g: Gray, bd: number): Float32Array {
  const out = new Float32Array((g.w - 2 * bd) * (g.h - 2 * bd));
  let k = 0;
  for (let y = bd; y < g.h - bd; y++) for (let x = bd; x < g.w - bd; x++) out[k++] = g.d[y * g.w + x];
  return out;
}

function percentile(v: Float32Array, q: number): number {
  const s = Float32Array.from(v).sort(); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * q))];
}

function meanAbsDiff(a: Gray, b: Gray) { let s = 0; for (let i = 0; i < a.d.length; i++) s += Math.abs(a.d[i] - b.d[i]); return s / a.d.length; }

export function blendFit(a: Gray, mid: Gray, b: Gray): number {
  let n = 0, dd = 0, dm = 0;
  const idx: number[] = [];
  for (let i = 0; i < a.d.length; i++) { const d = b.d[i] - a.d[i]; if (Math.abs(d) > MOVING_LEVEL) { idx.push(i); dd += d * d; dm += d * (mid.d[i] - a.d[i]); n++; } }
  if (n < 50) return 1;
  const t = Math.min(1, Math.max(0, dm / Math.max(dd, 1e-6)));
  let num = 0, den = 0;
  for (const i of idx) { const d = b.d[i] - a.d[i]; num += Math.abs(mid.d[i] - a.d[i] - t * d); den += Math.abs(d); }
  return num / Math.max(den, 1e-6);
}

function continuity(a: Gray, mid: Gray, b: Gray, d: Float32Array, bd: number): number {
  const mask: number[] = []; d.forEach((v, i) => { if (v > MOVING_LEVEL) mask.push(i); });
  if (mask.length < 30) return 1;
  const d1 = crop(residual(a, mid), bd), d2 = crop(residual(mid, b), bd);
  let e1 = 0, e2 = 0; for (const i of mask) { e1 += d1[i]; e2 += d2[i]; }
  return Math.min(e1, e2) / Math.max(e1, e2, 1e-6);
}

export function analyzeFrames(frames: Gray[], fps: number, totalFrames = frames.length): MotionReport {
  const dur = Math.round((totalFrames / (fps || 24)) * 100) / 100;
  const base = { frames: totalFrames, fps, durationSec: dur };
  if (frames.length < 3) return { ...base, pairs: 0, movingPairs: 0, globalMotionPx: 0, peakResidual: 0, movingShare: 0, sceneCuts: 0, verdict: "invalid", reason: "The file could not be decoded or has fewer than 3 frames." };
  let gap = Math.max(1, Math.round(fps * GAP_SEC));
  if (frames.length <= gap) gap = Math.max(1, Math.floor(frames.length / 3));
  const rows: [number, number, number][] = [], blends: number[] = [];
  let cuts = 0;
  for (let i = 0; i < frames.length - gap; i += Math.max(1, gap >> 1)) {
    const a = frames[i], b = frames[i + gap];
    if (meanAbsDiff(a, b) > HARD_CUT_LEVEL) { cuts++; continue; }
    const m = align(a, b);
    const corners: [number, number][] = [[0, 0], [a.w, 0], [0, a.h], [a.w, a.h]];
    const gpx = corners.reduce((s, [x, y]) => { const [u, v] = apply(m, x, y); return s + Math.hypot(u - x, v - y); }, 0) / 4;
    let bd = Math.max(16, Math.floor(gpx) + 4);
    if (!(a.h > 3 * bd && a.w > 3 * bd)) bd = 1;
    const d = crop(residual(a, b, m), bd);
    const peak = percentile(d, 0.995);
    let moving = 0; for (const v of d) if (v > MOVING_LEVEL) moving++;
    const share = moving / d.length;
    const mid = frames[i + (gap >> 1)];
    const blend = gap >= 2 ? blendFit(a, mid, b) : 1;
    const cont = gap >= 2 && peak >= PEAK_RESIDUAL_MIN ? continuity(a, mid, b, d, bd) : 1;
    rows.push([gpx, peak, share]);
    blends.push(cont >= CONTINUITY_MIN ? Math.min(blend, 1) : -1);
  }
  if (!rows.length) return { ...base, pairs: 0, movingPairs: 0, globalMotionPx: 0, peakResidual: 0, movingShare: 0, sceneCuts: cuts, verdict: "invalid", reason: "Every sampled frame pair was a hard cut; cannot judge motion." };
  const movingPairs = rows.filter((r, i) => r[1] >= PEAK_RESIDUAL_MIN && r[2] >= MOVING_SHARE_MIN && blends[i] >= BLEND_FIT_MIN).length / rows.length;
  const median = (k: number) => { const s = rows.map((r) => r[k]).sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const g = median(0), peak = median(1), ms = median(2);
  let verdict: Verdict, reason: string;
  if (movingPairs >= MOVING_PAIRS_MIN) { verdict = "real_motion"; reason = "Parts of the picture move independently of the camera (synthesized motion)."; }
  else if (g > 0.5 || peak > 2) { verdict = "camera_only"; reason = "All movement fits one global zoom/pan/fade, as in a slideshow made from a still image. This is not counted as AI-generated motion."; }
  else { verdict = "static"; reason = "The picture barely changes over time."; }
  const r = (v: number, k: number) => Math.round(v * 10 ** k) / 10 ** k;
  return { ...base, pairs: rows.length, movingPairs: r(movingPairs, 3), globalMotionPx: r(g, 3), peakResidual: r(peak, 2), movingShare: r(ms, 5), sceneCuts: cuts, verdict, reason };
}
