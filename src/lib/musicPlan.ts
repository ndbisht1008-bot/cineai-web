// Music video shot list, ported from the Android app's MusicVideoPlanner.
import type { MusicAnalysis, MusicSection } from "./beat";
import { uid, type CameraMove, type Shot, type Style, type Transition } from "./model";
import { STYLE_WORDS } from "./planner";

export const MAX_SHOT_CLIP_SEC = 7;
const MIN_SHOT_SEC = 1;

export type Motif = "Performance" | "Landscape" | "Vehicle" | "People" | "Atmosphere" | "Detail";
const MOTIFS: Motif[] = ["Performance", "Landscape", "Vehicle", "People", "Atmosphere", "Detail"];

/** The visual concept read from the user's prompt. Everything comes from the prompt's own words. */
export interface Treatment { subject: string; setting: string; motifs: Map<Motif, string[]>; intensity: number; palette: string; camera: string; night: boolean }

const motifWords: Record<Motif, string[]> = {
  Performance: ["perform", "rapper", "rap", "singer", "sing", "lyrics", "dancer", "dance", "choreograph", "artist", "vocal", "musician", "band", "performance"],
  Landscape: ["landscape", "aerial", "mountain", "himalaya", "valley", "sky", "cloud", "river", "sea", "ocean", "forest", "desert", "peak", "vista", "drone", "sunrise", "sunset"],
  Vehicle: ["vehicle", "car", "bike", "motorcycle", "motorbike", "truck", "jeep", "train", "bus", "drive", "driving", "road", "riding"],
  People: ["people", "crowd", "group", "friends", "villagers", "audience", "children", "gang", "family"],
  Atmosphere: ["night", "rain", "fire", "smoke", "fog", "mist", "neon", "lights", "lantern", "storm", "snow", "shadow"],
  Detail: ["close-up", "closeup", "hands", "eyes", "face", "detail", "jewel"],
};
const editingWords = ["synchron", "edit", "beat", "rhythm", "bass", "cut ", "cuts", "drop", "tempo", "bpm", "transition"];
const subjectNouns = ["performer", "rapper", "singer", "dancer", "man", "woman", "girl", "boy", "artist", "musician", "band", "hero", "couple"];

export function treatment(prompt: string): Treatment {
  const p = prompt.replace(/\n/g, " ").trim();
  const low = p.toLowerCase();
  const subjM = new RegExp(`((?:[A-Za-z-]+\\s){0,3}(?:${subjectNouns.join("|")}))s?\\b`, "i").exec(p);
  const subject = (subjM?.[1] ?? "").trim().split(" ").filter((_, i, a) => !(a.slice(0, i + 1).every((x) => ["a", "an", "the", "show", "of", "with", "and"].includes(x.toLowerCase())))).join(" ");
  const setM = /(?:set in|located in|in the|in)\s+((?:the\s)?[A-Za-z][A-Za-z\s-]{2,40}?)(?=[,.]|\s(?:show|with|and|at|during)\b|$)/i.exec(p);
  const setting = (setM?.[1] ?? "").trim();
  const clauses = p.split(/[.;,]|\band\b|\b[Ss]how\b/).map((c) => c.trim()).filter((c) => c.split(" ").length >= 2 && !editingWords.some((w) => c.toLowerCase().includes(w)));
  const motifs = new Map<Motif, string[]>();
  for (const c of clauses) {
    const cl = c.toLowerCase();
    const m = MOTIFS.find((mo) => motifWords[mo].some((w) => cl.includes(w)));
    if (!m) continue;
    motifs.set(m, [...(motifs.get(m) ?? []), c.replace(/^[Cc]reate /, "")]);
  }
  if (subject && !motifs.has("Performance")) motifs.set("Performance", [`${subject} performing to the camera`]);
  if (motifs.size === 0) motifs.set("Atmosphere", [p.slice(0, 160)]);
  if (!motifs.has("Landscape") && setting) motifs.set("Landscape", [`wide view of ${setting}`]);
  const high = ["aggressive", "energetic", "fast", "intense", "hard", "powerful", "explosive", "hip-hop", "hip hop", "rap", "drill", "rock"];
  const calm = ["calm", "slow", "dreamy", "soft", "gentle", "peaceful", "romantic", "lo-fi", "lofi"];
  const intensity = Math.min(1, Math.max(0.1, 0.5 + 0.15 * high.filter((w) => low.includes(w)).length - 0.15 * calm.filter((w) => low.includes(w)).length));
  const palette = ["dark", "night", "neon", "golden", "warm", "cold", "moody", "vibrant", "black and white", "monochrome", "pastel", "gritty", "cinematic"].filter((w) => low.includes(w)).join(", ");
  const camera = ["aerial", "handheld", "tracking", "drone", "slow motion", "aggressive camera", "steadicam"].filter((w) => low.includes(w)).join(", ");
  return { subject, setting, motifs, intensity, palette, camera, night: low.includes("night") || low.includes("dark") };
}

export function describeTreatment(t: Treatment): string {
  return [`Subject: ${t.subject || "(none named)"}`, `Setting: ${t.setting || "(none named)"}`,
    `Energy: ${t.intensity > 0.66 ? "high" : t.intensity < 0.4 ? "calm" : "medium"}`, t.palette && `Look: ${t.palette}`,
    `Shot types: ${[...t.motifs.keys()].join(", ")}`].filter(Boolean).join(" · ");
}

function cameraFor(m: Motif, sec: MusicSection, tr: Treatment, i: number): string {
  const hi = sec.energy > 0.65 || sec.label === "Drop";
  const base = {
    Performance: hi ? ["handheld close-up, fast push-in", "low angle medium shot, camera circles the performer", "whip pan onto a medium shot"][i % 3]
      : ["medium shot, slow push-in", "tracking shot following the performer", "close-up, steady camera"][i % 3],
    Landscape: hi ? "fast aerial drone shot sweeping forward" : "slow aerial drone shot gliding over the terrain",
    Vehicle: hi ? "low tracking shot racing alongside the vehicle" : "wide tracking shot following the vehicle on the road",
    People: hi ? "handheld shot moving through the group" : "medium wide shot, slow dolly",
    Atmosphere: "slow cinematic dolly, atmospheric",
    Detail: "extreme close-up, shallow depth of field",
  }[m];
  return base + (tr.camera && i % 3 === 0 ? `, ${tr.camera}` : "");
}

function conceptPrompt(tr: Treatment, m: Motif, variant: number, sec: MusicSection, style: Style, camera: string): string {
  const lines = tr.motifs.get(m) ?? [];
  const what = lines[variant % Math.max(1, lines.length)] ?? m;
  const subject = m === "Performance" && tr.subject && !what.toLowerCase().includes(tr.subject.toLowerCase()) ? `${tr.subject}, ${what}` : what;
  const action = {
    Performance: sec.energy > 0.6 ? "performing energetically with expressive hand gestures, moving to the beat" : "delivering lyrics to the camera with calm intensity",
    Landscape: "clouds drifting, wind moving through the scenery",
    Vehicle: "moving fast along a winding road, dust and motion",
    People: "people moving together in rhythm",
    Atmosphere: "drifting smoke and flickering light",
    Detail: "subtle movement, light shifting",
  }[m];
  const where = tr.setting && !what.toLowerCase().includes(tr.setting.toLowerCase()) ? `in ${tr.setting}` : "";
  const look = [tr.palette, tr.night ? "night, dramatic artificial light" : ""].filter(Boolean).join(", ");
  return [camera, subject, action, where, look, STYLE_WORDS[style], "music video, one continuous shot"].filter(Boolean).join(", ");
}

/**
 * Builds the shot list: cuts on bar lines (every bar in loud sections, every 2–4 in quiet ones),
 * always at section starts and big energy rises. Shots that share a concept reuse one clip at a
 * different in-point, so at most [maxClips] clips are generated (the free quota allows few per day).
 */
export function planMusicVideo(music: MusicAnalysis, prompt: string, style: Style, maxClips: number, songStart = 0, songEnd = 0): Shot[] {
  const tr = treatment(prompt);
  const end = songEnd > songStart + 5 ? Math.min(songEnd, music.durationSec) : music.durationSec;
  const start = Math.min(Math.max(0, songStart), end - 5);
  const grid = (music.downbeats.length ? music.downbeats : music.beats).filter((t) => t > start + 0.3 && t < end - 0.3);
  let sections = music.sections.filter((s) => s.endSec > start && s.startSec < end).map((s) => ({ ...s, startSec: Math.max(s.startSec, start), endSec: Math.min(s.endSec, end) }));
  if (!sections.length) sections = [{ label: "Verse", startSec: start, endSec: end, energy: 0.5, bass: 0.2, repeatOf: -1 }];
  const gaps = music.downbeats.slice(1).map((d, i) => d - music.downbeats[i]).sort((a, b) => a - b);
  const barSec = gaps.length ? Math.min(6, Math.max(1, gaps[Math.floor(gaps.length / 2)])) : 2;

  type Cut = { t: number; sec: MusicSection };
  const cuts: Cut[] = [];
  sections.forEach((sec, si) => {
    cuts.push({ t: sec.startSec, sec });
    const e = sec.energy * 0.7 + tr.intensity * 0.3;
    const bars = sec.label === "Outro" || sec.label === "Intro" || sec.label === "Breakdown" ? 4 : e > 0.72 ? 1 : e > 0.45 ? 2 : 4;
    let lastCut = sec.startSec, n = 0, k = 0;
    for (const b of grid.filter((t) => t > sec.startSec + 0.5 && t < sec.endSec - 0.5)) {
      k++;
      const want = bars === 1 && n % 4 === 3 ? 2 : bars;
      if (k % want !== 0 && b - lastCut < MAX_SHOT_CLIP_SEC - barSec) continue;
      if (b - lastCut < Math.max(MIN_SHOT_SEC, barSec * 0.9 * Math.min(bars, want))) continue;
      cuts.push({ t: b, sec }); lastCut = b; n++; k = 0;
    }
    if (si === sections.length - 1) cuts.push({ t: sec.endSec, sec });
  });
  for (const imp of music.impacts) {
    if (imp <= start + 1 || imp >= end - 1 || cuts.some((c) => Math.abs(c.t - imp) < 0.6)) continue;
    const sec = sections.find((s) => imp >= s.startSec && imp < s.endSec);
    if (sec) cuts.push({ t: imp, sec });
  }
  const seen = new Set<number>();
  const sorted = cuts.sort((a, b) => a.t - b.t).filter((c) => { const key = Math.round(c.t * 100); if (seen.has(key)) return false; seen.add(key); return true; });

  const spans: { a: number; b: number; sec: MusicSection }[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    let s = a.t;
    while (b.t - s > MAX_SHOT_CLIP_SEC) {
      const inGrid = grid.filter((t) => t > s + MIN_SHOT_SEC && t <= s + MAX_SHOT_CLIP_SEC);
      const m = inGrid.length ? Math.max(...inGrid) : s + MAX_SHOT_CLIP_SEC;
      spans.push({ a: s, b: m, sec: a.sec }); s = m;
    }
    if (b.t - s >= MIN_SHOT_SEC * 0.5) spans.push({ a: s, b: b.t, sec: a.sec });
    else if (spans.length) spans[spans.length - 1].b = b.t;
  }

  // Concepts: how many clip variants each motif gets, performance first.
  const per = new Map<Motif, number>();
  let budget = Math.max(1, maxClips);
  const pri = [...tr.motifs.keys()].sort((a, b) => (a === "Performance" ? 0 : 1) - (b === "Performance" ? 0 : 1));
  while (budget > 0) {
    let added = false;
    for (const m of pri) {
      const cap = Math.max(1, (tr.motifs.get(m)?.length ?? 0) + (m === "Performance" ? 2 : 1));
      if (budget > 0 && (per.get(m) ?? 0) < cap) { per.set(m, (per.get(m) ?? 0) + 1); budget--; added = true; }
    }
    if (!added) break;
  }
  const prefer: Record<string, Motif[]> = {
    Intro: ["Landscape", "Atmosphere", "Performance"], Outro: ["Landscape", "Atmosphere", "Performance"],
    Breakdown: ["Atmosphere", "Landscape", "Detail", "Performance"],
    Chorus: ["Performance", "People", "Performance", "Vehicle"],
    Drop: ["Performance", "Vehicle", "People", "Performance", "Landscape"],
    Verse: ["Performance", "Vehicle", "Landscape", "Performance", "People", "Detail"],
  };
  const motifFor = (sec: MusicSection, k: number): Motif => {
    const p = prefer[sec.label].filter((m) => per.has(m));
    return p.length ? p[k % p.length] : [...per.keys()][0];
  };

  const owner = new Map<string, Shot>();
  const uses = new Map<string, number>();
  const shots: Shot[] = [];
  let kIn = 0; let lastSec: MusicSection | undefined;
  spans.forEach(({ a, b, sec }, i) => {
    if (sec !== lastSec) { kIn = 0; lastSec = sec; }
    const motif = motifFor(sec, kIn++);
    const variants = per.get(motif) ?? 1;
    const variant = sec.label === "Chorus" ? kIn % Math.max(1, Math.min(2, variants)) : (i + kIn) % variants;
    const key = `${motif}:${variant}`;
    const own = owner.get(key);
    const u = uses.get(key) ?? 0; uses.set(key, u + 1);
    const dur = b - a;
    const cam = cameraFor(motif, sec, tr, i);
    const next = spans[i + 1];
    const transition: Transition = i === spans.length - 1 ? "fade-black"
      : next && next.sec !== sec ? (next.sec.label === "Drop" ? "flash" : next.sec.label === "Breakdown" || next.sec.label === "Outro" ? "crossfade" : "cut") : "cut";
    const lines = tr.motifs.get(motif) ?? [];
    const shot: Shot = {
      id: uid(), narration: "",
      description: `${sec.label} · ${motif}: ${lines[variant % Math.max(1, lines.length)] ?? motif}`,
      prompt: conceptPrompt(tr, motif, variant, sec, style, cam),
      camera: (sec.energy > 0.6 ? "handheld" : "dolly-in") as CameraMove,
      transition, mood: tr.night ? "dark" : sec.energy > 0.6 ? "energetic" : "calm",
      clipSec: dur, continueFromPrevious: false, status: "none",
      startSec: a - start, endSec: b - start, section: sec.label,
      reuseOf: own?.id, clipInSec: own ? Math.max(0, (u * 1.7) % Math.max(0.1, MAX_SHOT_CLIP_SEC - dur)) : 0,
    };
    shots.push(shot);
    if (!own) owner.set(key, shot);
  });
  // A clip must cover every use of it: its length is the longest (in-point + shot) among its users.
  for (const o of shots.filter((s) => !s.reuseOf)) {
    const users = [o, ...shots.filter((s) => s.reuseOf === o.id)];
    o.clipSec = Math.round(Math.min(MAX_SHOT_CLIP_SEC, Math.max(...users.map((s) => (s.clipInSec ?? 0) + (s.endSec! - s.startSec!))) + 0.3) * 10) / 10;
    for (const s of users) if (s !== o && (s.clipInSec ?? 0) + (s.endSec! - s.startSec!) > o.clipSec) s.clipInSec = 0;
  }
  return shots;
}
