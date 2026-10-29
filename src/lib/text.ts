// Script text handling, ported from the Android app's core (TextUtils, Lexicon, ScriptAnalyzer).
// Rule-based and offline: no AI is involved in reading the script.

export type Language = "hi" | "en";
export type Mood = "calm" | "epic" | "dark" | "uplifting" | "sad" | "energetic";

const DEVANAGARI = /[ऀ-ॿ]/g;
const LATIN = /[A-Za-z]/g;
const isDeva = (c: string) => c >= "ऀ" && c <= "ॿ";

/** NFC-normalises, strips zero-width junk and collapses spaces. ZWJ/ZWNJ stay (they shape conjuncts). */
export function normalize(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\u200B\uFEFF\u00AD]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00A0]+/g, " ")
    .split("\n").map((l) => l.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function devanagariRatio(text: string): number {
  const d = text.match(DEVANAGARI)?.length ?? 0;
  const l = text.match(LATIN)?.length ?? 0;
  return d + l === 0 ? 0 : d / (d + l);
}

export const hasLetters = (s: string) => /[\p{L}ऀ-ॿ]/u.test(s);

/** Sentences end on । ॥ ? ! … and on a '.' that is not inside a number; blank lines also split. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.replace(/\n/g, " ");
    let sb = "";
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      sb += c;
      let end = "।॥?!…".includes(c);
      if (c === ".") end = !(i > 0 && /\d/.test(p[i - 1]) && i + 1 < p.length && /\d/.test(p[i + 1]));
      if (end) {
        while (i + 1 < p.length && "।॥?!.…\"'”’".includes(p[i + 1])) sb += p[++i];
        const s = sb.trim();
        if (s && hasLetters(s)) out.push(s);
        sb = "";
      }
    }
    const s = sb.trim();
    if (s && hasLetters(s)) out.push(s);
  }
  return out;
}

export function words(text: string): string[] {
  return text.split(/[\s,;:।॥?!.…"'“”‘’()[\]{}—–-]+/).map((w) => w.trim()).filter((w) => w && hasLetters(w));
}

export function splitClauses(sentence: string): string[] {
  const parts = sentence
    .split(/(?<=[,;:])\s+|\s+(?=(?:और|लेकिन|परंतु|किंतु|क्योंकि|जबकि|but|and then|because|while)\s)/)
    .map((s) => s?.trim() ?? "")
    .filter((s) => s && hasLetters(s));
  return parts.length ? parts : [sentence];
}

export function splitByWords(text: string, n: number): string[] {
  const ws = text.split(/\s+/).filter(Boolean);
  if (n <= 1 || ws.length < n * 2) return [text];
  const per = ws.length / n;
  return Array.from({ length: n }, (_, k) => ws.slice(Math.floor(k * per), k === n - 1 ? ws.length : Math.floor((k + 1) * per)).join(" "));
}

const hindiStop = new Set("है हैं था थे थी थीं हो होता होती होते होना हुआ हुई हुए का की के को में से पर ने तक और या भी ही तो कि यह ये वह वे इस उस इन उन इसकी उसकी इसके उसके इसका उसका एक कुछ सब सभी बहुत जो जब तब जहाँ वहाँ यहाँ कहाँ क्या क्यों कैसे लेकिन मगर क्योंकि अपने अपनी अपना हम मैं आप तुम उन्होंने इसमें उसमें जाता जाती जाते गया गई गए रहा रही रहे कर करता करती करते किया किए दिया लिया साथ बाद पहले नहीं अब फिर जैसे वाले वाली वाला द्वारा लिए लिये बीच आज".split(" "));
const englishStop = new Set("the a an and or but of to in on at for with by from is are was were be been being it its this that these those as into than then there their they them he she his her we our you your i my me not no so very can could will would has have had do does did which who whom what when where why how all also just about over more most some such only one today now every many much upon after before".split(" "));
export const isStopword = (w: string) => englishStop.has(w.toLowerCase()) || hindiStop.has(w);

export const moodWords: Record<Mood, Set<string>> = {
  epic: new Set("युद्ध विजय साम्राज्य महान शक्ति वीर योद्धा इतिहास राजा सेना गौरव war victory empire great power hero warrior history king army glory legend battle mighty".split(" ")),
  dark: new Set("रहस्य अंधेरा डर भय मौत मृत्यु खतरा भूत रात अपराध रहस्यमय mystery dark darkness fear death danger ghost night crime secret unknown horror".split(" ")),
  sad: new Set("दुख दर्द आँसू आंसू अकेला अकेले खो विदा त्रासदी शोक sad sorrow pain tears alone lost loss farewell tragedy grief".split(" ")),
  uplifting: new Set("आशा सपना सपने खुशी सफलता प्रेरणा उम्मीद प्रकाश रोशनी जीत सुंदर hope dream dreams joy success inspiration light beautiful achieve future happy".split(" ")),
  energetic: new Set("तेज़ तेज दौड़ रोमांच ऊर्जा उत्साह खेल रफ़्तार fast run race thrill energy excited sport speed action".split(" ")),
  calm: new Set("शांत शांति प्रकृति धीरे सुबह ध्यान नदी झील calm peace peaceful nature slowly morning meditation quiet gentle".split(" ")),
};

/** Hindi to English keywords: a fallback for video prompts when no translator is available. */
export const hindiToEnglish: Record<string, string> = Object.fromEntries(
  ("भारत:India हिंदुस्तान:India देश:country दुनिया:world पृथ्वी:Earth धरती:earth आकाश:sky आसमान:sky सूरज:sun सूर्य:sun चाँद:moon चांद:moon " +
    "तारे:stars अंतरिक्ष:space पहाड़:mountain पहाड़ों:mountains पर्वत:mountain हिमालय:Himalaya नदी:river नदियाँ:rivers गंगा:Ganga_river समुद्र:sea सागर:ocean झील:lake " +
    "जंगल:forest पेड़:tree फूल:flower खेत:farm_field खेतों:farm_fields गाँव:village गांव:village गाँवों:villages शहर:city शहरों:cities सड़क:road सड़कें:roads " +
    "रेगिस्तान:desert बारिश:rain बादल:clouds हवा:wind हवाएँ:winds आग:fire पानी:water बर्फ:snow मंदिर:temple किला:fort महल:palace राजा:king रानी:queen " +
    "सेना:army युद्ध:battle योद्धा:warrior इतिहास:history प्राचीन:ancient लोग:people बच्चे:children माँ:mother पिता:father परिवार:family किसान:farmer " +
    "किसानों:farmers आदमी:man औरत:woman महिला:woman लड़का:boy लड़की:girl दोस्त:friend घर:house रात:night सुबह:morning शाम:evening दिन:day " +
    "सूर्योदय:sunrise सूर्यास्त:sunset जानवर:animal शेर:lion बाघ:tiger हाथी:elephant घोड़ा:horse गाय:cow पक्षी:bird मोर:peacock मछली:fish " +
    "संगीत:music नृत्य:dance त्योहार:festival दीवाली:Diwali होली:Holi दीया:oil_lamp मानसून:monsoon झरने:waterfalls धान:rice_paddy बाढ़:flood " +
    "बूँदें:raindrops तट:coast घाटी:valley रास्ते:path यात्रा:journey प्रकृति:nature तूफान:storm बिजली:lightning गुफा:cave पुल:bridge")
    .split(" ").map((p) => { const [h, e] = p.split(":"); return [h, e.replace(/_/g, " ")]; }),
);

export function englishFor(word: string): string | undefined {
  if (hindiToEnglish[word]) return hindiToEnglish[word];
  for (const suf of ["ों", "ें", "ाओं", "ियों", "े", "ी", "ा"]) {
    if (word.length > suf.length + 1 && word.endsWith(suf)) {
      const base = hindiToEnglish[word.slice(0, -suf.length)];
      if (base) return base;
    }
  }
  const latin = [...word].every((c) => /\p{L}/u.test(c) && !isDeva(c));
  return latin && !isStopword(word) ? word.toLowerCase() : undefined;
}

export function detectMood(ws: string[]): Mood {
  let best: Mood = "calm"; let bestN = 0;
  for (const [m, set] of Object.entries(moodWords) as [Mood, Set<string>][]) {
    const n = ws.filter((w) => set.has(w.toLowerCase())).length;
    if (n > bestN) { best = m; bestN = n; }
  }
  return best;
}

export function topContentWords(ws: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const w of ws) {
    if (isStopword(w) || w.length < 2) continue;
    const key = isDeva(w[0]) ? w : w.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

export const WORDS_PER_SEC: Record<Language, number> = { hi: 2.5, en: 2.6 };

export interface ScriptAnalysis {
  text: string;
  language: Language;
  sentences: string[];
  wordCount: number;
  estimatedSec: number;
  subjectEn: string;
  title: string;
  mood: Mood;
  errors: string[];
  warnings: string[];
}

export function analyzeScript(raw: string): ScriptAnalysis {
  const text = normalize(raw);
  const sentences = splitSentences(text);
  const ws = words(text);
  const language: Language = devanagariRatio(text) >= 0.3 || ws.length === 0 ? "hi" : "en";
  const errors: string[] = [];
  const warnings: string[] = [];
  if (ws.length === 0) errors.push("The script is empty. Type or paste some text first.");
  else if (ws.length < 8) errors.push(`The script is too short (${ws.length} words). Write at least two full sentences.`);
  const estimatedSec = ws.length / WORDS_PER_SEC[language] + Math.max(0, sentences.length - 1) * 0.4;
  const subject = topContentWords(ws, 3);
  const subjectEn = [...new Set(subject.map(englishFor).filter(Boolean))].join(" ") || (language === "en" ? subject.join(" ") : "");
  const first = (sentences[0] ?? "").replace(/[।॥.?! ]+$/, "");
  const fw = first.split(" ").filter(Boolean);
  const title = fw.length === 0 ? subject[0] ?? "Untitled" : fw.length <= 7 ? first : fw.slice(0, 6).join(" ") + "…";
  if (estimatedSec > 600) warnings.push(`This script is about ${Math.round(estimatedSec / 60)} minutes of narration. That needs many AI clips; the free quota makes about 4 per day.`);
  return { text, language, sentences, wordCount: ws.length, estimatedSec, subjectEn, title, mood: detectMood(ws), errors, warnings };
}
