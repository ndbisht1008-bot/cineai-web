import type { MusicAnalysis } from "./beat";
import { decodeAudio, mono } from "./audio";

/** Decodes the song in the browser and analyses it in a Web Worker. The file never leaves the device. */
export async function analyzeSong(blob: Blob, onProgress: (f: number) => void): Promise<MusicAnalysis> {
  const buf = await decodeAudio(blob);
  const samples = mono(buf);
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("../workers/beat.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ type: string; f?: number; result?: MusicAnalysis; message?: string }>) => {
      if (e.data.type === "progress") onProgress(e.data.f ?? 0);
      else { w.terminate(); if (e.data.type === "done") resolve(e.data.result!); else reject(new Error(e.data.message)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || "The analysis failed.")); };
    w.postMessage({ samples, sampleRate: buf.sampleRate }, [samples.buffer]);
  });
}
