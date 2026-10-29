import { useEffect, useRef, useState } from "react";
import { putBlob } from "../lib/db";
import { decodeAudio } from "../lib/audio";
import { STYLES, uid, type Aspect, type Style } from "../lib/model";
import { planMovie } from "../lib/planner";
import { analyzeScript } from "../lib/text";
import { translateSentences, translatorStatus } from "../lib/translate";
import { ExportPanel, Preview } from "./Editor";
import { fmtTime, useBlobUrl, useProject } from "./hooks";
import { ShotCard, Tabs } from "./parts";
import { QueuePanel, useQueue } from "./Queue";

type Tab = "script" | "board" | "generate" | "edit";

export function MovieStudio({ id }: { id: string }) {
  const { project: p, update, refresh, live } = useProject(id);
  const [tab, setTab] = useState<Tab>("script");
  const q = useQueue(live, refresh);
  const [planning, setPlanning] = useState("");
  const [tr, setTr] = useState<string>();
  useEffect(() => { void translatorStatus().then(setTr); }, []);
  if (p === undefined) return <p className="text-mute">Loading…</p>;
  if (p === null) return <p>Project not found.</p>;
  const analysis = analyzeScript(p.script);
  const busy = q.state.busy;

  async function plan() {
    if (!p) return;
    if (p.shots.some((s) => s.clip) && !confirm("Re-planning replaces the storyboard. Clips already generated will be removed from this project. Continue?")) return;
    setPlanning("Translating the script to English on this device…");
    let translations: Map<string, string> | undefined;
    try { if (analysis.language === "hi") translations = await translateSentences(analysis.sentences); } catch { translations = undefined; }
    setPlanning("");
    const { shots } = planMovie(p.script, { style: p.style, characters: p.characters, setting: p.setting, seed: p.seed, translations });
    await update((x) => { x.shots = shots; x.language = analysis.language; if (x.name.startsWith("Untitled")) x.name = analysis.title; });
    setTab("board");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input aria-label="Project name" className="field !w-auto min-w-0 flex-1 !text-lg font-semibold" value={p.name} onChange={(e) => void update((x) => { x.name = e.target.value; })} />
        <span className="chip">Script to Movie</span>
      </div>
      <Tabs<Tab> tabs={[["script", "Script"], ["board", `Storyboard (${p.shots.length})`], ["generate", "Generate"], ["edit", "Edit & export"]]} value={tab} onChange={setTab} />

      {tab === "script" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-2">
            <label className="label" htmlFor="script">Script (Hindi or English)</label>
            <textarea id="script" className="field min-h-[50vh] font-[Noto_Sans_Devanagari] !text-base leading-relaxed" value={p.script} disabled={busy}
              placeholder="पहाड़ों के बीच एक छोटा सा गाँव था। एक सुबह रवि अपने घर से निकला…" onChange={(e) => void update((x) => { x.script = e.target.value; })} />
            <p className="text-xs text-mute">{analysis.wordCount} words · {analysis.language === "hi" ? "Hindi" : "English"} · about {fmtTime(analysis.estimatedSec)} of narration
              {analysis.wordCount > 0 && <> · about {Math.max(1, Math.ceil(analysis.estimatedSec / 6))} clip{Math.ceil(analysis.estimatedSec / 6) > 1 ? "s" : ""}</>}</p>
            {[...analysis.errors, ...analysis.warnings].map((m) => <p key={m} className="text-sm text-accent">{m}</p>)}
          </div>
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="style">Visual style</label>
              <select id="style" className="field" value={p.style} onChange={(e) => void update((x) => { x.style = e.target.value as Style; })}>
                {Object.entries(STYLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="aspect">Aspect ratio</label>
              <select id="aspect" className="field" value={p.aspect} onChange={(e) => void update((x) => { x.aspect = e.target.value as Aspect; })}>
                <option value="9:16">9:16 vertical (phone, Shorts, Reels)</option><option value="16:9">16:9 widescreen</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="setting">Setting, in English (optional)</label>
              <input id="setting" className="field" placeholder="a Himalayan village in Uttarakhand" value={p.setting} onChange={(e) => void update((x) => { x.setting = e.target.value; })} />
            </div>
            <div className="space-y-2">
              <span className="label">Characters (for a consistent look)</span>
              {p.characters.map((c, i) => (
                <div key={i} className="flex gap-1.5">
                  <input aria-label="Name as written in the script" className="field !w-24" placeholder="रवि" value={c.name} onChange={(e) => void update((x) => { x.characters[i].name = e.target.value; })} />
                  <input aria-label="Appearance in English" className="field" placeholder="young man, red jacket, short black hair" value={c.appearance} onChange={(e) => void update((x) => { x.characters[i].appearance = e.target.value; })} />
                  <button aria-label="Remove character" className="text-mute hover:text-bad" onClick={() => void update((x) => { x.characters.splice(i, 1); })}>✕</button>
                </div>
              ))}
              <button className="btn-ghost text-xs" onClick={() => void update((x) => { x.characters.push({ name: "", appearance: "" }); })}>+ Add character</button>
              <p className="text-xs text-mute">The appearance is added to every shot whose narration names the character. Video models keep a look only roughly; continuation shots help.</p>
            </div>
            <p className="text-xs text-mute">English prompts: {tr === "available" || tr === "downloadable" ? "the script is translated on this device." : "this browser cannot translate, so prompts start from English keywords. Edit them in the storyboard for best results."}</p>
            <button className="btn-primary w-full" disabled={busy || analysis.errors.length > 0 || !!planning} onClick={() => void plan()}>{planning || "Plan storyboard →"}</button>
          </div>
        </div>
      )}

      {tab === "board" && (p.shots.length === 0 ? <p className="card text-mute">Write the script and press "Plan storyboard" first.</p> : (
        <ul className="space-y-3">
          {p.shots.map((s, i) => (
            <ShotCard key={s.id} project={p} shot={s} index={i} busy={busy}
              onChange={(fn) => void update((x) => { fn(x.shots[i]); })}
              onMove={(d) => void update((x) => { const [m] = x.shots.splice(i, 1); x.shots.splice(i + d, 0, m); x.shots[0].continueFromPrevious = false; })}
              onDelete={() => void update((x) => { x.shots.splice(i, 1); if (x.shots[0]) x.shots[0].continueFromPrevious = false; })}
              onRegenerate={() => { setTab("generate"); void q.run([s.id]); }} />
          ))}
          <li><button className="btn-ghost" onClick={() => void update((x) => { x.shots.push({ ...structuredClone(x.shots[x.shots.length - 1]), id: uid(), narration: "", clip: undefined, status: "none", error: undefined, continueFromPrevious: false, description: "New shot" }); })}>+ Add shot</button></li>
        </ul>
      ))}

      {tab === "generate" && <QueuePanel project={p} q={q} />}

      {tab === "edit" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Preview project={p} />
          </div>
          <div className="space-y-4">
            <Narration narrationId={p.narrationId} filmSec={p.shots.reduce((t, s) => t + (s.clip?.durationSec ?? s.clipSec), 0)}
              onSet={(nid) => void update((x) => { x.narrationId = nid; })} />
            <label className="card flex items-center gap-2 text-sm">
              <input type="checkbox" checked={p.subtitles} onChange={(e) => void update((x) => { x.subtitles = e.target.checked; })} />
              Burn in subtitles from the script (each shot shows its own narration)
            </label>
            <ExportPanel project={p} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Narration: record with the microphone or upload an audio file. Browser text-to-speech cannot be recorded into a file. */
function Narration({ narrationId, filmSec, onSet }: { narrationId?: string; filmSec: number; onSet: (id: string | undefined) => void }) {
  const url = useBlobUrl(narrationId);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [len, setLen] = useState<number>();
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  async function store(b: Blob) {
    try { const buf = await decodeAudio(b); setLen(buf.duration); } catch { setErr("This audio file cannot be decoded by the browser."); return; }
    const nid = uid(); await putBlob(nid, b); onSet(nid);
  }
  return (
    <div className="card space-y-2">
      <h3 className="font-semibold">Narration</h3>
      <p className="text-xs text-mute">Record yourself reading the script, or upload a voice-over (MP3/WAV/M4A). It plays from the start of the film; the film is {fmtTime(filmSec)} long.</p>
      <div className="flex flex-wrap gap-2">
        {!rec ? <button className="btn-ghost" onClick={async () => {
          setErr("");
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const r = new MediaRecorder(stream); const chunks: Blob[] = [];
            r.ondataavailable = (e) => chunks.push(e.data);
            r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); void store(new Blob(chunks, { type: r.mimeType })); setRec(null); };
            r.start(); setRec(r);
          } catch { setErr("Microphone access was refused or is unavailable."); }
        }}>● Record</button> : <button className="btn-danger" onClick={() => rec.stop()}>■ Stop recording</button>}
        <button className="btn-ghost" onClick={() => file.current?.click()}>Upload audio…</button>
        {narrationId && <button className="btn-ghost" onClick={() => { onSet(undefined); setLen(undefined); }}>Remove</button>}
        <input ref={file} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void store(f); }} />
      </div>
      {url && <audio src={url} controls className="w-full" />}
      {len !== undefined && len > filmSec + 1 && <p className="text-xs text-accent">The narration ({fmtTime(len)}) is longer than the film ({fmtTime(filmSec)}); the end will be cut. Lengthen shots or add shots.</p>}
      {err && <p className="text-xs text-bad">{err}</p>}
    </div>
  );
}
