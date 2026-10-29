// Google Gemini API video generation (Gemini Omni Flash, Interactions API), written from
// https://ai.google.dev/gemini-api/docs/omni (read 29 Oct 2026). PAID ONLY: Google lists no free tier
// (about US$0.10 per second of 720p video) and a Cloud Billing account is required.
// The user's own key is used from the browser; it is held in memory unless the user opts to save it.
// NOT TESTED end to end: this project has no paid key. See GOOGLE_AI_INTEGRATION.md.
import { PROVIDER_INFO } from "../settings";
import { ProviderError, type ClipRequest, type ClipResult, type Progress, type VideoProvider } from "./types";

export const GEMINI_MODEL = "gemini-omni-1.1-flash";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

async function b64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

interface Content { type: string; data?: string; uri?: string; mime_type?: string }
interface Interaction { status?: string; steps?: { type: string; content?: Content[] }[]; error?: { message?: string } }

export function findVideo(r: Interaction): Content | undefined {
  for (const s of r.steps ?? []) if (s.type === "model_output") for (const c of s.content ?? []) if (c.type === "video") return c;
  return undefined;
}

function mapHttp(status: number, text: string): ProviderError {
  const low = text.toLowerCase();
  if (status === 400 && low.includes("api key")) return new ProviderError("Google rejected the API key.", text, "auth");
  if (status === 403 || low.includes("billing") || low.includes("free tier")) return new ProviderError("This Google project cannot use video generation. It needs the paid tier (Cloud Billing enabled).", text, "billing");
  if (status === 429) return new ProviderError("Google's rate or spending limit was reached for this key.", text, "quota");
  if (status >= 500) return new ProviderError("Google's video service is having problems. Try again later.", text, "unavailable");
  return new ProviderError(`Google returned an error (HTTP ${status}).`, text, "invalid");
}

export function geminiProvider(apiKey: string): VideoProvider {
  return {
    info: PROVIDER_INFO.gemini,
    async generate(req: ClipRequest, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<ClipResult> {
      if (!apiKey) throw new ProviderError("No Google API key is set.", "", "auth");
      const input = req.mode === "i2v" && req.image
        ? [{ type: "image", data: await b64(req.image), mime_type: req.image.type || "image/jpeg" }, { type: "text", text: req.prompt }]
        : req.prompt;
      const body = {
        model: GEMINI_MODEL, input, store: false,
        response_format: { type: "video", aspect_ratio: req.aspect, resolution: "720p" },
        ...(req.mode === "i2v" ? { generation_config: { video_config: { task: "image_to_video" } } } : {}),
      };
      onProgress({ stage: "generating", message: "Google is generating the video (this can take a few minutes)" });
      let res: Response;
      try {
        res = await fetch(`${BASE}/interactions`, { method: "POST", signal, headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body) });
      } catch (e) {
        if (signal.aborted) throw new ProviderError("Cancelled. Google may still bill a generation that had already started.", "", "cancelled");
        throw new ProviderError("Cannot reach Google's API. Check the internet connection.", String(e), "network");
      }
      const text = await res.text();
      if (!res.ok) throw mapHttp(res.status, text);
      const json = JSON.parse(text) as Interaction;
      const video = findVideo(json);
      if (!video) throw new ProviderError("Google finished but returned no video.", text.slice(0, 300), "unavailable");
      onProgress({ stage: "downloading", message: "Downloading the clip" });
      let blob: Blob;
      if (video.data) {
        blob = new Blob([Uint8Array.from(atob(video.data), (c) => c.charCodeAt(0))], { type: video.mime_type ?? "video/mp4" });
      } else if (video.uri) {
        const id = video.uri.slice(video.uri.indexOf("files/") + 6);
        for (let i = 0; i < 60; i++) {
          const f = await fetch(`${BASE}/files/${id}`, { signal, headers: { "x-goog-api-key": apiKey } }).then((r) => r.json()) as { state?: string };
          if (f.state === "ACTIVE") break;
          if (f.state === "FAILED") throw new ProviderError("Google could not prepare the video file.", JSON.stringify(f), "unavailable");
          await new Promise((r) => setTimeout(r, 2000));
        }
        const dl = await fetch(`${BASE}/files/${id}:download?alt=media`, { signal, headers: { "x-goog-api-key": apiKey } });
        if (!dl.ok) throw mapHttp(dl.status, await dl.text());
        blob = await dl.blob();
      } else {
        throw new ProviderError("Google's answer had no video data.", text.slice(0, 300), "unavailable");
      }
      return { blob, seed: req.seed, provider: "gemini-omni-flash", model: GEMINI_MODEL };
    },
  };
}
