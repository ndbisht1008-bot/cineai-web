import { useEffect, useState } from "react";
import { deleteProject, listProjects, persistStorage, saveProject, storageEstimate } from "../lib/db";
import { newProject, readyToRender, type Project } from "../lib/model";
import { loadSettings, PROVIDER_INFO } from "../lib/settings";
import { fmtBytes, go } from "./hooks";
import { Thumb } from "./parts";

export function Dashboard() {
  const [projects, setProjects] = useState<Project[]>();
  const [storage, setStorage] = useState<{ used: number; quota: number } | null>(null);
  const provider = PROVIDER_INFO[loadSettings().provider];
  useEffect(() => { void listProjects().then(setProjects); void storageEstimate().then(setStorage); }, []);

  async function create(kind: Project["kind"]) {
    const p = newProject(kind, kind === "movie" ? "Untitled movie" : "Untitled music video");
    await saveProject(p);
    void persistStorage();
    go(`/p/${p.id}`);
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2">
        <button onClick={() => create("movie")} className="card group text-left transition hover:border-accent">
          <div className="text-xs font-semibold uppercase tracking-wider text-accent">Script to Movie</div>
          <div className="mt-1 text-lg font-semibold">Turn a Hindi or English script into a film</div>
          <p className="mt-1 text-sm text-mute">Storyboard, one AI video clip per shot, narration, subtitles, transitions, MP4 export.</p>
        </button>
        <button onClick={() => create("music")} className="card group text-left transition hover:border-accent2">
          <div className="text-xs font-semibold uppercase tracking-wider text-accent2">Music Video Studio</div>
          <div className="mt-1 text-lg font-semibold">Cut AI video clips to your song</div>
          <p className="mt-1 text-sm text-mute">Beat and section analysis on your device, beat-synced shot list, your song kept unchanged.</p>
        </button>
      </section>

      <section className="card flex flex-wrap items-center justify-between gap-3 text-sm">
        <div>
          <span className="text-mute">Video source: </span><b>{provider.name}</b>
          <p className="mt-0.5 text-xs text-mute">{provider.limits}</p>
        </div>
        <div className="flex gap-2">
          <a className="btn-ghost" href="#/settings">Change</a>
          <a className="btn-ghost" href="https://labs.google/flow" target="_blank" rel="noreferrer" title="Opens Google Flow in a new tab. Clips you make there stay in Flow; you can download one and import it into a shot.">Open Google Flow ↗</a>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Your projects</h2>
          {storage && <span className="text-xs text-mute">Stored in this browser: {fmtBytes(storage.used)} of {fmtBytes(storage.quota)}</span>}
        </div>
        {projects === undefined ? <p className="text-mute">Loading…</p> : projects.length === 0 ? (
          <p className="card text-sm text-mute">No projects yet. Projects and clips are saved in this browser only; nothing is uploaded.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const done = p.shots.filter((s) => !s.reuseOf && s.clip?.motion.verdict === "real_motion").length;
              const need = p.shots.filter((s) => !s.reuseOf).length;
              return (
                <li key={p.id} className="card flex gap-3">
                  <Thumb blobId={p.shots.find((s) => s.clip)?.clip?.blobId} />
                  <div className="min-w-0 flex-1">
                    <a href={`#/p/${p.id}`} className="block truncate font-semibold hover:text-accent">{p.name}</a>
                    <div className="text-xs text-mute">{p.kind === "movie" ? "Movie" : "Music video"} · {new Date(p.updatedAt).toLocaleString()}</div>
                    <div className="mt-1 text-xs">{need === 0 ? <span className="text-mute">Not planned yet</span>
                      : readyToRender(p) ? <span className="text-ok">All {need} AI clips ready</span>
                      : <span className="text-accent">{done} of {need} AI clips</span>}</div>
                  </div>
                  <button aria-label={`Delete ${p.name}`} className="self-start text-mute hover:text-bad" onClick={async () => {
                    if (!confirm(`Delete "${p.name}" and its clips from this browser?`)) return;
                    await deleteProject(p); setProjects(await listProjects());
                  }}>✕</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
