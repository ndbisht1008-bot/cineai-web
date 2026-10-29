// LTX-Video (Lightricks) on a public Hugging Face ZeroGPU Space, called from the browser with the
// official Gradio JavaScript client. Real text-to-video and image-to-video. Free, limited by the
// daily ZeroGPU quota (per internet connection, or per Hugging Face account when a token is given).
import { Client, handle_file } from "@gradio/client";
import { PROVIDER_INFO } from "../settings";
import { ProviderError, type ClipRequest, type ClipResult, type Progress, type VideoProvider } from "./types";

export const LTX_SPACE = "Lightricks/ltx-video-distilled";
const SIZES = { "9:16": [512, 896], "16:9": [896, 512] } as const;

/** Turns Hugging Face / Gradio error text into a clear message. Exported for tests. */
export function mapSpaceError(text: string, withToken: boolean): ProviderError {
  const low = text.toLowerCase();
  if (low.includes("zerogpu quota") || (low.includes("exceeded your") && low.includes("quota"))) {
    const m = /try again in (\d+):(\d+):(\d+)/i.exec(text);
    const secs = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : undefined;
    const who = withToken ? "your Hugging Face account" : "anonymous users on this internet connection (about 2 GPU-minutes a day)";
    const when = secs && secs > 0 ? ` It resets in about ${Math.floor(secs / 3600)} h ${Math.floor((secs % 3600) / 60)} min.` : " It resets within 24 hours of the first use today.";
    return new ProviderError(`The free daily GPU quota for ${who} is used up.${when}` +
      (withToken ? "" : " A free Hugging Face token gives about 5 GPU-minutes a day."), text, "quota", secs && secs > 0 ? secs : undefined);
  }
  if (low.includes("401") || low.includes("invalid token") || low.includes("invalid credentials")) {
    return new ProviderError("Hugging Face rejected the token. Check it in Settings, or remove it to use the anonymous quota.", text, "auth");
  }
  if (low.includes("sleeping") || low.includes("building") || low.includes("paused") || low.includes("runtime_error") || low.includes("not found") || low.includes("404")) {
    return new ProviderError("The LTX-Video Space is not running right now. Try again later.", text, "unavailable");
  }
  if (low.includes("failed to fetch") || low.includes("networkerror") || low.includes("network")) {
    return new ProviderError("Cannot reach Hugging Face. Check the internet connection.", text, "network");
  }
  return new ProviderError("The video service reported an error: " + text.slice(0, 200), text, "unavailable");
}

export function ltxProvider(hfToken?: string): VideoProvider {
  const token = hfToken?.startsWith("hf_") ? (hfToken as `hf_${string}`) : undefined;
  return {
    info: PROVIDER_INFO.ltx,
    async generate(req: ClipRequest, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<ClipResult> {
      if (req.mode === "i2v" && !req.image) throw new ProviderError("Image-to-video needs a start image.", "", "invalid");
      onProgress({ stage: "connecting", message: "Connecting to the LTX-Video Space" });
      let client: Client;
      try {
        client = await Client.connect(LTX_SPACE, { events: ["data", "status"], ...(token ? { token } : {}) });
      } catch (e) {
        throw mapSpaceError(String((e as Error).message ?? e), !!token);
      }
      if (signal.aborted) throw new ProviderError("Cancelled.", "", "cancelled");
      const [w, h] = SIZES[req.aspect];
      const job = client.submit(req.mode === "i2v" ? "/image_to_video" : "/text_to_video", {
        prompt: req.prompt, negative_prompt: req.negativePrompt,
        input_image_filepath: req.mode === "i2v" ? handle_file(req.image!) : null,
        input_video_filepath: null, height_ui: h, width_ui: w,
        mode: req.mode === "i2v" ? "image-to-video" : "text-to-video",
        duration_ui: Math.round(Math.min(7, Math.max(1, req.durationSec)) * 10) / 10,
        ui_frames_to_use: 9, seed_ui: req.seed % 4294967295, randomize_seed: false,
        ui_guidance_scale: 1, improve_texture_flag: true,
      });
      const onAbort = () => { void job.cancel(); };
      signal.addEventListener("abort", onAbort);
      try {
        for await (const ev of job) {
          if (signal.aborted) throw new ProviderError("Cancelled.", "", "cancelled");
          if (ev.type === "status") {
            if (ev.stage === "error") throw mapSpaceError(typeof ev.message === "string" ? ev.message : JSON.stringify(ev.message ?? "unknown error"), !!token);
            if (ev.stage === "pending") onProgress({ stage: "queued", message: ev.position !== undefined ? `In the queue, position ${ev.position + 1}` : "Waiting for a free GPU", position: ev.position, etaSec: ev.eta });
            else if (ev.stage === "generating") {
              const pd = ev.progress_data?.[0];
              onProgress({ stage: "generating", message: "Generating video on the GPU", fraction: pd?.index != null && pd.length ? pd.index / pd.length : undefined, etaSec: ev.eta });
            }
          } else if (ev.type === "data") {
            const data = ev.data as [{ video?: { url?: string } } | null, number];
            const url = data?.[0]?.video?.url;
            if (!url) throw new ProviderError("The service finished but returned no video file.", JSON.stringify(ev.data).slice(0, 300), "unavailable");
            onProgress({ stage: "downloading", message: "Downloading the clip" });
            const res = await fetch(url, { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
            if (!res.ok) throw new ProviderError(`Could not download the clip (HTTP ${res.status}).`, url, "network");
            const blob = await res.blob();
            return { blob, seed: typeof data[1] === "number" ? data[1] : req.seed, provider: "ltx-video-distilled", model: "LTX-Video 13B 0.9.8 distilled" };
          }
        }
        throw new ProviderError("The service closed the connection without a result.", "", "unavailable");
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        if (signal.aborted) throw new ProviderError("Cancelled.", "", "cancelled");
        throw mapSpaceError(String((e as Error).message ?? e), !!token);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
