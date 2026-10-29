import { afterEach, describe, expect, it, vi } from "vitest";
import { findVideo, geminiProvider } from "../src/lib/providers/gemini";
import { mapSpaceError } from "../src/lib/providers/ltx";
import { decodeIdToken } from "../src/lib/auth";

describe("LTX error mapping (texts seen from Hugging Face)", () => {
  it("explains a negative anonymous quota without a fake reset time", () => {
    const e = mapSpaceError("You have exceeded your ZeroGPU quota (120s requested vs. -60s left). Try again in 0:00:00. Authenticate with a Hugging Face token for more quota", false);
    expect(e.kind).toBe("quota");
    expect(e.message).toMatch(/resets within 24 hours/);
    expect(e.retryInSec).toBeUndefined();
  });
  it("gives the reset time when Hugging Face states one", () => {
    const e = mapSpaceError("You have exceeded your ZeroGPU quota (120s requested vs. 30s left). Try again in 5:12:00.", true);
    expect(e.retryInSec).toBe(5 * 3600 + 12 * 60);
    expect(e.message).toMatch(/5 h 12 min/);
  });
  it("maps network and sleeping-Space errors", () => {
    expect(mapSpaceError("TypeError: Failed to fetch", false).kind).toBe("network");
    expect(mapSpaceError("Space is sleeping", false).kind).toBe("unavailable");
  });
});

describe("Gemini provider (mocked HTTP; no real paid call)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const req = { prompt: "a river", negativePrompt: "", mode: "t2v" as const, durationSec: 4, aspect: "9:16" as const, seed: 1 };

  it("finds the video in the documented response shape", () => {
    expect(findVideo({ steps: [{ type: "user_input" }, { type: "model_output", content: [{ type: "text" }, { type: "video", data: "AA==" }] }] })?.data).toBe("AA==");
  });
  it("sends the documented request and decodes inline video", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "completed", steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: btoa("mp4data") }] }] })));
    vi.stubGlobal("fetch", fetchMock);
    const r = await geminiProvider("KEY").generate(req, () => {}, new AbortController().signal);
    expect(await r.blob.text()).toBe("mp4data");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("KEY");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "gemini-omni-1.1-flash", input: "a river", response_format: { type: "video", aspect_ratio: "9:16" } });
  });
  it("reports a missing billing account clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"This model is not available on the free tier"}}', { status: 403 })));
    await expect(geminiProvider("KEY").generate(req, () => {}, new AbortController().signal)).rejects.toMatchObject({ kind: "billing" });
  });
  it("refuses to run without a key", async () => {
    await expect(geminiProvider("").generate(req, () => {}, new AbortController().signal)).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("Google Sign-In token decoding", () => {
  it("reads name, email and expiry from an ID token payload (Devanagari safe)", () => {
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ name: "रवि", email: "r@example.com", picture: "", exp: 2000000000 })))).replace(/=+$/, "");
    const u = decodeIdToken(`x.${payload}.y`);
    expect(u).toMatchObject({ name: "रवि", email: "r@example.com", expiresAt: 2000000000000 });
  });
});
