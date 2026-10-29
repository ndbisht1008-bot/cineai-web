// Browser media helpers built on Mediabunny (WebCodecs): probing, frame extraction, motion check.
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { analyzeFrames, SHORT_SIDE, type Gray, type MotionReport } from "./motion";

export interface VideoInfo { durationSec: number; width: number; height: number; fps: number }

async function openVideo(blob: Blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("The file has no video track.");
  return { input, track };
}

export async function probeVideo(blob: Blob): Promise<VideoInfo> {
  const { track } = await openVideo(blob);
  const durationSec = await track.computeDuration();
  const stats = await track.computePacketStats(120);
  return { durationSec, width: track.displayWidth, height: track.displayHeight, fps: stats.averagePacketRate || 24 };
}

function toGray(canvas: HTMLCanvasElement | OffscreenCanvas): Gray {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const { width: w, height: h } = canvas;
  const px = ctx.getImageData(0, 0, w, h).data;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2];
  return { w, h, d };
}

/** Decodes up to [max] frames, scaled so the short side is 360 px (the size the thresholds were calibrated at). */
export async function grayFrames(blob: Blob, max = 400): Promise<{ frames: Gray[]; info: VideoInfo }> {
  const info = await probeVideo(blob);
  const { track } = await openVideo(blob);
  const s = Math.min(1, SHORT_SIDE / Math.min(info.width, info.height));
  const sink = new CanvasSink(track, { width: Math.round((info.width * s) / 2) * 2, height: Math.round((info.height * s) / 2) * 2, fit: "fill", poolSize: 2 });
  const frames: Gray[] = [];
  for await (const c of sink.canvases()) {
    frames.push(toGray(c.canvas));
    if (frames.length >= max) break;
  }
  return { frames, info };
}

/** Checks that a clip is a valid video with real (not slideshow-like) motion. */
export async function checkMotion(blob: Blob): Promise<MotionReport> {
  try {
    const { frames, info } = await grayFrames(blob);
    return analyzeFrames(frames, info.fps, Math.round(info.durationSec * info.fps));
  } catch (e) {
    return { frames: 0, fps: 0, durationSec: 0, pairs: 0, movingPairs: 0, globalMotionPx: 0, peakResidual: 0, movingShare: 0, sceneCuts: 0, verdict: "invalid", reason: `The file could not be decoded: ${(e as Error).message}` };
  }
}

/** The last frame as a JPEG, for image-to-video continuation. */
export async function lastFrameJpeg(blob: Blob): Promise<Blob> {
  const { track } = await openVideo(blob);
  const dur = await track.computeDuration();
  const sink = new CanvasSink(track, { poolSize: 1 });
  const c = await sink.getCanvas(Math.max(0, dur - 0.05));
  if (!c) throw new Error("Could not read the last frame of the previous clip.");
  const canvas = c.canvas;
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode the frame."))), "image/jpeg", 0.92));
}

/** Codec of the first audio track, or null when the file has none. */
export async function audioCodecOf(blob: Blob): Promise<string | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  return (await input.getPrimaryAudioTrack())?.codec ?? null;
}
