// Assembles the finished film in the browser: decodes each clip (WebCodecs via Mediabunny), draws
// frames with transitions and subtitles on a canvas, mixes the audio, encodes H.264/AAC (or VP9/Opus
// where the browser lacks those encoders) into an MP4. No server is involved.
import {
  ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output,
  QUALITY_HIGH, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
} from "mediabunny";
import { getBlob } from "./db";
import type { Project } from "./model";
import { timeline } from "./edl";

export const OUTPUT_SIZE = { "9:16": [720, 1280], "16:9": [1280, 720] } as const;
const FPS = 30;
const XFADE = 0.5;

function wrap(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []; let line = "";
  for (const w of text.split(/\s+/)) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out.slice(-3);
}

function drawCover(ctx: OffscreenCanvasRenderingContext2D, src: HTMLCanvasElement | OffscreenCanvas, W: number, H: number) {
  const s = Math.max(W / src.width, H / src.height);
  const w = src.width * s, h = src.height * s;
  ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
}

export interface RenderResult { blob: Blob; videoCodec: string; audioCodec: string | null; durationSec: number }

/** Audio: the song (music videos) or the narration recording (movies), cut to the film's length. */
async function mixAudio(p: Project, durationSec: number): Promise<AudioBuffer | null> {
  const id = p.kind === "music" ? p.songId : p.narrationId;
  const blob = id ? await getBlob(id) : undefined;
  if (!blob) return null;
  const tmp = new AudioContext();
  const src = await tmp.decodeAudioData(await blob.arrayBuffer());
  void tmp.close();
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(durationSec * sr), sr);
  const node = ctx.createBufferSource(); node.buffer = src;
  const gain = ctx.createGain(); node.connect(gain).connect(ctx.destination);
  const fade = Math.min(1.5, durationSec / 4);
  gain.gain.setValueAtTime(1, Math.max(0, durationSec - fade));
  gain.gain.linearRampToValueAtTime(0, durationSec);
  node.start(0, p.kind === "music" ? p.songStart ?? 0 : 0);
  return ctx.startRendering();
}

export async function renderProject(p: Project, onProgress: (f: number, msg: string) => void, signal: AbortSignal): Promise<RenderResult> {
  if (typeof VideoEncoder === "undefined") throw new Error("This browser cannot encode video (no WebCodecs). Use a current Chrome, Edge or Firefox.");
  const segs = timeline(p);
  const duration = segs[segs.length - 1].end;
  const [W, H] = OUTPUT_SIZE[p.aspect];
  const videoCodec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width: W, height: H });
  if (!videoCodec) throw new Error("This browser has no usable video encoder for MP4.");
  onProgress(0, "Preparing audio");
  const audio = await mixAudio(p, duration);
  const audioCodec = audio ? await getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: 2, sampleRate: 48000 }) : null;
  if (audio && !audioCodec) throw new Error("This browser has no usable audio encoder for MP4.");

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d")!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const vsrc = new CanvasSource(canvas, { codec: videoCodec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(vsrc, { frameRate: FPS });
  const asrc = audio && audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null;
  if (asrc) output.addAudioTrack(asrc);
  await output.start();

  // One frame iterator per segment, created when the segment first becomes visible.
  type Iter = AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null, void, unknown>;
  const iters = new Map<number, Iter>();
  const last = new Map<number, HTMLCanvasElement | OffscreenCanvas>();
  const totalFrames = Math.round(duration * FPS);
  const visStart = (i: number) => segs[i].start - (i > 0 && segs[i - 1].transitionOut === "crossfade" ? XFADE : 0);
  async function frameOf(i: number) {
    let it = iters.get(i);
    if (!it) {
      const s = segs[i];
      const input = new Input({ source: new BlobSource((await getBlob(s.clipBlobId))!), formats: ALL_FORMATS });
      const track = (await input.getPrimaryVideoTrack())!;
      const sink = new CanvasSink(track, { poolSize: 3 });
      const vs = visStart(i);
      const times: number[] = [];
      for (let f = Math.ceil(vs * FPS - 1e-6); f / FPS < s.end; f++) times.push(Math.min(s.clipDur - 0.5 / FPS, s.inSec + Math.max(0, f / FPS - vs)));
      it = sink.canvasesAtTimestamps(times) as Iter;
      iters.set(i, it);
    }
    const r = await it.next();
    if (!r.done && r.value) last.set(i, r.value.canvas);
    return last.get(i);
  }

  const fontPx = Math.round(W * 0.045);
  const fontLoaded = document.fonts?.load?.(`600 ${fontPx}px "Noto Sans Devanagari"`).catch(() => undefined);
  await fontLoaded;
  for (let f = 0; f < totalFrames; f++) {
    if (signal.aborted) { await output.cancel(); throw new Error("Export cancelled."); }
    const t = f / FPS;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    const active = segs.map((_, i) => i).filter((i) => t >= visStart(i) - 1e-6 && t < segs[i].end);
    for (const i of active) {
      const fr = await frameOf(i);
      if (!fr) continue;
      const s = segs[i];
      ctx.globalAlpha = t < s.start ? (t - visStart(i)) / XFADE : 1;
      drawCover(ctx, fr, W, H);
      ctx.globalAlpha = 1;
    }
    // Transitions that act on a single segment.
    const cur = segs.find((s) => t >= s.start && t < s.end);
    if (cur) {
      const toEnd = cur.end - t;
      if (cur.transitionOut === "fade-black" && toEnd < XFADE) { ctx.fillStyle = `rgba(0,0,0,${1 - toEnd / XFADE})`; ctx.fillRect(0, 0, W, H); }
      const prev = segs[segs.indexOf(cur) - 1];
      const sinceStart = t - cur.start;
      if (prev?.transitionOut === "fade-black" && sinceStart < XFADE) { ctx.fillStyle = `rgba(0,0,0,${1 - sinceStart / XFADE})`; ctx.fillRect(0, 0, W, H); }
      if (prev?.transitionOut === "flash" && sinceStart < 0.2) { ctx.fillStyle = `rgba(255,255,255,${0.85 * (1 - sinceStart / 0.2)})`; ctx.fillRect(0, 0, W, H); }
      if (cur.subtitle) {
        ctx.font = `600 ${fontPx}px "Noto Sans Devanagari", "Noto Sans", sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        const lines = wrap(ctx, cur.subtitle, W * 0.86);
        const lh = fontPx * 1.45, y0 = H * 0.9 - (lines.length - 1) * lh;
        lines.forEach((ln, k) => {
          ctx.lineWidth = fontPx * 0.18; ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.lineJoin = "round";
          ctx.strokeText(ln, W / 2, y0 + k * lh); ctx.fillStyle = "#fff"; ctx.fillText(ln, W / 2, y0 + k * lh);
        });
      }
    }
    await vsrc.add(t, 1 / FPS);
    if (f % 15 === 0) onProgress(f / totalFrames, `Rendering frame ${f + 1} of ${totalFrames}`);
  }
  for (const it of iters.values()) await it.return?.();
  if (asrc && audio) { onProgress(0.98, "Encoding audio"); await asrc.add(audio); }
  await output.finalize();
  const buf = output.target.buffer!;
  onProgress(1, "Done");
  return { blob: new Blob([buf], { type: "video/mp4" }), videoCodec, audioCodec, durationSec: duration };
}

