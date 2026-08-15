// Keeps the user signed in through a network outage instead of dropping them
// back to the login screen the moment the access token's real expiry (~1h)
// passes while offline.
//
// Why this exists: supabase-js already avoids clearing the session on a
// *proactive* refresh that fails offline (the access token is still within
// its real expiry window). But once that real expiry passes — very possible
// during a longer outage — __loadSession()/getSession() falls through to
// `session: null` as soon as the refresh attempt throws, even though the
// only thing that failed is the network request, not the credential. There's
// no way to distinguish "refresh token rejected" from "no connection" until
// a request actually reaches the server.
//
// So the app keeps its own small record of the last confirmed session. If
// getSession() comes back empty while the browser is offline, and we have a
// record confirmed within the last 24h, we let the user stay in with that
// cached identity (their data still comes from the read-only entries cache)
// instead of bouncing them to AuthPanel. The moment the browser is back
// online, the real getSession()/onAuthStateChange flow takes over again and
// either confirms or replaces this.
const KEY = "panels-last-known-session";
export const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000; // 1 day

type StoredSession = {
  userId: string;
  email: string;
  accessToken: string;
  confirmedAt: number;
};

export function rememberSession(session: { user: { id: string; email?: string | null }; access_token: string }): void {
  if (typeof window === "undefined") return;
  try {
    const record: StoredSession = {
      userId: session.user.id,
      email: session.user.email ?? "",
      accessToken: session.access_token,
      confirmedAt: Date.now(),
    };
    window.localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Storage full or unavailable — the offline grace period just won't
    // apply; the normal online auth flow is unaffected.
  }
}

export function forgetRememberedSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — best-effort cleanup.
  }
}

// Returns the last confirmed session if it's still within the grace window,
// otherwise null (either nothing stored, corrupt, or too old — in which case
// it's also cleared so a truly stale credential doesn't linger).
export function loadRememberedSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.userId || !parsed?.accessToken || !parsed?.confirmedAt) return null;
    if (Date.now() - parsed.confirmedAt > OFFLINE_GRACE_MS) {
      forgetRememberedSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
