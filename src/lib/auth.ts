// Google Sign-In with Google Identity Services (official, free, no backend).
// Sign-in identifies the user on this device only. It grants NO AI access: it does not unlock
// Google Flow, Gemini API or Google AI Pro credits.
// Note: with no backend, the ID token is decoded for display only, not verified by a server.

export interface GoogleUser { name: string; email: string; picture: string; expiresAt: number }

interface Gis {
  accounts: { id: {
    initialize(o: { client_id: string; callback: (r: { credential: string }) => void; auto_select?: boolean; ux_mode?: string; use_fedcm_for_prompt?: boolean }): void;
    renderButton(el: HTMLElement, o: Record<string, unknown>): void;
    disableAutoSelect(): void;
  } };
}

export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
const KEY = "cineai.user";

export function decodeIdToken(jwt: string): GoogleUser {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("Malformed Google credential.");
  const json = JSON.parse(decodeURIComponent(escape(atob(part.replace(/-/g, "+").replace(/_/g, "/")))));
  return { name: json.name ?? "", email: json.email ?? "", picture: json.picture ?? "", expiresAt: (json.exp ?? 0) * 1000 };
}

export function currentUser(): GoogleUser | null {
  try {
    const u = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as GoogleUser | null;
    return u && u.expiresAt > Date.now() ? u : null;
  } catch { return null; }
}

let loading: Promise<Gis> | null = null;
function loadGis(): Promise<Gis> {
  loading ??= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => { const g = (window as unknown as { google?: Gis }).google; if (g) res(g); else rej(new Error("Google Sign-In did not load.")); };
    s.onerror = () => { loading = null; rej(new Error("Could not load Google Sign-In. Check the connection or an ad blocker.")); };
    document.head.appendChild(s);
  });
  return loading;
}

export async function renderSignIn(el: HTMLElement, onUser: (u: GoogleUser) => void): Promise<void> {
  if (!GOOGLE_CLIENT_ID) throw new Error("Google Sign-In is not configured for this site (no client ID). See SETUP.md.");
  const g = await loadGis();
  g.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (r) => {
      const u = decodeIdToken(r.credential);
      try { sessionStorage.setItem(KEY, JSON.stringify(u)); } catch { /* storage blocked: stay signed in for this page only */ }
      onUser(u);
    },
  });
  g.accounts.id.renderButton(el, { theme: "filled_black", size: "large", shape: "pill", text: "signin_with" });
}

export function signOut() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  (window as unknown as { google?: Gis }).google?.accounts.id.disableAutoSelect();
}
