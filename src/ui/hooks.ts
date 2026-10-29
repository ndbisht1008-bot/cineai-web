import { useCallback, useEffect, useRef, useState } from "react";
import { getBlob, getProject, saveProject } from "../lib/db";
import type { Project } from "../lib/model";

export function useHashRoute(): string {
  const [hash, setHash] = useState(() => location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || "/");
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export const go = (path: string) => { location.hash = path; };

/** Loads a project and returns an updater that applies a change and saves it to IndexedDB. */
export function useProject(id: string) {
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const ref = useRef<Project | null>(null);
  useEffect(() => {
    let live = true;
    getProject(id).then((p) => { if (live) { ref.current = p ?? null; setProject(p ?? null); } });
    return () => { live = false; };
  }, [id]);
  const update = useCallback(async (fn: (p: Project) => void) => {
    const p = ref.current;
    if (!p) return;
    fn(p);
    const copy = structuredClone(p);
    ref.current = copy;
    setProject(copy);
    await saveProject(copy);
  }, []);
  /** For long jobs that mutate the live object: re-render and save without copying first. */
  const refresh = useCallback(async () => {
    if (!ref.current) return;
    const copy = structuredClone(ref.current);
    setProject(copy);
    await saveProject(copy);
  }, []);
  return { project, update, refresh, live: ref };
}

/** Object URL for a stored Blob, revoked when no longer used. */
export function useBlobUrl(id: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!id) { setUrl(undefined); return; }
    let u: string | undefined; let live = true;
    getBlob(id).then((b) => { if (b && live) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [id]);
  return url;
}

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
