import type { Language, Mood } from "./text";
import type { MusicAnalysis } from "./beat";
import type { MotionReport } from "./motion";

export type Style = "cinematic" | "realistic" | "animation3d" | "stylized";
export type Aspect = "9:16" | "16:9";
export type CameraMove = "dolly-in" | "dolly-out" | "track-left" | "track-right" | "crane-up" | "tilt-down" | "static" | "handheld" | "orbit" | "aerial";
export type Transition = "cut" | "crossfade" | "fade-black" | "flash";
export type ShotStatus = "none" | "queued" | "generating" | "checking" | "done" | "failed" | "rejected";

export const STYLES: Record<Style, string> = {
  cinematic: "Cinematic film",
  realistic: "Photorealistic",
  animation3d: "3D animation",
  stylized: "Stylised 2D animation",
};

export const CAMERA_MOVES: Record<CameraMove, string> = {
  "dolly-in": "slow dolly-in towards the subject",
  "dolly-out": "slow dolly-out revealing the surroundings",
  "track-left": "camera tracks left alongside the subject",
  "track-right": "camera tracks right following the subject",
  "crane-up": "camera cranes up",
  "tilt-down": "camera tilts down",
  static: "locked-off static camera",
  handheld: "handheld camera, natural shake",
  orbit: "camera slowly orbits the subject",
  aerial: "aerial drone shot gliding forward",
};

/** Where a clip came from. Only "generated" clips count as AI video made by CineAI. */
export type ClipSource = "generated" | "imported-flow" | "imported-file";

export interface Clip {
  /** Key of the video Blob in IndexedDB. */
  blobId: string;
  source: ClipSource;
  provider: string;
  model: string;
  mode: "t2v" | "i2v" | "imported";
  prompt: string;
  seed: number;
  durationSec: number;
  width: number;
  height: number;
  createdAt: number;
  motion: MotionReport;
}

export interface Shot {
  id: string;
  /** Narration spoken over this shot (script movies). Never rewritten. */
  narration: string;
  /** Short human description shown on the storyboard card. */
  description: string;
  /** English video prompt sent to the provider. The user may edit it. */
  prompt: string;
  camera: CameraMove;
  transition: Transition;
  mood: Mood;
  /** Seconds of video to request from the provider. */
  clipSec: number;
  /** Image-to-video from the previous shot's last frame (keeps the scene continuous). */
  continueFromPrevious: boolean;
  status: ShotStatus;
  error?: string;
  clip?: Clip;
  // Music videos: fixed song times, relative to the start of the used song part.
  startSec?: number;
  endSec?: number;
  section?: string;
  /** Uses another shot's clip (by id) at [clipInSec], so fewer clips have to be generated. */
  reuseOf?: string;
  clipInSec?: number;
}

export interface Character { name: string; appearance: string }

export interface Project {
  id: string;
  kind: "movie" | "music";
  name: string;
  createdAt: number;
  updatedAt: number;
  style: Style;
  aspect: Aspect;
  seed: number;
  shots: Shot[];
  // Script-to-Movie
  script: string;
  language: Language;
  characters: Character[];
  setting: string;
  subtitles: boolean;
  /** Recorded or uploaded narration (Blob key). */
  narrationId?: string;
  // Music Video Studio
  songId?: string;
  songName?: string;
  musicPrompt?: string;
  music?: MusicAnalysis;
  songStart?: number;
  songEnd?: number;
  maxClips?: number;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newProject(kind: Project["kind"], name: string): Project {
  const now = Date.now();
  return {
    id: uid(), kind, name, createdAt: now, updatedAt: now, style: "cinematic", aspect: "9:16",
    seed: Math.floor(Math.random() * 2 ** 31), shots: [], script: "", language: "hi", characters: [], setting: "", subtitles: true,
    maxClips: 6,
  };
}

/** Timeline length of a shot. Music shots have fixed song times; movie shots last as long as their clip. */
export function shotDuration(s: Shot): number {
  if (s.startSec !== undefined && s.endSec !== undefined) return s.endSec - s.startSec;
  return s.clip?.durationSec ?? s.clipSec;
}

/** True only when every shot has a real-motion clip (its own or a reused one). */
export function readyToRender(p: Project): boolean {
  const byId = new Map(p.shots.map((s) => [s.id, s]));
  return p.shots.length > 0 && p.shots.every((s) => {
    const c = s.reuseOf ? byId.get(s.reuseOf)?.clip : s.clip;
    return c !== undefined && c.motion.verdict === "real_motion";
  });
}
