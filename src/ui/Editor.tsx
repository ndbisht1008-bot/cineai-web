import { useEffect, useRef, useState } from "react";
import { getBlob } from "../lib/db";
import { readyToRender, shotDuration, type Project } from "../lib/model";
import { credits, timeline, type Segment } from "../lib/edl";
import type { RenderResult } from "../lib/render";
import { fmtTime } from "./hooks";

/** Proportional strip of the edit: one block per shot, coloured by readiness. */
export function TimelineStrip({ project, current }: { project: Project; current?: number }) {
  const byId = new Map(project.shots.map((s) => [s.id, s]));
  const total = project.shots.reduce((t, s) => t + (project.kind === "music" ? shotDuration(s) : (s.clip?.durationSec ?? s.clipSec)), 0) || 1;
  return (
    <div className="flex h-10 w-full overflow-hidden rounded-lg border border-line" role="list" aria-label="Timeline">
      {project.shots.map((s, i) => {
        const c = s.reuseOf ? byId.get(s.reuseOf)?.clip : s.clip;
        const d = project.kind === "music" ? shotDuration(s) : (c?.durationSec ?? s.clipSec);
        const ok = c?.motion.verdict === "real_motion";
        return <div role="listitem" key={s.id} title={`Shot ${i + 1}: ${d.toFixed(1)} s${ok ? "" : " (no clip yet)"}`} style={{ width: `${(d / total) * 100}%` }}
          className={`border-r border-ink text-[10px] leading-10 text-center overflow-hidden ${i === current ? "bg-accent2 text-ink" : ok ? (s.reuseOf ? "bg-ok/40" : "bg-ok/70 text-ink") : "bg-line text-mute"}`}>{i + 1}</div>;
      })}
    </div>
  );
}

/** Plays the edit in real time: the clips in order, with the song or narration underneath. */
export function Preview({ project }: { project: Project }) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [cur, setCur] = useState<number>();
  const [t, setT] = useState(0);
  const stop = useRef(false);
  const segs = useRef<Segment[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>();
  useEffect(() => {
    const id = project.kind === "music" ? project.songId : project.narrationId;
    let u: string | undefined;
    if (id) void getBlob(id).then((b) => { if (b) { u = URL.createObjectURL(b); setAudioUrl(u); } });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [project.kind, project.songId, project.narrationId]);
  const ready = readyToRender(project);

  async function play() {
    stop.current = false;
    segs.current = timeline(project);
    const urls = new Map<string, string>();
    for (const s of segs.current) if (!urls.has(s.clipBlobId)) urls.set(s.clipBlobId, URL.createObjectURL((await getBlob(s.clipBlobId))!));
    const a = audio.current, v = video.current!;
    if (a) { a.currentTime = project.kind === "music" ? project.songStart ?? 0 : 0; void a.play(); }
    const t0 = performance.now();
    for (let i = 0; i < segs.current.length && !stop.current; i++) {
      const s = segs.current[i];
      setCur(i);
      v.src = urls.get(s.clipBlobId)!; v.currentTime = s.inSec; v.muted = true;
      await v.play().catch(() => {});
      while (!stop.current) {
        const now = (performance.now() - t0) / 1000;
        setT(now);
        if (now >= s.end) break;
        if (v.ended || v.currentTime >= s.clipDur - 0.05) v.pause(); // hold the last frame if the clip is shorter
        await new Promise((r) => requestAnimationFrame(r));
      }
    }
    v.pause(); a?.pause(); setCur(undefined);
    urls.forEach((u) => URL.revokeObjectURL(u));
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Preview</h3>
        <div className="flex gap-2">
          <button className="btn-ghost" disabled={!ready || cur !== undefined} onClick={() => void play()}>▶ Play edit</button>
          <button className="btn-ghost" disabled={cur === undefined} onClick={() => { stop.current = true; }}>■ Stop</button>
        </div>
      </div>
      {!ready && <p className="text-sm text-mute">The preview needs a real-motion clip for every shot.</p>}
      <div className={`relative mx-auto overflow-hidden rounded-lg bg-black ${project.aspect === "9:16" ? "aspect-[9/16] max-h-[60vh]" : "aspect-video w-full"}`}>
        <video ref={video} playsInline className="h-full w-full object-cover" />
        {cur !== undefined && project.kind === "movie" && project.subtitles && segs.current[cur]?.subtitle && (
          <p className="absolute inset-x-3 bottom-[8%] text-center font-[Noto_Sans_Devanagari] text-base font-semibold text-white [text-shadow:0_0_6px_#000]">{segs.current[cur].subtitle}</p>
        )}
        {cur !== undefined && <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 text-xs">Shot {cur + 1} · {fmtTime(t)}</span>}
      </div>
      {audioUrl && <audio ref={audio} src={audioUrl} preload="auto" />}
      <TimelineStrip project={project} current={cur} />
    </div>
  );
}

export function ExportPanel({ project }: { project: Project }) {
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<[number, string]>([0, ""]);
  const [res, setRes] = useState<RenderResult & { url: string }>();
  const [err, setErr] = useState("");
  const abort = useRef<AbortController | null>(null);
  const ready = readyToRender(project);
  const imported = project.shots.some((s) => s.clip && s.clip.source !== "generated");
  useEffect(() => () => { if (res) URL.revokeObjectURL(res.url); }, [res]);
  const safeName = project.name.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40) || "cineai";
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold">Export MP4</h3>
      <p className="text-sm text-mute">{project.aspect === "9:16" ? "720×1280" : "1280×720"}, 30 fps, made in this browser. Long films take a while; keep this tab open.
        {imported && " Clips you imported are named as imported in the credits."}</p>
      {!ready && <p className="text-sm text-accent">Export unlocks when every shot has a clip that passed the motion check.</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={!ready || busy} onClick={async () => {
          setBusy(true); setErr(""); setRes(undefined); abort.current = new AbortController();
          try {
            const { renderProject } = await import("../lib/render");
            const r = await renderProject(project, (f, m) => setProg([f, m]), abort.current.signal);
            setRes({ ...r, url: URL.createObjectURL(r.blob) });
          } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>Export film</button>
        {busy && <button className="btn-danger" onClick={() => abort.current?.abort()}>Cancel</button>}
        <button className="btn-ghost" disabled={!ready} onClick={() => {
          const u = URL.createObjectURL(new Blob([credits(project)], { type: "text/plain" }));
          Object.assign(document.createElement("a"), { href: u, download: `${safeName}_credits.txt` }).click();
          setTimeout(() => URL.revokeObjectURL(u), 1000);
        }}>Download credits</button>
      </div>
      {busy && <div><div className="h-2 overflow-hidden rounded bg-line"><div className="h-full bg-accent" style={{ width: `${prog[0] * 100}%` }} /></div><p className="mt-1 text-xs text-mute">{prog[1]}</p></div>}
      {err && <p className="text-sm text-bad">{err}</p>}
      {res && <div className="space-y-2">
        <video src={res.url} controls playsInline className={`mx-auto rounded-lg bg-black ${project.aspect === "9:16" ? "max-h-[60vh]" : "w-full"}`} />
        <a className="btn-primary" href={res.url} download={`${safeName}.mp4`}>Download MP4 ({(res.blob.size / 1e6).toFixed(1)} MB, {fmtTime(res.durationSec)})</a>
        <p className="text-xs text-mute">Video {res.videoCodec.toUpperCase()}{res.audioCodec ? `, audio ${res.audioCodec.toUpperCase()}` : ", no audio"}.</p>
      </div>}
    </div>
  );
}
