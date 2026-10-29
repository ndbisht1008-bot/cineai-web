import { useRef, useState } from "react";
import type { Project } from "../lib/model";
import type { Progress } from "../lib/providers/types";
import { loadSettings, PROVIDER_INFO, providerFor } from "../lib/settings";

export interface QueueState { busy: boolean; progress: Record<string, Progress>; log: string[] }

/** Runs the generation queue for some shots of the live project object. */
export function useQueue(live: { current: Project | null }, refresh: () => Promise<void>) {
  const [state, setState] = useState<QueueState>({ busy: false, progress: {}, log: [] });
  const abort = useRef<AbortController | null>(null);
  async function run(ids: string[]) {
    const p = live.current; if (!p) return;
    const settings = loadSettings();
    if (!settings.consent) { alert("Open Settings and confirm what is sent to the video service first."); location.hash = "/settings"; return; }
    const provider = await providerFor(settings);
    const { generateShots } = await import("../lib/generate");
    const n = p.shots.filter((s) => ids.includes(s.id) && !s.reuseOf).length;
    if (!provider.info.free && !confirm(`${provider.info.name}: ${n} clip(s) will be billed to your Google Cloud project (about US$0.10 per second of video). Continue?`)) return;
    abort.current = new AbortController();
    setState({ busy: true, progress: {}, log: [`Starting ${n} clip(s) with ${provider.info.name}.`] });
    const log = (m: string) => setState((s) => ({ ...s, log: [...s.log, m] }));
    try {
      await generateShots(p, ids, provider, {
        onShot: () => { void refresh(); },
        onProgress: (id, pr) => setState((s) => ({ ...s, progress: { ...s.progress, [id]: pr } })),
        onLog: log,
      }, abort.current.signal, refresh);
      const ok = p.shots.filter((s) => ids.includes(s.id) && s.status === "done").length;
      log(`Finished: ${ok} of ${n} clip(s) accepted.`);
    } catch (e) {
      log(`Stopped: ${(e as Error).message}`);
    } finally {
      await refresh();
      setState((s) => ({ ...s, busy: false }));
    }
  }
  return { state, run, cancel: () => abort.current?.abort() };
}

export function QueuePanel({ project, q }: { project: Project; q: ReturnType<typeof useQueue> }) {
  const owners = project.shots.filter((s) => !s.reuseOf);
  const missing = owners.filter((s) => !(s.clip && s.clip.motion.verdict === "real_motion"));
  const info = PROVIDER_INFO[loadSettings().provider];
  const perDay = info.free ? 4 : Infinity;
  return (
    <div className="space-y-3">
      <div className="card space-y-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><b>{owners.length - missing.length}</b> of <b>{owners.length}</b> clips ready · source: <b>{info.name}</b></div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={q.state.busy || missing.length === 0} onClick={() => q.run(missing.map((s) => s.id))}>
              Generate {missing.length} missing clip{missing.length === 1 ? "" : "s"}
            </button>
            {q.state.busy && <button className="btn-danger" onClick={q.cancel}>Cancel</button>}
          </div>
        </div>
        <p className="text-xs text-mute">{info.limits}{info.free && missing.length > perDay ? ` At about ${perDay} clips a day this needs about ${Math.ceil(missing.length / perDay)} days; finished clips are kept, so just come back and press Generate again.` : ""}</p>
        <p className="text-xs text-mute">Every clip is checked: it must decode and pass the real-motion test. A still picture with zoom or pan is rejected, and there is no fallback to images.</p>
      </div>
      <ul className="space-y-1.5">
        {owners.map((s) => {
          const pr = q.state.progress[s.id];
          const active = s.status === "generating" || s.status === "checking";
          return (
            <li key={s.id} className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-sm">
              <span className="w-14 shrink-0 text-mute">Shot {project.shots.indexOf(s) + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate">{s.description}</div>
                {active && pr && <div className="text-xs text-accent">{pr.message}{pr.etaSec ? ` · about ${Math.round(pr.etaSec)} s` : ""}</div>}
                {s.error && !active && <div className="truncate text-xs text-bad" title={s.error}>{s.error}</div>}
                {active && <div className="mt-1 h-1 overflow-hidden rounded bg-line"><div className="h-full bg-accent transition-all" style={{ width: `${Math.round((pr?.fraction ?? (pr?.stage === "queued" ? 0.05 : 0.3)) * 100)}%` }} /></div>}
              </div>
              <span className={`shrink-0 text-xs ${s.status === "done" ? "text-ok" : s.status === "failed" || s.status === "rejected" ? "text-bad" : "text-mute"}`}>{s.status}</span>
            </li>
          );
        })}
      </ul>
      {q.state.log.length > 0 && <pre className="max-h-48 overflow-auto rounded-lg border border-line bg-ink p-3 text-xs whitespace-pre-wrap text-mute">{q.state.log.join("\n")}</pre>}
    </div>
  );
}
