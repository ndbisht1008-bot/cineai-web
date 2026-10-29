import { describe, expect, it } from "vitest";
import { analyzeMusic } from "../src/lib/beat";
import { planMusicVideo, treatment } from "../src/lib/musicPlan";
import { makeSong } from "./synth";

const prompt = "Create a powerful hip-hop music video of a male performer rapping in the Himalayas at night, aerial mountain landscapes, a jeep racing along a dusty road, synchronize cuts with the beat and bass drops.";

describe("music video planner", () => {
  it("reads the treatment from the user's own words", () => {
    const t = treatment(prompt);
    expect(t.subject.toLowerCase()).toContain("performer");
    expect(t.night).toBe(true);
    expect([...t.motifs.keys()]).toEqual(expect.arrayContaining(["Performance", "Landscape", "Vehicle"]));
    expect(t.intensity).toBeGreaterThan(0.6);
  });

  const music = analyzeMusic(makeSong(96), 22050);
  const shots = planMusicVideo(music, prompt, "cinematic", 5);

  it("covers the song without gaps and cuts on the beat grid", () => {
    expect(shots[0].startSec).toBe(0);
    for (let i = 1; i < shots.length; i++) expect(shots[i].startSec).toBeCloseTo(shots[i - 1].endSec!, 6);
    expect(shots[shots.length - 1].endSec).toBeCloseTo(music.durationSec, 1);
    const grid = [0, ...music.beats, music.durationSec];
    const onGrid = shots.slice(1).filter((s) => grid.some((g) => Math.abs(g - s.startSec!) < 0.02)).length;
    expect(onGrid / (shots.length - 1)).toBeGreaterThan(0.9);
  });

  it("generates at most the clip budget and keeps every shot within its clip", () => {
    const owners = shots.filter((s) => !s.reuseOf);
    expect(owners.length).toBeLessThanOrEqual(5);
    for (const s of shots) {
      const o = s.reuseOf ? shots.find((x) => x.id === s.reuseOf)! : s;
      expect((s.clipInSec ?? 0) + (s.endSec! - s.startSec!)).toBeLessThanOrEqual(o.clipSec + 1e-6);
      expect(o.clipSec).toBeLessThanOrEqual(7);
    }
  });

  it("cuts faster in loud sections than in quiet ones", () => {
    const avg = (label: string) => { const xs = shots.filter((s) => s.section === label).map((s) => s.endSec! - s.startSec!); return xs.reduce((a, b) => a + b, 0) / xs.length; };
    expect(avg("Drop")).toBeLessThan(avg("Intro"));
    expect(shots[shots.length - 1].transition).toBe("fade-black");
  });
});
