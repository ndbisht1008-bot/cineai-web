// On-device Hindi -> English translation with the browser's built-in Translator API (Chrome 138+
// on desktop). Video models need English prompts. Where the API is missing, the planner falls back
// to keywords and the user can edit each English prompt by hand. Nothing is sent to a server.

interface TranslatorApi {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<{ translate(t: string): Promise<string> }>;
}

function api(): TranslatorApi | undefined {
  return (globalThis as unknown as { Translator?: TranslatorApi }).Translator;
}

export async function translatorStatus(): Promise<"available" | "downloadable" | "unavailable"> {
  const t = api();
  if (!t) return "unavailable";
  try {
    const a = await t.availability({ sourceLanguage: "hi", targetLanguage: "en" });
    return a === "available" ? "available" : a === "downloadable" || a === "downloading" ? "downloadable" : "unavailable";
  } catch { return "unavailable"; }
}

/** Translates each sentence; returns an empty map when the browser cannot translate. */
export async function translateSentences(sentences: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const t = api();
  if (!t || (await translatorStatus()) === "unavailable") return out;
  const tr = await t.create({ sourceLanguage: "hi", targetLanguage: "en" });
  for (const s of sentences) out.set(s, (await tr.translate(s)).trim());
  return out;
}
