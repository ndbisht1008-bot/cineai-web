// Runs clip generation for a project's shots, one at a time, and validates every result.
// A clip is accepted only if it decodes and passes the real-motion check. There is no fallback
// to still images: a shot without a valid clip stays failed and the film cannot be exported.
import { getBlob, putBlob } from "./db";
import { checkMotion, lastFrameJpeg, probeVideo } from "./media";
import { uid, type Project, type Shot } from "./model";
import { negativePrompt } from "./planner";
import { ProviderError, type Progress, type VideoProvider } from "./providers/types";

export interface QueueEvents {
  onShot(shot: Shot): void;
  onProgress(shotId: string, p: Progress): void;
  onLog(msg: string): void;
}

/** Errors that will fail every following shot too (shared quota, bad key): stop the queue. */
const STOPPING = new Set(["quota", "auth", "billing", "cancelled"]);
const MAX_TRIES = 2;

export async function generateShots(project: Project, ids: string[], provider: VideoProvider, ev: QueueEvents, signal: AbortSignal, save: () => Promise<void>): Promise<void> {
  const order = project.shots.filter((s) => ids.includes(s.id) && !s.reuseOf);
  for (const s of order) { s.status = "queued"; s.error = undefined; ev.onShot(s); }
  for (const shot of order) {
    if (signal.aborted) { shot.status = "none"; ev.onShot(shot); continue; }
    let image: Blob | undefined;
    if (shot.continueFromPrevious) {
      const prev = project.shots[project.shots.indexOf(shot) - 1];
      const prevBlob = prev?.clip ? await getBlob(prev.clip.blobId) : undefined;
      if (!prevBlob) {
        shot.status = "failed"; shot.error = "This shot continues the previous one. Generate the previous shot first."; ev.onShot(shot); await save(); continue;
      }
      image = await lastFrameJpeg(prevBlob);
    }
    let stop = false;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      shot.status = "generating"; ev.onShot(shot);
      const seed = (project.seed + project.shots.indexOf(shot) * 7919 + (attempt - 1) * 104729) % 2147483647;
      try {
        const res = await provider.generate({
          prompt: shot.prompt, negativePrompt: negativePrompt(project.style), mode: image ? "i2v" : "t2v", image,
          durationSec: Math.min(provider.info.maxClipSec, shot.clipSec), aspect: project.aspect, seed,
        }, (p) => ev.onProgress(shot.id, p), signal);
        shot.status = "checking"; ev.onShot(shot);
        ev.onProgress(shot.id, { stage: "downloading", message: "Checking the clip for real motion" });
        const motion = await checkMotion(res.blob);
        if (motion.verdict !== "real_motion") {
          ev.onLog(`Shot ${project.shots.indexOf(shot) + 1}: clip rejected (${motion.verdict}): ${motion.reason}`);
          shot.status = "rejected"; shot.error = `Rejected: ${motion.reason}`;
          if (attempt < MAX_TRIES) { ev.onLog("Trying once more with a new seed."); continue; }
          break;
        }
        const info = await probeVideo(res.blob);
        const blobId = uid();
        await putBlob(blobId, res.blob);
        shot.clip = {
          blobId, source: "generated", provider: res.provider, model: res.model, mode: image ? "i2v" : "t2v", prompt: shot.prompt,
          seed: res.seed, durationSec: info.durationSec, width: info.width, height: info.height, createdAt: Date.now(), motion,
        };
        shot.status = "done"; shot.error = undefined;
        break;
      } catch (e) {
        const pe = e instanceof ProviderError ? e : new ProviderError(String((e as Error)?.message ?? e));
        shot.status = pe.kind === "cancelled" ? "none" : "failed";
        shot.error = pe.kind === "cancelled" ? undefined : pe.message;
        ev.onLog(`Shot ${project.shots.indexOf(shot) + 1}: ${pe.message}${pe.detail ? ` (${pe.detail.slice(0, 160)})` : ""}`);
        stop = STOPPING.has(pe.kind);
        break;
      }
    }
    ev.onShot(shot);
    await save();
    if (stop) {
      for (const s of order) if (s.status === "queued") { s.status = "none"; ev.onShot(s); }
      break;
    }
  }
}

/** Adds the user's own video file as a shot's clip. It is labelled as imported, never as generated. */
export async function importClip(shot: Shot, file: Blob, source: "imported-flow" | "imported-file"): Promise<Shot> {
  const motion = await checkMotion(file);
  if (motion.verdict === "invalid") throw new Error(motion.reason);
  const info = await probeVideo(file);
  const blobId = uid();
  await putBlob(blobId, file);
  shot.clip = { blobId, source, provider: source === "imported-flow" ? "Google Flow (imported by you)" : "Your own file", model: "", mode: "imported", prompt: shot.prompt, seed: 0,
    durationSec: info.durationSec, width: info.width, height: info.height, createdAt: Date.now(), motion };
  shot.status = motion.verdict === "real_motion" ? "done" : "rejected";
  shot.error = motion.verdict === "real_motion" ? undefined : `Rejected: ${motion.reason}`;
  return shot;
}
