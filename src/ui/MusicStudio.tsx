import { useRef, useState } from "react";
import { analyzeSong } from "../lib/analyzeSong";
import { putBlob } from "../lib/db";
import { STYLES, uid, type Aspect, type Style } from "../lib/model";
import { describeTreatment, planMusicVideo, treatment } from "../lib/musicPlan";
import { ExportPanel, Preview } from "./Editor";
import { fmtTime, useBlobUrl, useProject } from "./hooks";
import { ShotCard, Tabs, Waveform } from "./parts";
import { QueuePanel, useQueue } from "./Queue";

type Tab = "song" | "shots" | "generate" | "edit";

export function MusicStudio({ id }: { id: string }) {
  const { project: p, update, refresh, live } = useProject(id);
  const [tab, setTab] = useState<Tab>("song");
  const q = useQueue(live, refresh);
  const [analyzing, setAnalyzing] = useState<number>();
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const songUrl = useBlobUrl(p?.songId);
  if (p === undefined) return <p className="text-mute">Loading…</p>;
  if (p === null) return <p>Project not found.</p>;
  const m = p.music;
  const start = p.songStart ?? 0, end = p.songEnd || m?.durationSec || 0;
  const busy = q.state.busy;

  async function upload(f: File) {
    setErr(""); setAnalyzing(0);
    try {
      const music = await analyzeSong(f, setAnalyzing);
      const sid = uid(); await putBlob(sid, f);
      await update((x) => { x.songId = sid; x.songName = f.name; x.music = music; x.songStart = 0; x.songEnd = Math.min(music.durationSec, 60); x.shots = []; if (x.name.startsWith("Untitled")) x.name = f.name.replace(/\.[^.]+$/, ""); });
    } catch (e) { setErr(`Could not analyse this file: ${(e as Error).message}`); }
    setAnalyzing(undefined);
  }

  /** Moves the cut at the start of shot i to the previous/next beat; shot i-1 and i change length. */
  function nudge(i: number, dir: -1 | 1) {
    void update((x) => {
      if (!x.music || i === 0) return;
      const a = x.shots[i - 1], b = x.shots[i], off = x.songStart ?? 0;
      const beats = x.music.beats.map((t) => t - off);
      const cand = dir < 0 ? beats.filter((t) => t < b.startSec! - 0.02).pop() : beats.find((t) => t > b.startSec! + 0.02);
      if (cand === undefined || cand - a.startSec! < 0.5 || b.endSec! - cand < 0.5) return;
      a.endSec = cand; b.startSec = cand;
      for (const s of [a, b]) {
        const owner = s.reuseOf ? x.shots.find((o) => o.id === s.reuseOf)! : s;
        if ((s.clipInSec ?? 0) + s.endSec! - s.startSec! > owner.clipSec) { if (!owner.clip) owner.clipSec = Math.min(7, (s.clipInSec ?? 0) + s.endSec! - s.startSec! + 0.3); else s.clipInSec = Math.max(0, owner.clipSec - (s.endSec! - s.startSec!)); }
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input aria-label="Project name" className="field !w-auto min-w-0 flex-1 !text-lg font-semibold" value={p.name} onChange={(e) => void update((x) => { x.name = e.target.value; })} />
        <span className="chip">Music Video Studio</span>
      </div>
      <Tabs<Tab> tabs={[["song", "Song & concept"], ["shots", `Shot list (${p.shots.length})`], ["generate", "Generate"], ["edit", "Edit & export"]]} value={tab} onChange={setTab} />

      {tab === "song" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-3">
            <div className="card space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn-primary" disabled={analyzing !== undefined || busy} onClick={() => file.current?.click()}>{p.songId ? "Replace song…" : "Upload song (MP3 / WAV)…"}</button>
                <input ref={file} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.oga,.flac" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
                {p.songName && <span className="truncate text-sm">{p.songName}</span>}
              </div>
              {analyzing !== undefined && <div><div className="h-2 overflow-hidden rounded bg-line"><div className="h-full bg-accent2" style={{ width: `${analyzing * 100}%` }} /></div><p className="mt-1 text-xs text-mute">Analysing beats and sections on this device…</p></div>}
              {err && <p className="text-sm text-bad">{err}</p>}
              {m && <>
                <Waveform music={m} start={start} end={end} />
                <div className="flex flex-wrap gap-2 text-sm">
                  <span className="chip !text-text">{m.bpm} BPM {m.tempoConfidence < 0.3 && <span className="ml-1 text-accent">(unsure)</span>}</span>
                  <span className="chip">{m.beats.length} beats</span><span className="chip">{fmtTime(m.durationSec)}</span>
                  {m.sections.map((s, i) => <span key={i} className="chip">{s.label} {fmtTime(s.startSec)}</span>)}
                </div>
                <p className="text-xs text-mute">Sections are an estimate from loudness, brightness, bass and harmony; boundaries can be off by a bar.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label" htmlFor="ss">Use from (s)</label><input id="ss" type="number" className="field" min={0} step={0.5} value={start} onChange={(e) => void update((x) => { x.songStart = Math.max(0, +e.target.value); })} /></div>
                  <div><label className="label" htmlFor="se">to (s)</label><input id="se" type="number" className="field" min={5} step={0.5} value={end} onChange={(e) => void update((x) => { x.songEnd = Math.min(m.durationSec, +e.target.value); })} /></div>
                </div>
                {songUrl && <audio src={songUrl} controls className="w-full" />}
              </>}
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="mp">Visual concept (English)</label>
              <textarea id="mp" className="field min-h-40" value={p.musicPrompt ?? ""} disabled={busy}
                placeholder="A powerful male performer rapping in the Himalayas at night, aerial mountain landscapes, a jeep racing along a dusty road, fire and smoke, aggressive camera."
                onChange={(e) => void update((x) => { x.musicPrompt = e.target.value; })} />
              {p.musicPrompt && <p className="mt-1 text-xs text-mute">{describeTreatment(treatment(p.musicPrompt))}</p>}
            </div>
            <div>
              <label className="label" htmlFor="st">Style</label>
              <select id="st" className="field" value={p.style} onChange={(e) => void update((x) => { x.style = e.target.value as Style; })}>
                {Object.entries(STYLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="ar">Aspect</label>
                <select id="ar" className="field" value={p.aspect} onChange={(e) => void update((x) => { x.aspect = e.target.value as Aspect; })}><option value="9:16">9:16</option><option value="16:9">16:9</option></select>
              </div>
              <div>
                <label className="label" htmlFor="mc">Unique clips</label>
                <input id="mc" type="number" min={1} max={40} className="field" value={p.maxClips ?? 6} onChange={(e) => void update((x) => { x.maxClips = Math.max(1, Math.min(40, +e.target.value || 1)); })} />
              </div>
            </div>
            <p className="text-xs text-mute">Shots that share a concept reuse one clip at different points, so a 1-minute video can be cut from a few clips. More unique clips = more variety, more quota.</p>
            <button className="btn-primary w-full" disabled={!m || !p.musicPrompt?.trim() || busy} onClick={() => {
              if (p.shots.some((s) => s.clip) && !confirm("Re-planning replaces the shot list and removes generated clips from this project. Continue?")) return;
              void update((x) => { x.shots = planMusicVideo(x.music!, x.musicPrompt!, x.style, x.maxClips ?? 6, x.songStart ?? 0, x.songEnd ?? 0); });
              setTab("shots");
            }}>Plan beat-synced shots →</button>
          </div>
        </div>
      )}

      {tab === "shots" && (p.shots.length === 0 ? <p className="card text-mute">Upload a song, describe the concept and press "Plan beat-synced shots".</p> : (
        <div className="space-y-3">
          {m && <Waveform music={m} start={start} end={end} />}
          <p className="text-sm text-mute">{p.shots.length} shots from {p.shots.filter((s) => !s.reuseOf).length} unique clips. Use ◀ beat / beat ▶ to move a cut by one beat.</p>
          <ul className="space-y-3">
            {p.shots.map((s, i) => (
              <ShotCard key={s.id} project={p} shot={s} index={i} busy={busy}
                onChange={(fn) => void update((x) => { fn(x.shots[i]); })}
                onNudge={(d) => nudge(i, d)}
                onRegenerate={() => { setTab("generate"); void q.run([s.id]); }} />
            ))}
          </ul>
        </div>
      ))}

      {tab === "generate" && <QueuePanel project={p} q={q} />}

      {tab === "edit" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Preview project={p} />
          <div className="space-y-4">
            <div className="card text-sm text-mute">The song is used unchanged (same tempo and pitch) from {fmtTime(start)} to {fmtTime(end)}, with a short fade at the end. Cuts fall on the beat grid shown in the shot list.</div>
            <ExportPanel project={p} />
          </div>
        </div>
      )}
    </div>
  );
}
