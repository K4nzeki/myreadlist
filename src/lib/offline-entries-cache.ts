// A small localStorage cache of the signed-in user's reading list, keyed per
// user. This is what lets the list still render when there's no connection —
// it's a read cache only; writes (adding a title, bumping a chapter, etc.)
// still go straight to Supabase and need a connection to succeed.
import type { Entry } from "@/routes/shared";

const PREFIX = "panels-entries-cache:";

export function loadCachedEntries(userId: string): Entry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PREFIX + userId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Entry[]) : [];
  } catch {
    // Corrupt or inaccessible storage (e.g. private browsing) — just start empty.
    return [];
  }
}

export function saveCachedEntries(userId: string, entries: Entry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + userId, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable — non-fatal, offline viewing just won't
    // reflect the latest data next time.
  }
}
