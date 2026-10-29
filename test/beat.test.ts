import { describe, expect, it } from "vitest";
import { analyzeMusic } from "../src/lib/beat";
import { beatTimes, fMeasure, makeSong, sectionStarts } from "./synth";

describe("music analysis (same checks as the Android BeatAnalyzerTest)", () => {
  for (const bpm of [85, 96, 128, 140]) {
    it(`finds tempo, beats and downbeats at ${bpm} BPM`, () => {
      const a = analyzeMusic(makeSong(bpm), 22050);
      expect(Math.abs(a.bpm - bpm)).toBeLessThan(bpm * 0.02);
      expect(fMeasure(a.beats, beatTimes(bpm))).toBeGreaterThan(0.9);
      expect(fMeasure(a.downbeats, beatTimes(bpm).filter((_, i) => i % 4 === 0), 0.1)).toBeGreaterThan(0.8);
    });
  }

  it("finds section boundaries within one bar and labels them", () => {
    const bpm = 96;
    const a = analyzeMusic(makeSong(bpm), 22050);
    const bar = (4 * 60) / bpm;
    const found = a.sections.slice(1).map((s) => s.startSec);
    for (const t of sectionStarts(bpm).slice(1)) expect(found.some((f) => Math.abs(f - t) <= bar + 0.05), `boundary near ${t}, found ${found}`).toBe(true);
    expect(found.length).toBeLessThanOrEqual(sectionStarts(bpm).length + 1);
    expect(a.sections[0].label).toBe("Intro");
    expect(a.sections[a.sections.length - 1].label).toBe("Outro");
    const loudest = a.sections.reduce((m, s) => (s.energy > m.energy ? s : m));
    expect(["Drop", "Chorus"]).toContain(loudest.label);
    expect(a.sections.some((s) => s.label === "Breakdown")).toBe(true);
    expect(a.impacts.some((t) => Math.abs(t - sectionStarts(bpm)[4]) < 1.5)).toBe(true);
  });

  it("works on a 44.1 kHz input with a silent lead-in", () => {
    const bpm = 110;
    const song = makeSong(bpm, 44100);
    const x = new Float32Array(song.length + 44100 * 3); x.set(song, 44100 * 3);
    const a = analyzeMusic(x, 44100);
    expect(Math.abs(a.bpm - bpm)).toBeLessThan(bpm * 0.02);
    expect(a.beats[0]).toBeGreaterThan(2.5);
  });

  it("rejects a song shorter than 5 s", () => {
    expect(() => analyzeMusic(new Float32Array(22050 * 3), 22050)).toThrow(/too short/);
  });
});
