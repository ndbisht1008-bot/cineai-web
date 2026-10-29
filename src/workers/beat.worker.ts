// Runs the music analysis off the main thread so the page stays responsive.
import { analyzeMusic } from "../lib/beat";

self.onmessage = (e: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  try {
    const r = analyzeMusic(e.data.samples, e.data.sampleRate, 600, (f) => self.postMessage({ type: "progress", f }));
    self.postMessage({ type: "done", result: r });
  } catch (err) {
    self.postMessage({ type: "error", message: (err as Error).message });
  }
};
