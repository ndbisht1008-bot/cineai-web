import { useEffect, useState } from "react";
import { GOOGLE_CLIENT_ID } from "../lib/auth";
import { persistStorage } from "../lib/db";
import { loadSettings, PROVIDER_INFO, saveSettings, type Settings } from "../lib/settings";
import { translatorStatus } from "../lib/translate";

export function SettingsPage() {
  const [s, setS] = useState<Settings>(loadSettings);
  const [tr, setTr] = useState("checking");
  const [persisted, setPersisted] = useState<boolean>();
  useEffect(() => { void translatorStatus().then(setTr); void navigator.storage?.persisted?.().then(setPersisted).catch(() => {}); }, []);
  const set = (patch: Partial<Settings>) => { const n = { ...s, ...patch }; setS(n); saveSettings(n); };
  const ltx = PROVIDER_INFO.ltx, gem = PROVIDER_INFO.gemini;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="card space-y-4">
        <h2 className="font-semibold">AI video source</h2>
        {([["ltx", ltx], ["gemini", gem]] as const).map(([id, info]) => (
          <label key={id} className={`block cursor-pointer rounded-lg border p-3 ${s.provider === id ? "border-accent" : "border-line"}`}>
            <div className="flex items-center gap-2">
              <input type="radio" name="provider" checked={s.provider === id} onChange={() => set({ provider: id, consent: false })} />
              <b>{info.name}</b>
              <span className={`chip ${info.free ? "!text-ok" : "!text-bad"}`}>{info.free ? "₹0" : "paid"}</span>
            </div>
            <p className="mt-1 text-sm text-mute">{info.limits}</p>
            <p className="mt-1 text-xs text-mute">{info.license}</p>
          </label>
        ))}

        {s.provider === "ltx" && (
          <div>
            <label className="label" htmlFor="hf">Free Hugging Face token (optional)</label>
            <input id="hf" className="field" type="password" autoComplete="off" placeholder="hf_…" value={s.hfToken} onChange={(e) => set({ hfToken: e.target.value.trim() })} />
            <p className="mt-1 text-xs text-mute">Without a token the anonymous quota is about 2 GPU-minutes a day per internet connection (about 4 clips). A free token from huggingface.co/settings/tokens (type "Read") gives about 5 (about 10 clips). It is sent only to Hugging Face.</p>
          </div>
        )}
        {s.provider === "gemini" && (
          <div className="space-y-2">
            <div className="rounded-lg border border-bad/40 bg-bad/5 p-3 text-sm">
              <b className="text-bad">This costs money.</b> Google has no free tier for video generation. Each clip is billed to your Google Cloud
              project (about US$0.10 per second of 720p video, so roughly US$6 / ₹500 for one minute of film). Google AI Pro / Flow credits do
              <b> not</b> pay for this. You need a Gemini API key from a project with Cloud Billing enabled.
            </div>
            <label className="label" htmlFor="gk">Your Gemini API key</label>
            <input id="gk" className="field" type="password" autoComplete="off" placeholder="AIza…" value={s.geminiKey} onChange={(e) => set({ geminiKey: e.target.value.trim() })} />
            <p className="text-xs text-mute">Keys used in a browser can be seen by anyone with access to this device. Restrict the key in Google Cloud Console
              (APIs &amp; Services → Credentials): allow only the Generative Language API and only this site's address as HTTP referrer, and set a budget alert.
              CineAI sends it only to generativelanguage.googleapis.com. <b>Not tested end to end</b> (see GOOGLE_AI_INTEGRATION.md).</p>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={s.rememberKeys} onChange={(e) => set({ rememberKeys: e.target.checked })} />
          <span>Remember keys in this browser. Off: keys are forgotten when you close the tab.</span>
        </label>
        <label className="flex items-start gap-2 rounded-lg bg-panel2 p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={s.consent} onChange={(e) => set({ consent: e.target.checked })} />
          <span><b>I understand what is sent:</b> {(s.provider === "ltx" ? ltx : gem).dataSent} Scripts and songs stay in this browser; only the English shot prompts (and start frames) are sent.</span>
        </label>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold">Google Sign-In</h2>
        <p className="text-mute">Status: {GOOGLE_CLIENT_ID ? "configured" : "not configured by the site owner (SETUP.md explains the free setup)"}.</p>
        <p className="text-mute">Signing in shows your Google name in the app. It does <b>not</b> give access to Google Flow, Google AI Pro credits or the Gemini API, and
          it is not needed to use CineAI. Your projects stay in this browser either way.</p>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold">This browser</h2>
        <p>Hindi → English prompt translation on this device: <b>{tr === "available" ? "available" : tr === "downloadable" ? "available after a one-time download by the browser" : tr === "checking" ? "checking…" : "not available"}</b>.
          {tr === "unavailable" && " Prompts are then built from English keywords; edit each shot's English prompt for best results. Chrome on a computer (version 138+) has a built-in translator."}</p>
        <p>WebCodecs (needed for export): <b>{typeof VideoEncoder !== "undefined" ? "available" : "not available, use a current Chrome, Edge or Firefox"}</b></p>
        <div className="flex items-center gap-2">
          <span>Keep my projects when storage is low: <b>{persisted === undefined ? "unknown" : persisted ? "yes" : "not yet"}</b></span>
          {!persisted && <button className="btn-ghost !py-1 text-xs" onClick={async () => setPersisted(await persistStorage())}>Ask the browser</button>}
        </div>
      </section>
    </div>
  );
}
