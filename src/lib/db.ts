// Local storage: projects and media Blobs in IndexedDB. Nothing is uploaded anywhere.
import { openDB, type IDBPDatabase } from "idb";
import type { Project } from "./model";

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  dbp ??= openDB("cineai", 1, {
    upgrade(d) {
      d.createObjectStore("projects", { keyPath: "id" });
      d.createObjectStore("blobs");
    },
  });
  return dbp;
}

export async function listProjects(): Promise<Project[]> {
  const all = (await (await db()).getAll("projects")) as Project[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function getProject(id: string) { return (await (await db()).get("projects", id)) as Project | undefined; }
export async function saveProject(p: Project) { p.updatedAt = Date.now(); await (await db()).put("projects", structuredClone(p)); }
export async function deleteProject(p: Project) {
  const d = await db();
  const ids = [p.narrationId, p.songId, ...p.shots.map((s) => s.clip?.blobId)].filter(Boolean) as string[];
  const tx = d.transaction(["projects", "blobs"], "readwrite");
  await Promise.all([tx.objectStore("projects").delete(p.id), ...ids.map((id) => tx.objectStore("blobs").delete(id)), tx.done]);
}
export async function putBlob(id: string, b: Blob) { await (await db()).put("blobs", b, id); }
export async function getBlob(id: string) { return (await (await db()).get("blobs", id)) as Blob | undefined; }
export async function deleteBlob(id: string) { await (await db()).delete("blobs", id); }

/** Asks the browser not to evict our data when space runs low (best effort). */
export async function persistStorage(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  try { const e = await navigator.storage.estimate(); return { used: e.usage ?? 0, quota: e.quota ?? 0 }; } catch { return null; }
}
