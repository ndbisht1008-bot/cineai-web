import type { Aspect } from "../model";

export interface ClipRequest {
  prompt: string;
  negativePrompt: string;
  mode: "t2v" | "i2v";
  /** Start frame for image-to-video. */
  image?: Blob;
  durationSec: number;
  aspect: Aspect;
  seed: number;
}

export interface Progress {
  stage: "connecting" | "queued" | "generating" | "downloading";
  message: string;
  position?: number;
  etaSec?: number;
  fraction?: number;
}

export interface ProviderInfo {
  id: string;
  name: string;
  model: string;
  /** False when every clip costs money. */
  free: boolean;
  maxClipSec: number;
  limits: string;
  dataSent: string;
  license: string;
}

export interface ClipResult { blob: Blob; seed: number; provider: string; model: string }

export interface VideoProvider {
  info: ProviderInfo;
  generate(req: ClipRequest, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<ClipResult>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly detail = "", readonly kind: "quota" | "network" | "unavailable" | "invalid" | "auth" | "cancelled" | "billing" = "unavailable", readonly retryInSec?: number) {
    super(message);
  }
}
