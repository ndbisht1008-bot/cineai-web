// Script-to-Movie storyboard, ported from the Android app's ScenePlanner + VideoPromptBuilder (AI video mode).
import { CAMERA_MOVES, uid, type CameraMove, type Character, type Shot, type Style, type Transition } from "./model";
import { analyzeScript, detectMood, englishFor, splitByWords, splitClauses, topContentWords, words, WORDS_PER_SEC, type Mood, type ScriptAnalysis } from "./text";

/** Longest clip requested per shot. LTX on ZeroGPU charges the same quota up to 7 s, more above. */
export const MAX_CLIP_SEC = 7;
export const MIN_CLIP_SEC = 2;
const MAX_SEGMENT_SEC = 11;

const SHOT_CYCLE = ["wide establishing shot", "medium shot", "close-up shot", "medium wide shot", "over-the-shoulder shot", "low angle shot"];
const CALM_MOVES: CameraMove[] = ["dolly-in", "track-right", "dolly-out", "track-left", "crane-up", "dolly-in", "tilt-down"];

export const LIGHTING: Record<Mood, string> = {
  calm: "soft golden-hour light, calm atmosphere",
  epic: "dramatic light rays, epic scale",
  dark: "low-key moody lighting, mist, deep shadows",
  uplifting: "bright warm sunrise light, hopeful mood",
  sad: "overcast muted light, melancholic mood",
  energetic: "vivid contrasty light, energetic mood",
};

export const STYLE_WORDS: Record<Style, string> = {
  cinematic: "realistic cinematic film footage, 35mm, shallow depth of field, natural motion",
  realistic: "photorealistic video, sharp detail, natural colors, realistic motion",
  animation3d: "3D animated film, stylized characters, soft global illumination, smooth animation",
  stylized: "stylized 2D animation, painterly hand-drawn look, bold colors, fluid animation",
};

export function negativePrompt(style: Style): string {
  return "static image, still frame, frozen, slideshow, worst quality, blurry, jittery, distorted face, deformed hands, extra limbs, text, watermark, subtitles" +
    (style === "cinematic" || style === "realistic" ? ", cartoon, illustration" : ", photorealistic");
}

export function shotSize(i: number, n: number): string {
  if (i === 0) return "wide establishing shot";
  if (i === n - 1) return "slow wide shot";
  return SHOT_CYCLE[i % SHOT_CYCLE.length];
}

function trimWords(s: string, n: number) {
  return s.trim().split(/\s+/).slice(0, n).join(" ").replace(/[,.;।]+$/, "");
}

/** Characters whose name appears in the shot's narration or English content. */
export function charactersIn(narration: string, contentEn: string, characters: Character[]): Character[] {
  return characters.filter((c) => c.name.trim() && c.appearance.trim() &&
    (narration.toLowerCase().includes(c.name.toLowerCase()) || contentEn.toLowerCase().includes(c.name.toLowerCase())));
}

export interface PromptInput { size: string; camera: CameraMove; contentEn: string; narration: string; mood: Mood; style: Style; characters: Character[]; setting: string }

/** One shot, one subject, one action: video models follow that far better than several actions (measured). */
export function buildPrompt(p: PromptInput): string {
  const content = trimWords(p.contentEn, 35);
  const parts = [`${p.size}, ${CAMERA_MOVES[p.camera]}`, content];
  for (const c of charactersIn(p.narration, p.contentEn, p.characters)) parts.push(`${c.name}: ${c.appearance}`);
  if (p.setting && !content.toLowerCase().includes(p.setting.toLowerCase())) parts.push(`setting: ${p.setting}`);
  parts.push(LIGHTING[p.mood], STYLE_WORDS[p.style], "one continuous shot with natural movement");
  return parts.filter(Boolean).join(", ");
}

export function continuationPrompt(prompt: string): string {
  const rest = prompt.includes(", ") ? prompt.slice(prompt.indexOf(", ") + 2) : prompt;
  return "The same shot continues: " + trimWords(rest, 45);
}

/** English content for a piece of narration when no translation is available: its keywords. */
export function keywordContent(narration: string, subjectEn: string): string {
  const kw = [...new Set(topContentWords(words(narration), 5).map(englishFor).filter(Boolean))];
  return kw.length ? kw.join(", ") : subjectEn;
}

function transitionFor(i: number, n: number, mood: Mood): Transition {
  if (i === n - 1) return "fade-black";
  if (mood === "dark" || mood === "sad") return "fade-black";
  if (mood === "energetic") return "cut";
  return "crossfade";
}

export interface PlanOptions {
  style: Style;
  characters: Character[];
  setting: string;
  seed: number;
  /** English translation of each sentence of the script, when the browser can translate. */
  translations?: Map<string, string>;
}

/**
 * Turns a script into shots. Every word of the script appears in exactly one shot, in order.
 * A shot's narration that runs longer than one clip gets continuation shots (image-to-video from
 * the previous clip's last frame), so the picture keeps moving for the whole narration.
 */
export function planMovie(script: string, opt: PlanOptions): { analysis: ScriptAnalysis; shots: Shot[] } {
  const analysis = analyzeScript(script);
  if (analysis.errors.length) return { analysis, shots: [] };
  const wps = WORDS_PER_SEC[analysis.language];
  const est = (s: string) => words(s).length / wps;
  const hindi = analysis.language === "hi";

  const segments: string[] = [];
  for (const raw of analysis.sentences) {
    const s = /[।॥.?!…"'”’]$/.test(raw) ? raw : raw + (hindi ? "।" : ".");
    if (est(s) <= MAX_SEGMENT_SEC) { segments.push(s); continue; }
    for (const c of splitClauses(s)) {
      if (est(c) <= MAX_SEGMENT_SEC) segments.push(c);
      else segments.push(...splitByWords(c, Math.ceil(est(c) / MAX_SEGMENT_SEC)));
    }
  }

  // Short neighbouring sentences share a shot so that no shot is under 2 s.
  const groups: string[][] = [];
  for (const s of segments) {
    const last = groups[groups.length - 1];
    if (last && est(last.join(" ")) < MIN_CLIP_SEC + 0.5 && est(last.join(" ") + " " + s) <= MAX_CLIP_SEC) last.push(s);
    else groups.push([s]);
  }

  const offset = ((opt.seed % CALM_MOVES.length) + CALM_MOVES.length) % CALM_MOVES.length;
  const n = groups.length;
  const shots: Shot[] = [];
  groups.forEach((g, i) => {
    const narration = g.join(" ");
    const ws = words(narration);
    const mood = ws.some((w) => detectMood([w]) !== "calm") ? detectMood(ws) : analysis.mood;
    const translated = g.map((s) => opt.translations?.get(s)).filter(Boolean) as string[];
    const contentEn = translated.length === g.length ? translated.join(" ") : keywordContent(narration, analysis.subjectEn);
    const camera = i === 0 ? "dolly-in" : CALM_MOVES[(i + offset) % CALM_MOVES.length];
    const prompt = buildPrompt({ size: shotSize(i, n), camera, contentEn, narration, mood, style: opt.style, characters: opt.characters, setting: opt.setting });
    const total = Math.max(MIN_CLIP_SEC, est(narration) + 0.4);
    const parts = Math.ceil(total / MAX_CLIP_SEC);
    const narrParts = parts > 1 ? splitByWords(narration, parts) : [narration];
    for (let k = 0; k < parts; k++) {
      shots.push({
        id: uid(),
        narration: narrParts[k] ?? "",
        description: `${i === 0 ? "Opening" : i === n - 1 ? "Closing" : "Scene " + (i + 1)}${parts > 1 ? ` (part ${k + 1}/${parts})` : ""}: ${trimWords(contentEn, 12)}`,
        prompt: k === 0 ? prompt : continuationPrompt(prompt),
        camera, mood,
        transition: k < parts - 1 ? "cut" : transitionFor(i, n, mood),
        clipSec: Math.round(Math.min(MAX_CLIP_SEC, Math.max(MIN_CLIP_SEC, total / parts)) * 10) / 10,
        continueFromPrevious: k > 0,
        status: "none",
      });
    }
  });
  return { analysis, shots };
}
