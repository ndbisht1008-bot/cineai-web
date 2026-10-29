import { describe, expect, it } from "vitest";
import { analyzeFrames, type Gray } from "../src/lib/motion";

// A textured still (deterministic noise blobs) used to build slideshow-like and moving clips.
const W = 360, H = 640;
function texture(): Gray {
  const d = new Float32Array(W * 2 * H * 2);
  let s = 7; const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < 900; k++) {
    const cx = r() * W * 2, cy = r() * H * 2, rad = 4 + r() * 20, v = r() * 255;
    for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(H * 2, cy + rad); y++)
      for (let x = Math.max(0, Math.floor(cx - rad)); x < Math.min(W * 2, cx + rad); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 < rad * rad) d[y * W * 2 + x] = v;
  }
  return { w: W * 2, h: H * 2, d };
}
const big = texture();
function sample(g: Gray, x: number, y: number) {
  const x0 = Math.max(0, Math.min(g.w - 2, Math.floor(x))), y0 = Math.max(0, Math.min(g.h - 2, Math.floor(y)));
  const fx = x - x0, fy = y - y0, i = y0 * g.w + x0;
  return (g.d[i] * (1 - fx) + g.d[i + 1] * fx) * (1 - fy) + (g.d[i + g.w] * (1 - fx) + g.d[i + g.w + 1] * fx) * fy;
}
/** View of the big texture: zoom z and pan (px, py), plus an optional moving square (real motion). */
function frame(z: number, px: number, py: number, blob?: { x: number; y: number }): Gray {
  const d = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = sample(big, W / 2 + px + (x - W / 2) / z + W / 2, H / 2 + py + (y - H / 2) / z + H / 2);
    if (blob && Math.abs(x - blob.x) < 40 && Math.abs(y - blob.y) < 40) v = 255 - v * 0.3;
    d[y * W + x] = v;
  }
  return { w: W, h: H, d };
}
const N = 30, FPS = 10;

describe("motion check (synthetic clips)", () => {
  it("calls a Ken Burns zoom + pan of a still 'camera_only'", () => {
    const r = analyzeFrames(Array.from({ length: N }, (_, i) => frame(1 + i * 0.006, i * 0.8, i * 0.4)), FPS);
    expect(r.verdict).toBe("camera_only");
  });
  it("calls a held still 'static'", () => {
    const f = frame(1, 0, 0);
    expect(analyzeFrames(Array.from({ length: N }, () => f), FPS).verdict).toBe("static");
  });
  it("calls an independently moving object over a panning background 'real_motion'", () => {
    const r = analyzeFrames(Array.from({ length: N }, (_, i) => frame(1, i * 0.5, 0, { x: 80 + i * 6, y: 300 + i * 3 })), FPS);
    expect(r.verdict).toBe("real_motion");
  });
  it("calls a cross-fade between two stills not real motion", () => {
    const a = frame(1, 0, 0), b = frame(1.3, 200, 150);
    const frames = Array.from({ length: N }, (_, i) => { const t = i / (N - 1); return { w: W, h: H, d: a.d.map((v, k) => v * (1 - t) + b.d[k] * t) }; });
    expect(analyzeFrames(frames, FPS).verdict).not.toBe("real_motion");
  });
  it("reports too few frames as invalid", () => {
    expect(analyzeFrames([frame(1, 0, 0)], FPS).verdict).toBe("invalid");
  });
});
