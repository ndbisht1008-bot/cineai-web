import { useEffect, useRef, useState } from "react";
import { currentUser, GOOGLE_CLIENT_ID, renderSignIn, signOut, type GoogleUser } from "../lib/auth";
import { Dashboard } from "./Dashboard";
import { go, useHashRoute } from "./hooks";
import { MovieStudio } from "./MovieStudio";
import { MusicStudio } from "./MusicStudio";
import { SettingsPage } from "./SettingsPage";
import { getProject } from "../lib/db";

function Account() {
  const [user, setUser] = useState<GoogleUser | null>(currentUser);
  const [err, setErr] = useState("");
  const btn = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (user || !btn.current || !GOOGLE_CLIENT_ID) return;
    renderSignIn(btn.current, setUser).catch((e: Error) => setErr(e.message));
  }, [user]);
  if (user) return (
    <div className="flex items-center gap-2">
      {user.picture && <img src={user.picture} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />}
      <span className="hidden text-sm sm:inline">{user.name}</span>
      <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { signOut(); setUser(null); }}>Sign out</button>
    </div>
  );
  if (!GOOGLE_CLIENT_ID) return <span className="chip whitespace-nowrap" title="The site owner has not set a Google OAuth client ID. See SETUP.md.">No sign-in</span>;
  return <div className="flex flex-col items-end"><div ref={btn} />{err && <span className="text-xs text-bad">{err}</span>}</div>;
}

function ProjectRoute({ id }: { id: string }) {
  const [kind, setKind] = useState<"movie" | "music" | null | undefined>();
  useEffect(() => { getProject(id).then((p) => setKind(p?.kind ?? null)); }, [id]);
  if (kind === undefined) return <p className="p-6 text-mute">Loading…</p>;
  if (kind === null) return <div className="p-6"><p>This project does not exist on this device.</p><button className="btn-ghost mt-3" onClick={() => go("/")}>Back</button></div>;
  return kind === "movie" ? <MovieStudio id={id} /> : <MusicStudio id={id} />;
}

export function App() {
  const route = useHashRoute();
  const pm = /^\/p\/([\w-]+)/.exec(route);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5">
          <a href="#/" className="flex shrink-0 items-center gap-2 whitespace-nowrap font-bold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-ink">▶</span>
            <span>CineAI <span className="hidden text-accent min-[400px]:inline">Studio</span></span>
          </a>
          <nav className="flex items-center gap-1 sm:gap-3">
            <a href="#/" className={`rounded-md px-2 py-1 text-sm ${route === "/" ? "text-text" : "text-mute hover:text-text"}`}>Projects</a>
            <a href="#/settings" className={`rounded-md px-2 py-1 text-sm ${route === "/settings" ? "text-text" : "text-mute hover:text-text"}`}>Settings</a>
            <Account />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">
        {pm ? <ProjectRoute id={pm[1]} /> : route === "/settings" ? <SettingsPage /> : <Dashboard />}
      </main>
    </div>
  );
}
