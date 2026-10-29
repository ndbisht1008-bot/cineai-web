// Provider settings. Keys stay in this tab's memory unless the user explicitly asks to remember
// them in this browser. They are only ever sent to the provider they belong to.
import type { ProviderInfo, VideoProvider } from "./providers/types";

export type ProviderId = "ltx" | "gemini";

export interface Settings {
  provider: ProviderId;
  hfToken: string;
  geminiKey: string;
  rememberKeys: boolean;
  /** The user has read what is sent to the provider. */
  consent: boolean;
}

const KEY = "cineai.settings";
let memory: Settings = { provider: "ltx", hfToken: "", geminiKey: "", rememberKeys: false, consent: false };

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Settings> | null;
    if (s) memory = { ...memory, ...s, hfToken: s.rememberKeys ? s.hfToken ?? memory.hfToken : memory.hfToken, geminiKey: s.rememberKeys ? s.geminiKey ?? memory.geminiKey : memory.geminiKey };
  } catch { /* storage unavailable: memory only */ }
  return { ...memory };
}

export function saveSettings(s: Settings) {
  memory = { ...s };
  const stored = s.rememberKeys ? s : { ...s, hfToken: "", geminiKey: "" };
  try { localStorage.setItem(KEY, JSON.stringify(stored)); } catch { /* memory only */ }
}

export const PROVIDER_INFO: Record<ProviderId, ProviderInfo> = {
  ltx: {
    id: "ltx-video-distilled", name: "LTX-Video (Hugging Face, free)", model: "LTX-Video 13B 0.9.8 distilled", free: true, maxClipSec: 7,
    limits: "About 4 clips a day per internet connection, about 10 with a free Hugging Face token. Each clip up to 7 s, 512×896.",
    dataSent: "The prompt and, for continuation shots, the previous clip's last frame go to Hugging Face and the Space owner (Lightricks).",
    license: "LTX-Video Open Weights License (free for personal use; check the terms before commercial use).",
  },
  gemini: {
    id: "gemini-omni-flash", name: "Google Gemini Omni Flash (paid, your key)", model: "gemini-omni-1.1-flash", free: false, maxClipSec: 10,
    limits: "Paid only: Google bills your Cloud project about US$0.10 per second of 720p video. No free tier.",
    dataSent: "The prompt and start image go to Google under your API key and Google's API terms.",
    license: "Output carries Google's invisible SynthID watermark.",
  },
};

/** Loads the provider code only when a clip is generated (keeps the first page load small). */
export async function providerFor(s: Settings): Promise<VideoProvider> {
  if (s.provider === "gemini") return (await import("./providers/gemini")).geminiProvider(s.geminiKey);
  return (await import("./providers/ltx")).ltxProvider(s.hfToken || undefined);
}
