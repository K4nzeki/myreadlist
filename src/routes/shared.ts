// Types, constants, and pure helper functions shared between the main
// Tracker route and the lazy-loaded StatsDialog. Kept dependency-free
// (no React, no Supabase) so these are cheap to unit test in isolation.

// Single source of truth for the app's support address, used on the
// Privacy Policy, Terms of Service, and the "report this list" link on
// public profile pages. TODO before App Store submission: replace with a
// real, monitored inbox — reviewers do check this.
export const SUPPORT_EMAIL = "support@myreadlist.app";

export type EntryType = "Manga" | "Manhwa" | "Manhua" | "Comic";
export type EntryStatus = "To Read" | "Reading" | "Dropped" | "Cancelled" | "Finished";

export type Entry = {
  id: string;
  title: string;
  type: EntryType;
  chapter: number;
  status: EntryStatus;
  reread: number;
  created_at?: string;
  cover_url?: string | null;
  author?: string | null;
  total_chapters?: number | null;
  // Where the reader actually reads this — a MangaDex/Comick/etc. title
  // page URL, set by the reader themselves. Distinct from cover_url/author
  // (AniList/MAL/Kitsu tracking metadata) — this is about *reading* the
  // thing, not tracking it. See routes/index.tsx's cover-tap handler.
  read_on_url?: string | null;
  // Set whenever a chapter bump happens (see update() in routes/index.tsx)
  // — not on every edit. Used to bubble actively-read titles up in the
  // default sort, separate from created_at (when it was first added).
  last_read_at?: string | null;
  position: number;
};

export const STATUS_FILL: Record<string, string> = {
  "To Read": "var(--toread)",
  Reading: "var(--ongoing)",
  Dropped: "var(--dropped)",
  Cancelled: "var(--cancelled)",
  Finished: "var(--finished)",
};

export const TYPES: EntryType[] = ["Manga", "Manhwa", "Manhua", "Comic"];
export const STATUSES: EntryStatus[] = ["To Read", "Reading", "Dropped", "Cancelled", "Finished"];

// Single source of truth for "what month is it" across the app: the
// reader's local calendar month, stored as the first-of-month date. Used
// when logging a finished title and when building the monthly stats
// window, so a title finished "this month" always lands in this month's
// bucket regardless of the server's UTC offset.
export const localMonthKey = (date: Date = new Date()): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;

export const MONTH_LABEL = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" });

// Same idea as localMonthKey, but per calendar day — used to log/chart
// chapters read per day in the reader's own local calendar, not the
// server's UTC offset.
export const localDayKey = (date: Date = new Date()): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const DAY_LABEL = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export function normalizeType(raw: string): EntryType | null {
  const found = TYPES.find((t) => t.toLowerCase() === raw.toLowerCase());
  return found ?? null;
}

export function normalizeStatus(raw: string): EntryStatus | null {
  const found = STATUSES.find((s) => s.toLowerCase() === raw.toLowerCase());
  return found ?? null;
}

export type Parsed = Omit<Entry, "id" | "position">;

export function parsePipeLine(line: string): Parsed | null {
  const parts = line.split("|").map((p) => p.trim());
  if (parts.length < 5) return null;
  const [title, chap, status, type, reread] = parts;
  const t = normalizeType(type);
  const s = normalizeStatus(status);
  const c = Number(chap);
  const r = Number(reread);
  if (!title || !t || !s || Number.isNaN(c) || Number.isNaN(r)) return null;
  return { title, type: t, chapter: c, status: s, reread: r };
}

export function parseSpaceLine(line: string): { entry?: Parsed; error?: string } {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 5) return { error: "needs Title + Chapter Status Type Reread" };
  const reread = tokens.pop()!;
  const type = tokens.pop()!;
  const status = tokens.pop()!;
  const chapter = tokens.pop()!;
  const title = tokens.join(" ").trim();
  const t = normalizeType(type);
  const s = normalizeStatus(status);
  const c = Number(chapter);
  const r = Number(reread);
  if (!title) return { error: "missing title" };
  if (!t) return { error: `unknown type "${type}"` };
  if (!s) return { error: `unknown status "${status}"` };
  if (Number.isNaN(c)) return { error: `chapter "${chapter}" not a number` };
  if (Number.isNaN(r)) return { error: `reread "${reread}" not a number` };
  return { entry: { title, type: t, chapter: c, status: s, reread: r } };
}
