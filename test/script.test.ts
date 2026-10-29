import { describe, expect, it } from "vitest";
import { planMovie, MAX_CLIP_SEC } from "../src/lib/planner";
import { analyzeScript, splitSentences, words } from "../src/lib/text";

const monsoon = `भारत का मानसून

हर साल जून के महीने में, दक्षिण-पश्चिम से नम हवाएँ भारत के तट पर पहुँचती हैं। आसमान में काले बादल छा जाते हैं, और पहली बारिश की बूँदें सूखी धरती को भिगो देती हैं।

किसानों के लिए यह सबसे बड़ा त्योहार है। खेतों में धान की रोपाई शुरू होती है, और गाँवों में उम्मीद लौट आती है।`;

describe("script analysis", () => {
  it("splits Hindi sentences on the danda and keeps decimals together", () => {
    expect(splitSentences("पहला वाक्य। दूसरा वाक्य? 3.5 किलो है।")).toEqual(["पहला वाक्य।", "दूसरा वाक्य?", "3.5 किलो है।"]);
  });
  it("detects Hindi and rejects too-short scripts", () => {
    expect(analyzeScript(monsoon).language).toBe("hi");
    expect(analyzeScript("बहुत छोटा").errors[0]).toMatch(/too short/);
  });
});

describe("movie planner", () => {
  const opt = { style: "cinematic" as const, characters: [], setting: "", seed: 7 };
  it("keeps every word of the script, in order, exactly once", () => {
    const { shots } = planMovie(monsoon, opt);
    expect(shots.map((s) => s.narration).join(" ").split(/\s+/).filter(Boolean)).toEqual(analyzeScript(monsoon).text.replace(/\n+/g, " ").split(/\s+/).filter(Boolean)
      .map((w, i, a) => (i === 2 && !/[।.]$/.test(w) && a[3] ? w + "।" : w)));
  });
  it("never asks for a clip longer than the provider allows, and continues long narration", () => {
    // 26 words, no commas or conjunctions: about 10 s of narration, more than one 7 s clip.
    const long = "रवि पहाड़ी रास्ते पर बहुत देर तक धीरे धीरे चलता रहा जहाँ ठंडी हवा पुराने देवदार के ऊँचे पेड़ों के बीच से लगातार बहती रहती थी।";
    const { shots } = planMovie(long + " " + long, opt);
    expect(shots.every((s) => s.clipSec <= MAX_CLIP_SEC && s.clipSec >= 2)).toBe(true);
    expect(shots.some((s) => s.continueFromPrevious)).toBe(true);
    expect(shots[0].continueFromPrevious).toBe(false);
    expect(shots.filter((s) => s.continueFromPrevious).every((s) => s.prompt.startsWith("The same shot continues"))).toBe(true);
  });
  it("uses translations when available and adds a named character's look", () => {
    const script = "रवि घर से निकला। रवि पहाड़ी रास्ते पर चलने लगा।";
    const translations = new Map([["रवि घर से निकला।", "Ravi stepped out of his house."], ["रवि पहाड़ी रास्ते पर चलने लगा।", "Ravi started walking on the hill path."]]);
    const { shots } = planMovie(script, { ...opt, translations, characters: [{ name: "रवि", appearance: "young man in a red jacket" }] });
    expect(shots[0].prompt).toContain("Ravi stepped out of his house");
    expect(shots[0].prompt).toContain("young man in a red jacket");
    expect(shots[0].prompt).toContain("one continuous shot");
  });
  it("falls back to English keywords when no translation exists", () => {
    const { shots } = planMovie(monsoon, opt);
    expect(shots.some((s) => /monsoon|clouds|rain|farmers|India/.test(s.prompt))).toBe(true);
    expect(words(shots[0].prompt).every((w) => !/[ऀ-ॿ]/.test(w))).toBe(true);
  });
});
