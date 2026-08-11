import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { BarChart3, ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Menu, Moon, Search, Sun, User, X } from "lucide-react";
import { toast } from "sonner";
import { searchMAL, searchKitsu, searchAllTrackers } from "@/integrations/trackers";
import { useTheme } from "@/hooks/use-theme";
import {
  TYPES,
  STATUSES,
  localMonthKey,
  localDayKey,
  parsePipeLine,
  parseSpaceLine,
  type EntryType,
  type EntryStatus,
  type Entry,
  type Parsed,
} from "./shared";

// Update to the correct relative path or alias
const StatsDialog = lazy(() => import("@/components/StatsDialog"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Panels — Synced Reading Tracker" },
      { name: "description", content: "Track and sync manga, manhwa, manhua, and comics across your devices." },
      { property: "og:title", content: "Panels — Synced Reading Tracker" },
      { property: "og:description", content: "A private reading tracker that keeps your progress synced across devices." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Tracker,
});

// Every entries query below selects this exact column set — kept as one
// constant so the row shape always matches the Entry type above.
const ENTRY_COLUMNS = "id, title, type, chapter, status, reread, created_at, cover_url, author, total_chapters, position";

// Time-of-day greeting for the header, based on the reader's local clock.
function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Good early morning";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

// New titles are inserted above everything else (matches the existing
// "prepend to the list" behavior), without having to touch every other
// row's position. Each new title just gets a value lower than the current
// lowest — cheap, and leaves room to insert below it later via reordering.
function nextTopPosition(list: Entry[]): number {
  if (list.length === 0) return 0;
  return Math.min(...list.map((e) => e.position)) - 1;
}

type SearchResult = {
  id: number | string;
  title: string;
  type: EntryType;
  author: string | null;
  coverUrl: string | null;
  totalChapters: number | null;
  status: string | null;
  source?: string;
  // Whether this result's title is an exact (case-insensitive) match for
  // the title we searched for, vs. just the top fuzzy search hit. `type`
  // is only trustworthy to auto-apply when this is true — a fuzzy hit can
  // be a different series entirely, with a different (wrong) type.
  exactMatch?: boolean;
};

// AniList's public GraphQL API. No key required, CORS-enabled for browser
// use. It covers Manga/Manhwa/Manhua well (it's a manga/anime database) but
// has essentially no Western "Comic" catalog — Comic entries will mostly
// need to stay manual.
const ANILIST_ENDPOINT = "https://graphql.anilist.co";
const ANILIST_QUERY = `
  query ($search: String) {
    Page(page: 1, perPage: 8) {
      media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
        id
        countryOfOrigin
        chapters
        status
        title { romaji english }
        coverImage { medium }
        staff(sort: RELEVANCE, perPage: 1) {
          edges { node { name { full } } }
        }
      }
    }
  }
`;

function guessTypeFromCountry(country: string | null | undefined): EntryType {
  switch (country) {
    case "KR":
      return "Manhwa";
    case "CN":
    case "TW":
      return "Manhua";
    default:
      return "Manga";
  }
}

async function searchAniList(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: query } }),
    signal,
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = (await res.json()) as {
    data?: {
      Page?: {
        media?: Array<{
          id: number;
          countryOfOrigin?: string | null;
          chapters?: number | null;
          status?: string | null;
          title?: { romaji?: string | null; english?: string | null };
          coverImage?: { medium?: string | null };
          staff?: { edges?: Array<{ node?: { name?: { full?: string | null } } }> };
        }>;
      };
    };
  };
  const media = json.data?.Page?.media ?? [];
  return media.map((m) => ({
    id: m.id,
    title: m.title?.english || m.title?.romaji || "Untitled",
    type: guessTypeFromCountry(m.countryOfOrigin),
    author: m.staff?.edges?.[0]?.node?.name?.full ?? null,
    coverUrl: m.coverImage?.medium ?? null,
    totalChapters: typeof m.chapters === "number" ? m.chapters : null,
    status: m.status ?? null,
    source: "AniList",
  }));
}

// Picks the best AniList match for a plain title string: an exact
// case-insensitive match if one exists, otherwise the top search hit.
// Returns null on no results or a network error so callers can just skip
// enrichment silently — AniList also has ~no Western "Comic" catalog, so
// misses there are expected. `exactMatch` is stamped on the result so
// callers can tell a real match from a fuzzy best-guess.
async function findAniListMatch(title: string): Promise<SearchResult | null> {
  try {
    const results = await searchAniList(title);
    if (!results.length) return null;
    const exact = results.find(
      (r) => r.title.trim().toLowerCase() === title.trim().toLowerCase(),
    );
    if (exact) return { ...exact, exactMatch: true };
    return { ...results[0], exactMatch: false };
  } catch {
    return null;
  }
}

function pickBestMatch<T extends { title: string }>(
  title: string,
  results: T[],
): (T & { exactMatch: boolean }) | null {
  if (!results.length) return null;
  const exact = results.find((r) => r.title.trim().toLowerCase() === title.trim().toLowerCase());
  if (exact) return { ...exact, exactMatch: true };
  return { ...results[0], exactMatch: false };
}

// Same as findAniListMatch, but falls back to MyAnimeList then Kitsu when
// AniList has no hit — mainly useful for Comic entries and other titles
// outside AniList's manga/manhwa/manhua-focused catalog. Any provider
// failing (network error, no results) just falls through to the next one;
// returns null only if every provider comes up empty.
async function findTrackerMatch(title: string): Promise<SearchResult | null> {
  const anilist = await findAniListMatch(title);
  if (anilist) return anilist;
  try {
    const mal = pickBestMatch(title, await searchMAL(title));
    if (mal) return mal;
  } catch {
    /* fall through to the next provider */
  }
  try {
    const kitsu = pickBestMatch(title, await searchKitsu(title));
    if (kitsu) return kitsu;
  } catch {
    /* no matches anywhere */
  }
  return null;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Runs findAniListMatch over a list with limited concurrency + a small
// delay per lookup, so bulk/file imports of many titles don't slam
// AniList's rate limit.
async function enrichWithAniList<T extends { title: string }>(
  items: T[],
  merge: (item: T, match: SearchResult) => T,
  concurrency = 4,
): Promise<T[]> {
  const out: T[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      const match = await findTrackerMatch(item.title);
      out[idx] = match ? merge(item, match) : item;
      await sleep(150);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

type SortKey = "title" | "type" | "chapter" | "status" | "reread" | "created_at";
type SortDir = "asc" | "desc";

function serialize(entries: Entry[]) {
  return entries
    .map((e) => `${e.title}|${e.chapter}|${e.status}|${e.type}|${e.reread}`)
    .join("\n");
}

function Tracker() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!authReady) {
    return <SplashScreen />;
  }
  if (!session) return <AuthPanel />;
  return <TrackerApp userId={session.user.id} email={session.user.email ?? ""} />;
}

function SplashScreen() {
  return (
    <div className="h-screen w-screen grid place-items-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 rounded-lg border-2 border-primary border-t-transparent animate-spin" />
        <span className="text-sm font-semibold text-primary tracking-tight">Panels</span>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="h-[100dvh] w-full bg-background text-foreground flex flex-col safe-t animate-pulse">
      <div className="border-b border-border px-3 sm:px-6 py-2 sm:py-3 flex items-center gap-3 sm:gap-6 flex-wrap">
        <div className="h-6 w-24 rounded bg-muted" />
        <div className="h-8 w-px bg-border hidden sm:block" />
        <div className="flex gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-16 rounded bg-muted" />
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden px-3 sm:px-6 py-3 space-y-2">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-12 rounded-md bg-muted/70" />
        ))}
      </div>
    </div>
  );
}

function AuthPanel() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { username: username.trim() },
          },
        });
        if (error) throw error;
        setMsg("Check your email to confirm, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen w-screen grid place-items-center bg-background text-foreground p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm flex flex-col gap-3 border border-border rounded-lg p-6 bg-card"
      >
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-bold text-primary">Panels</h1>
          <span className="text-xs text-muted-foreground">reading tracker</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {mode === "signin" ? "Sign in to sync your list." : "Create an account to sync your list."}
        </p>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="h-9 px-3 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {mode === "signup" && (
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username (optional)"
            maxLength={40}
            className="h-9 px-3 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        )}
        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 6)"
            className="w-full h-9 pl-3 pr-10 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? "Hide password" : "Show password"}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-8 grid place-items-center rounded text-muted-foreground hover:text-foreground"
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setMsg(null);
          }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {mode === "signin" ? "No account? Sign up" : "Have an account? Sign in"}
        </button>
        {msg && <div className="text-xs text-accent">{msg}</div>}
      </form>
    </div>
  );
}

function TrackerApp({ userId, email }: { userId: string; email: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const entriesRef = useRef<Entry[]>([]);
  const [_loading, setLoading] = useState(true);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<{ ok: number; errors: string[] } | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [panelOpen, setPanelOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<EntryType | "">("");
  const [statusFilter, setStatusFilter] = useState<EntryStatus | "">("");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const { resolved: theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  const reportDatabaseError = useCallback((action: string, error: { message: string }) => {
    const message = `${action} failed: ${error.message}`;
    console.error(`[Panels database] ${message}`, error);
    setSyncError(message);
    toast.error(message);
  }, []);

  // Display name for the header greeting. Falls back to the local part of
  // the email (never the full address) if no username has been set yet.
  const [username, setUsername] = useState<string | null>(null);
  const loadUsername = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();
    setUsername(data?.username || email.split("@")[0] || "Reader");
  }, [userId, email]);
  useEffect(() => {
    void loadUsername();
  }, [loadUsername]);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from("entries")
      .select(ENTRY_COLUMNS)
      .eq("user_id", userId)
      .order("position", { ascending: true });
    if (error) {
      reportDatabaseError("Loading your list", error);
    } else if (data) {
      setEntries(data as Entry[]);
      setSyncError(null);
    }
    setLoading(false);
  }, [reportDatabaseError, userId]);

  // Initial load
  useEffect(() => {
    void reload();
  }, [userId, reload]);

  // Refetch on window focus / tab visible / reconnect
  useEffect(() => {
    const onFocus = () => void reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const onOnline = () => {
      setIsOffline(false);
      void reload();
    };
    const onOffline = () => setIsOffline(true);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  // Realtime sync across devices
  useEffect(() => {
    const channel = supabase
      .channel(`entries-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id?: string } | null)?.id;
            if (oldId) setEntries((prev) => prev.filter((e) => e.id !== oldId));
            return;
          }
          // NOTE: this used to rebuild a "clean" Entry with only a handful of
          // fields (id/title/type/chapter/status/reread), dropping
          // cover_url/author/total_chapters/created_at. Since Postgres
          // realtime UPDATE payloads include the full row, that reconstruction
          // was wiping out the cover art/author/chapter-total on every single
          // edit (chapter +1, status change, etc.) as soon as the echo of your
          // own write came back over the socket. Just use the row as-is.
          const row = payload.new as Entry;
          setEntries((prev) => {
            const idx = prev.findIndex((e) => e.id === row.id);
            if (idx === -1) return [row, ...prev];
            const next = [...prev];
            next[idx] = row;
            return next;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const stats = useMemo(() => {
    const s = {
      chapters: 0,
      total: entries.length,
      rereads: 0,
      types: { Manga: 0, Manhwa: 0, Manhua: 0, Comic: 0 } as Record<EntryType, number>,
      statuses: { Ongoing: 0, Dropped: 0, Cancelled: 0, Finished: 0 } as Record<EntryStatus, number>,
      matrix: Object.fromEntries(
        TYPES.map((t) => [t, { Ongoing: 0, Dropped: 0, Cancelled: 0, Finished: 0 }]),
      ) as Record<EntryType, Record<EntryStatus, number>>,
    };
    for (const e of entries) {
      s.chapters += Number(e.chapter) || 0;
      s.rereads += Number(e.reread) || 0;
      s.types[e.type]++;
      s.statuses[e.status]++;
      if (s.matrix[e.type]) s.matrix[e.type][e.status]++;
    }
    return s;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = entries.filter((e) => {
      if (typeFilter && e.type !== typeFilter) return false;
      if (statusFilter && e.status !== statusFilter) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.status.toLowerCase().includes(q)
      );
    });
    if (!sortKey) return [...list].sort((a, b) => a.position - b.position);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      if (sortKey === "created_at") return String(av) < String(bv) ? -dir : String(av) > String(bv) ? dir : 0;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
    });
  }, [entries, filter, typeFilter, statusFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else {
        setSortKey(null);
        setSortDir("asc");
      }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortValue = sortKey ? `${sortKey}:${sortDir}` : "";
  const applySortValue = (v: string) => {
    if (!v) {
      setSortKey(null);
      setSortDir("asc");
      return;
    }
    const [k, d] = v.split(":") as [SortKey, SortDir];
    setSortKey(k);
    setSortDir(d);
  };

  const update = useCallback(
    async (id: string, patch: Partial<Entry>) => {
      const before = entriesRef.current.find((entry) => entry.id === id);
      const { data, error } = await supabase
        .from("entries")
        .update(patch)
        .eq("id", id)
        .eq("user_id", userId)
        .select(ENTRY_COLUMNS)
        .maybeSingle();
      if (error) {
        reportDatabaseError("Saving your change", error);
        return false;
      }
      if (!data) {
        reportDatabaseError("Saving your change", { message: "No matching row was updated. Please refresh and sign in again." });
        return false;
      }
      setEntries((prev) => prev.map((entry) => (entry.id === id ? (data as Entry) : entry)));
      setSyncError(null);
      // Log a completion whenever a title's status changes *into* Finished
      // (not on every save) — that's the event "titles read this month"
      // is built from. Logged against the reader's local calendar month so
      // it lands in the month they actually finished it, regardless of the
      // server's UTC offset.
      if (before && typeof patch.status === "string" && before.status !== "Finished" && (data as Entry).status === "Finished") {
        const { error: logError } = await supabase.from("completion_log").insert({
          user_id: userId,
          entry_id: id,
          title: (data as Entry).title,
          month: localMonthKey(),
        });
        // Log-only write feeding the Stats dialog — a failure here shouldn't
        // roll back or toast-error the save that already succeeded, but it
        // should be visible in the console instead of vanishing silently.
        if (logError) console.error("[Panels database] Logging completion failed:", logError);
      }
      // Log a chapter change (up or down) so the "chapters read" stat
      // stays accurate — the +1 button, typing a higher number, or
      // correcting a typo/over-count back down, for any title. A decrease
      // logs a negative delta, so correcting a chapter you bumped by
      // mistake nets back out of the day's total instead of leaving a
      // stats total that's now too high. Logged against the reader's
      // local calendar day, same reasoning as completion_log's local
      // month.
      if (before && typeof patch.chapter === "number" && patch.chapter !== before.chapter) {
        const { error: logError } = await supabase.from("chapter_log").insert({
          user_id: userId,
          entry_id: id,
          day: localDayKey(),
          delta: patch.chapter - before.chapter,
        });
        if (logError) console.error("[Panels database] Logging chapters read failed:", logError);
      }
      return true;
    },
    [reportDatabaseError, userId],
  );

  // Drag-and-drop reordering. Only enabled in the plain, unfiltered,
  // unsorted view — with a filter or column sort active there's no honest
  // mapping from "drag this row" back to a single global position, so we
  // disable it rather than do something surprising.
  const canReorder = !filter.trim() && !typeFilter && !statusFilter && !sortKey;
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const reorderEntries = useCallback(
    async (draggedId: string, targetId: string) => {
      if (draggedId === targetId) return;
      const current = [...entriesRef.current].sort((a, b) => a.position - b.position);
      const fromIdx = current.findIndex((x) => x.id === draggedId);
      const toIdx = current.findIndex((x) => x.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return;

      const reordered = [...current];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);

      // Only the rows whose position actually shifted need a write.
      const changed: { id: string; position: number }[] = [];
      reordered.forEach((entry, idx) => {
        if (entry.position !== idx) changed.push({ id: entry.id, position: idx });
      });
      if (changed.length === 0) return;

      // Optimistic local update so the drag feels instant.
      const nextPosition = new Map(changed.map((c) => [c.id, c.position]));
      setEntries((prev) =>
        prev.map((e) => (nextPosition.has(e.id) ? { ...e, position: nextPosition.get(e.id)! } : e)),
      );

      const results = await Promise.all(
        changed.map(({ id, position }) =>
          supabase.from("entries").update({ position }).eq("id", id).eq("user_id", userId),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        reportDatabaseError("Saving new order", failed.error);
        void reload();
      } else {
        setSyncError(null);
      }
    },
    [userId, reportDatabaseError, reload],
  );

  // Keyboard/touch-friendly alternative to dragging — swaps a title with its
  // immediate neighbor. Used by the up/down buttons on mobile, where native
  // HTML5 drag-and-drop isn't reliably supported.
  const moveEntry = useCallback(
    (id: string, direction: -1 | 1) => {
      const current = [...entriesRef.current].sort((a, b) => a.position - b.position);
      const idx = current.findIndex((x) => x.id === id);
      const targetIdx = idx + direction;
      if (idx === -1 || targetIdx < 0 || targetIdx >= current.length) return;
      void reorderEntries(id, current[targetIdx].id);
    },
    [reorderEntries],
  );

  const remove = async (id: string) => {
    const { data, error } = await supabase
      .from("entries")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (error) {
      reportDatabaseError("Deleting the title", error);
      return;
    }
    if (!data) {
      reportDatabaseError("Deleting the title", { message: "No matching row was deleted." });
      return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setSyncError(null);
    toast.success("Title deleted");
  };

  const commitTitleEdit = useCallback(
    async (entry: Entry, rawTitle: string, revert: (value: string) => void) => {
      const title = rawTitle.trim();
      if (!title) {
        revert(entry.title);
        toast.error("A title cannot be empty");
        return;
      }
      if (title === entry.title) return;

      const saved = await update(entry.id, { title });
      if (!saved) {
        revert(entry.title);
        return;
      }

      // Only auto-fill when this entry has no cover yet — never clobber
      // art the user picked via Search or already has from an import.
      if (!entry.cover_url) {
        const match = await findTrackerMatch(title);
        if (match) {
          // Same reasoning as backfillCovers: only trust `type` from an
          // exact title match, not a fuzzy best-guess result.
          void update(entry.id, {
            ...(match.exactMatch ? { type: match.type } : {}),
            cover_url: match.coverUrl,
            author: match.author,
            total_chapters: match.totalChapters,
          });
        }
      }
    },
    [update],
  );

  const addFromSearch = async (result: SearchResult) => {
    const taken = new Set(entries.map((e) => e.title.trim().toLowerCase()));
    const title = result.title.trim();
    if (!title) return false;
    if (taken.has(title.toLowerCase())) {
      toast.error(`"${title}" is already in your list`);
      return false;
    }
    const row = {
      user_id: userId,
      title,
      type: result.type,
      chapter: 0,
      status: "Ongoing",
      reread: 0,
      cover_url: result.coverUrl,
      author: result.author,
      total_chapters: result.totalChapters,
      position: nextTopPosition(entries),
    };
    const { data, error } = await supabase
      .from("entries")
      .insert(row)
      .select(ENTRY_COLUMNS)
      .single();
    if (error) {
      reportDatabaseError("Adding a title", error);
      return false;
    }
    if (data) {
      setSyncError(null);
      setEntries((prev) => [data as Entry, ...prev]);
      toast.success(`"${title}" added`);
      return true;
    }
    return false;
  };

  const addBlank = async () => {
    const taken = new Set(entries.map((e) => e.title.trim().toLowerCase()));
    let title = "New title";
    let n = 2;
    while (taken.has(title.toLowerCase())) title = `New title ${n++}`;
    const row = { user_id: userId, title, type: "Manga", chapter: 0, status: "Ongoing", reread: 0, position: nextTopPosition(entries) };
    const { data, error } = await supabase
      .from("entries")
      .insert(row)
      .select(ENTRY_COLUMNS)
      .single();
    if (error) {
      reportDatabaseError("Adding a title", error);
      return;
    }
    if (data) {
      setSyncError(null);
      setEntries((prev) => [data as Entry, ...prev]);
      toast.success("Title saved to your synced list");
    }
  };

  const [backfilling, setBackfilling] = useState(false);

  // Retroactively fetch covers/metadata for entries that never got enriched.
  const backfillCovers = async () => {
    const missing = entries.filter((e) => !e.cover_url);
    if (missing.length === 0) {
      toast.info("Every title already has a cover");
      return;
    }
    setBackfilling(true);
    try {
      // Only apply `type` when the tracker match was an exact title match.
      // A fuzzy/best-guess match (pickBestMatch's top-result fallback) can
      // be a different series entirely, and its type was overwriting a
      // correct manually-set type with a wrong guess.
      const enriched = await enrichWithAniList(missing, (entry, m) => ({
        ...entry,
        type: m.exactMatch ? m.type : entry.type,
        cover_url: m.coverUrl,
        author: m.author,
        total_chapters: m.totalChapters,
      }));
      let found = 0;
      for (const row of enriched) {
        if (!row.cover_url) continue;
        const ok = await update(row.id, {
          type: row.type,
          cover_url: row.cover_url,
          author: row.author,
          total_chapters: row.total_chapters,
        });
        if (ok) found++;
      }
      toast.success(
        found ? `Added covers for ${found} of ${missing.length} titles` : "No matches found on AniList, MyAnimeList, or Kitsu",
      );
    } finally {
      setBackfilling(false);
    }
  };

  const runImport = async () => {
    const lines = importText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const toInsert: Parsed[] = [];
    const errors: string[] = [];
    const existing = new Set(entries.map((e) => e.title.trim().toLowerCase()));
    lines.forEach((line, i) => {
      const piped = line.includes("|") ? parsePipeLine(line) : null;
      const parsed = piped ?? parseSpaceLine(line).entry;
      const err = piped ? null : parseSpaceLine(line).error;
      if (parsed) {
        const key = parsed.title.trim().toLowerCase();
        if (existing.has(key)) {
          errors.push(`Line ${i + 1}: duplicate title "${parsed.title}"`);
        } else {
          existing.add(key);
          toInsert.push(parsed);
        }
      } else errors.push(`Line ${i + 1}: ${err ?? "invalid"}`);
    });
   let addedCount = 0;
    if (toInsert.length) {
      const enriched = await enrichWithAniList(toInsert, (p, m) => ({
        ...p,
        type: m.type ?? p.type,
        cover_url: m.coverUrl ?? undefined,
        author: m.author ?? undefined,
        total_chapters: m.totalChapters ?? undefined,
      }));
      const rows = enriched.map((p, i) => ({
        ...p,
        user_id: userId,
        // Land the whole pasted batch above the existing list, in the same
        // relative order the lines were pasted in.
        position: nextTopPosition(entries) - (enriched.length - 1) + i,
      }));
      const { data, error } = await supabase
        .from("entries")
        .insert(rows)
        .select(ENTRY_COLUMNS);
      if (error) {
        errors.push(error.message);
        reportDatabaseError("Importing titles", error);
      }
      else if (data) {
        setEntries((prev) => [...(data as Entry[]), ...prev]);
        addedCount = data.length;
      }
    }
    setImportMsg({ ok: addedCount, errors });
    if (addedCount && !errors.length) setImportText("");
  };

  const saveTxt = () => {
    const blob = new Blob([serialize(entries)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `panels-${date}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadTxt = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result ?? "");
      const loaded: Parsed[] = [];
      const existing = new Set(entries.map((e) => e.title.trim().toLowerCase()));
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const e = parsePipeLine(line);
        if (!e) continue;
        const key = e.title.trim().toLowerCase();
        if (existing.has(key)) continue;
        existing.add(key);
        loaded.push(e);
      }
      if (loaded.length) {
        const enriched = await enrichWithAniList(loaded, (p, m) => ({
          ...p,
          type: m.type ?? p.type,
          cover_url: m.coverUrl ?? undefined,
          author: m.author ?? undefined,
          total_chapters: m.totalChapters ?? undefined,
        }));
        const rows = enriched.map((p, i) => ({
          ...p,
          user_id: userId,
          position: nextTopPosition(entries) - (enriched.length - 1) + i,
        }));
        const { data, error } = await supabase
          .from("entries")
          .insert(rows)
          .select(ENTRY_COLUMNS);
        if (error) reportDatabaseError("Loading titles", error);
        else if (data) {
          setEntries((prev) => [...(data as Entry[]), ...prev]);
          toast.success(`${data.length} title${data.length === 1 ? "" : "s"} saved`);
        }
      }
    };
    reader.readAsText(file);
    ev.target.value = "";
  };

  if (_loading) {
    return <ListSkeleton />;
  }

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-background text-foreground flex flex-col safe-t">
      {isOffline && (
        <div
          role="status"
          className="px-3 sm:px-6 py-1.5 text-xs bg-muted text-muted-foreground border-b border-border"
        >
          You're offline — changes will sync once you're back online.
        </div>
      )}
      {syncError && (
        <div
          role="alert"
          className="px-3 sm:px-6 py-1.5 text-xs bg-destructive/15 text-destructive border-b border-destructive/30"
        >
          {syncError}
        </div>
      )}
      {/* Header + stats */}
      <header className="border-b border-border px-3 sm:px-6 py-2 sm:py-3 flex items-center gap-3 sm:gap-6 flex-wrap">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-primary">Panels</span>
          </h1>
          <span className="hidden sm:inline text-xs text-muted-foreground">reading tracker</span>
        </div>

        <button
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="ml-auto order-1 lg:order-none shrink-0 h-9 w-9 grid place-items-center rounded-md border border-border hover:bg-muted"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <button
          onClick={() => setPanelOpen((v) => !v)}
          aria-label="Toggle bulk import panel"
          aria-expanded={panelOpen}
          className="order-1 lg:order-none shrink-0 h-9 w-9 grid place-items-center rounded-md border border-border hover:bg-muted"
        >
          {panelOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>

        <div className="flex items-center gap-3 sm:gap-5 flex-wrap text-sm w-full lg:w-auto lg:ml-auto order-2 lg:order-none">
          <Stat label="Chapters" value={stats.chapters.toLocaleString()} big />
          <Stat label="Titles" value={stats.total} />
          <Stat label="Rereads" value={stats.rereads} />
          <div className="h-8 w-px bg-border hidden sm:block" />
          <div className="hidden sm:flex gap-3 text-xs">
            {TYPES.map((t) => (
              <span key={t} className="text-muted-foreground">
                <span className="text-foreground font-semibold">{stats.types[t]}</span> {t}
              </span>
            ))}
          </div>
          <div className="h-8 w-px bg-border hidden sm:block" />
          <div className="flex gap-2 text-xs flex-wrap">
            {STATUSES.map((s) => (
              <StatusPill key={s} status={s} count={stats.statuses[s]} />
            ))}
          </div>
          <div className="h-8 w-px bg-border hidden sm:block" />
          <div className="flex items-center gap-2 text-xs ml-auto lg:ml-0">
            <span className="text-muted-foreground hidden sm:inline">
              {timeGreeting()}
              {username ? `, ${username}` : ""}
            </span>
            <button
              onClick={() => setProfileOpen(true)}
              className="h-8 px-3 rounded-md border border-border hover:bg-muted inline-flex items-center gap-1.5"
            >
              <User className="h-3.5 w-3.5" />
              Profile
            </button>
            <button
              onClick={() => setStatsDialogOpen(true)}
              className="h-8 px-3 rounded-md border border-border hover:bg-muted inline-flex items-center gap-1.5"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Statistics</span>
            </button>
            <button
              onClick={() => void backfillCovers()}
              disabled={backfilling}
              className="h-8 px-3 rounded-md border border-border hover:bg-muted inline-flex items-center gap-1.5 disabled:opacity-60"
              title="Fetch missing covers from AniList"
            >
              <span className="hidden sm:inline">
                {backfilling ? "Fetching covers…" : "Fetch covers"}
              </span>
              <span className="sm:hidden">{backfilling ? "…" : "Covers"}</span>
            </button>
            <Link
              to="/users"
              className="h-8 px-3 rounded-md border border-border hover:bg-muted inline-flex items-center gap-1.5"
            >
              <User className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Browse Users</span>
            </Link>
            <button
              onClick={() => supabase.auth.signOut()}
              className="h-8 px-3 rounded-md border border-border hover:bg-muted"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {profileOpen && (
        <ProfileDialog
          userId={userId}
          email={email}
          onClose={() => {
            setProfileOpen(false);
            void loadUsername();
          }}
        />
      )}

      {statsDialogOpen && (
        <Suspense fallback={null}>
          <StatsDialog userId={userId} stats={stats} onClose={() => setStatsDialogOpen(false)} />
        </Suspense>
      )}

      {searchDialogOpen && (
        <SearchDialog onAdd={addFromSearch} onClose={() => setSearchDialogOpen(false)} />
      )}


      {/* Main grid */}
      <main id="main-content" className="flex-1 min-h-0 flex relative">
        {/* Table panel */}
        <section className="flex flex-col min-h-0 flex-1 border-r border-border">
          <div className="flex flex-col gap-2 px-3 sm:px-4 py-2 border-b border-border sm:flex-row sm:flex-wrap sm:items-center">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="w-full sm:flex-1 sm:min-w-[8rem] h-9 px-3 rounded-md bg-input text-foreground placeholder:text-muted-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            {!canReorder && (
              <span className="text-xs text-muted-foreground order-last sm:order-none w-full sm:w-auto">
                Clear filters &amp; sorting to drag-reorder titles
              </span>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sortValue}
                onChange={(e) => applySortValue(e.target.value)}
                className="h-9 px-2 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring cursor-pointer shrink-0 max-w-[9rem]"
                title="Sort"
                aria-label="Sort"
              >
                <option value="">My Order</option>
                <option value="created_at:desc">Newly Added</option>
                <option value="created_at:asc">Oldest Added</option>
                <option value="title:asc">Title A → Z</option>
                <option value="title:desc">Title Z → A</option>
                <option value="chapter:desc">Chapter High → Low</option>
                <option value="chapter:asc">Chapter Low → High</option>
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as EntryType | "")}
                className="h-9 px-2 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring cursor-pointer shrink-0 max-w-[7.5rem]"
                title="Filter by type"
                aria-label="Filter by type"
              >
                <option value="">Types</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as EntryStatus | "")}
                className="h-9 px-2 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring cursor-pointer shrink-0 max-w-[8rem]"
                title="Filter by status"
                aria-label="Filter by status"
              >
                <option value="">Status</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setSearchDialogOpen(true)}
                className="h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted shrink-0 inline-flex items-center gap-1.5"
                title="Search & add by title"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Search</span>
              </button>
              <button
                onClick={addBlank}
                className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 shrink-0"
              >
                +<span className="hidden sm:inline"> Add</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto scroll-touch safe-b">
            {/* Mobile card list */}
            <ul className="md:hidden divide-y divide-border">
              {filtered.length === 0 && (
                <li className="px-4 py-16 text-center text-muted-foreground text-sm">
                  {entries.length === 0
                    ? "No titles yet. Add one, or use the menu to paste a list."
                    : "Nothing matches that filter."}
                </li>
              )}
              {filtered.map((e) => (
                <li key={e.id} className={`px-3 py-3 ${statusRowBorder(e.status)}`}>
                  <div className="flex items-stretch gap-3">
                    {e.cover_url ? (
                      <img
                        src={e.cover_url}
                        alt=""
                        className="w-24 shrink-0 rounded-md object-cover bg-muted"
                      />
                    ) : (
                      <div className="w-24 shrink-0 rounded-md bg-muted" />
                    )}
                    <div className="min-w-0 flex-1 flex flex-col gap-2">
                      <div className="flex items-start gap-2">
                        <input
                          key={`${e.id}-${e.title}`}
                          defaultValue={e.title}
                          onBlur={(ev) => {
                            void commitTitleEdit(e, ev.target.value, (v) => {
                              ev.target.value = v;
                            });
                          }}
                          className="min-w-0 flex-1 bg-transparent outline-none focus:bg-input rounded px-2 py-1"
                        />
                        <div className="flex flex-col shrink-0">
                          <button
                            type="button"
                            onClick={() => moveEntry(e.id, -1)}
                            disabled={!canReorder}
                            aria-label={`Move ${e.title} up`}
                            title={canReorder ? "Move up" : "Clear filters & sorting to reorder"}
                            className="h-4 w-9 grid place-items-center text-muted-foreground disabled:opacity-30"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveEntry(e.id, 1)}
                            disabled={!canReorder}
                            aria-label={`Move ${e.title} down`}
                            title={canReorder ? "Move down" : "Clear filters & sorting to reorder"}
                            className="h-4 w-9 grid place-items-center text-muted-foreground disabled:opacity-30"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            if (confirm(`Delete "${e.title}"?`)) remove(e.id);
                          }}
                          aria-label="Delete title"
                          className="shrink-0 h-9 w-9 grid place-items-center rounded-md text-muted-foreground active:text-destructive text-xl leading-none"
                        >
                          ×
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={e.type}
                          onChange={(ev) => void update(e.id, { type: ev.target.value as EntryType })}
                          aria-label={`Type for ${e.title}`}
                          className="h-10 rounded-md bg-input px-2 outline-none"
                        >
                          {TYPES.map((t) => (
                            <option key={t} value={t} className="bg-card">
                              {t}
                            </option>
                          ))}
                        </select>
                        <select
                          value={e.status}
                          onChange={(ev) => void update(e.id, { status: ev.target.value as EntryStatus })}
                          aria-label={`Status for ${e.title}`}
                          className="h-10 rounded-md bg-input px-2 outline-none"
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s} className="bg-card">
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground shrink-0">Ch.</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            key={`m-${e.id}-chapter-${e.chapter}`}
                            defaultValue={e.chapter}
                            onBlur={(ev) => {
                              const chapter = Number(ev.target.value) || 0;
                              if (chapter !== e.chapter) void update(e.id, { chapter });
                            }}
                            className="min-w-0 flex-1 h-10 rounded-md bg-input px-2 outline-none"
                          />
                          <button
                            onClick={() => void update(e.id, { chapter: e.chapter + 1 })}
                            className="shrink-0 h-10 px-3 rounded-md bg-secondary text-secondary-foreground text-xs font-medium"
                          >
                            +1
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground shrink-0">Reread</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            key={`m-${e.id}-reread-${e.reread}`}
                            defaultValue={e.reread}
                            onBlur={(ev) => {
                              const reread = Number(ev.target.value) || 0;
                              if (reread !== e.reread) void update(e.id, { reread });
                            }}
                            className="min-w-0 flex-1 h-10 rounded-md bg-input px-2 outline-none"
                          />
                          <button
                            onClick={() => void update(e.id, { reread: e.reread + 1 })}
                            className="shrink-0 h-10 px-3 rounded-md bg-secondary text-secondary-foreground text-xs font-medium"
                          >
                            +1
                          </button>
                        </div>
                      </div>
                      <ChapterProgress chapter={e.chapter} total={e.total_chapters} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <table className="hidden md:table w-full min-w-[620px] text-sm">
              <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground z-10">
                <tr>
                  <th className="w-8"></th>
                  <th className="w-12"></th>
                  <SortTh label="Title" k="title" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="text-left px-4 py-2" />
                  <SortTh label="Type" k="type" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="text-left px-2 py-2 w-28" />
                  <SortTh label="Ch." k="chapter" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="text-right px-2 py-2 w-24" align="right" />
                  <SortTh label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="text-left px-2 py-2 w-32" />
                  <SortTh label="Reread" k="reread" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="text-right px-2 py-2 w-20" align="right" />
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center text-muted-foreground">
                      {entries.length === 0
                        ? "No titles yet. Add one, or paste a list on the right."
                        : "Nothing matches that filter."}
                    </td>
                  </tr>
                )}
                {filtered.map((e) => (
                  <tr
                    key={e.id}
                    onDragOver={(ev) => {
                      if (!canReorder || !dragId) return;
                      ev.preventDefault();
                      if (dragOverId !== e.id) setDragOverId(e.id);
                    }}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      if (!canReorder || !dragId) return;
                      void reorderEntries(dragId, e.id);
                      setDragId(null);
                      setDragOverId(null);
                    }}
                    className={`border-t border-border hover:bg-muted/40 group ${statusRowBorder(e.status)} ${
                      dragId === e.id ? "opacity-50" : ""
                    } ${dragOverId === e.id && dragId && dragId !== e.id ? "outline outline-2 outline-primary -outline-offset-2" : ""}`}
                  >
                    <td className="pl-2 sm:pl-3 py-1.5">
                      <button
                        type="button"
                        draggable={canReorder}
                        onDragStart={(ev) => {
                          if (!canReorder) {
                            ev.preventDefault();
                            return;
                          }
                          setDragId(e.id);
                          ev.dataTransfer.effectAllowed = "move";
                          ev.dataTransfer.setData("text/plain", e.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setDragOverId(null);
                        }}
                        disabled={!canReorder}
                        aria-label={`Reorder ${e.title}`}
                        title={canReorder ? "Drag to reorder" : "Clear search, filters, and sorting to reorder"}
                        className={`h-6 w-6 grid place-items-center rounded text-muted-foreground ${
                          canReorder ? "cursor-grab active:cursor-grabbing hover:text-foreground hover:bg-muted" : "cursor-not-allowed opacity-40"
                        }`}
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                    </td>
                    <td className="py-1.5 pl-1">
                      {e.cover_url ? (
                        <img
                          src={e.cover_url}
                          alt=""
                          className="h-24 w-16 rounded-md object-cover bg-muted"
                        />
                      ) : (
                        <div className="h-24 w-16 rounded-md bg-muted" />
                      )}
                    </td>
                    <td className="px-4 py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <input
                             key={`${e.id}-${e.title}`}
                             defaultValue={e.title}
                             onBlur={(ev) => {
                               void commitTitleEdit(e, ev.target.value, (v) => {
                                 ev.target.value = v;
                               });
                             }}
                            className="w-full bg-transparent outline-none focus:bg-input rounded px-2 py-1"
                          />
                          <div className="px-2">
                            <ChapterProgress chapter={e.chapter} total={e.total_chapters} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={e.type}
                         onChange={(ev) => void update(e.id, { type: ev.target.value as EntryType })}
                        aria-label={`Type for ${e.title}`}
                        className="w-full bg-transparent hover:bg-input rounded px-2 py-1 outline-none cursor-pointer"
                      >
                        {TYPES.map((t) => (
                          <option key={t} value={t} className="bg-card">
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1 justify-end">
                        <input
                          type="number"
                           key={`${e.id}-chapter-${e.chapter}`}
                           defaultValue={e.chapter}
                           onBlur={(ev) => {
                             const chapter = Number(ev.target.value) || 0;
                             if (chapter !== e.chapter) void update(e.id, { chapter });
                           }}
                          className="w-16 bg-transparent text-right outline-none focus:bg-input rounded px-2 py-1"
                        />
                        <button
                           onClick={() => void update(e.id, { chapter: e.chapter + 1 })}
                          className="opacity-0 group-hover:opacity-100 transition text-xs px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground"
                          title="+1 chapter"
                        >
                          +1
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={e.status}
                        onChange={(ev) =>
                           void update(e.id, { status: ev.target.value as EntryStatus })
                        }
                        aria-label={`Status for ${e.title}`}
                        className="w-full bg-transparent hover:bg-input rounded px-2 py-1 outline-none cursor-pointer"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s} className="bg-card">
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1 justify-end">
                        <input
                          type="number"
                           key={`${e.id}-reread-${e.reread}`}
                           defaultValue={e.reread}
                           onBlur={(ev) => {
                             const reread = Number(ev.target.value) || 0;
                             if (reread !== e.reread) void update(e.id, { reread });
                           }}
                          className="w-16 bg-transparent text-right outline-none focus:bg-input rounded px-2 py-1"
                        />
                        <button
                           onClick={() => void update(e.id, { reread: e.reread + 1 })}
                          className="opacity-0 group-hover:opacity-100 transition text-xs px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground"
                          title="+1 reread"
                        >
                          +1
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${e.title}"?`)) remove(e.id);
                        }}
                        aria-label={`Delete ${e.title}`}
                        className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-destructive text-lg leading-none"
                        title="Delete"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Backdrop (mobile) */}
        {panelOpen && (
          <div
            onClick={() => setPanelOpen(false)}
            className="lg:hidden fixed inset-0 z-30 bg-background/70"
          />
        )}

        {/* Side panel */}
        <aside
          className={`${panelOpen ? "flex" : "hidden"} flex-col min-h-0 bg-card fixed inset-y-0 right-0 z-40 w-[88%] max-w-sm border-l border-border shadow-xl safe-t safe-b lg:static lg:z-auto lg:w-[360px] lg:max-w-none lg:shadow-none lg:pt-0 lg:pb-0`}
        >
          <div className="px-4 py-2 border-b border-border flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Bulk import</h2>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[10px] text-muted-foreground uppercase tracking-wide">
                Title … Ch Status Type Reread
              </span>
              <button
                onClick={() => setPanelOpen(false)}
                aria-label="Close bulk import panel"
                className="h-7 w-7 grid place-items-center rounded-md border border-border hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="p-4 flex flex-col gap-2 flex-1 min-h-0">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={"Solo Leveling 179 Finished Manhwa 2\nOne Piece 1120 Ongoing Manga 0"}
              className="flex-1 min-h-0 resize-none bg-input rounded-md p-3 text-sm font-mono outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            />
            <div className="flex gap-2">
              <button
                onClick={runImport}
                className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
              >
                Import
              </button>
              <button
                onClick={() => {
                  setImportText("");
                  setImportMsg(null);
                }}
                className="h-9 px-3 rounded-md bg-secondary text-secondary-foreground text-sm hover:opacity-90"
              >
                Clear
              </button>
            </div>
            {importMsg && (
              <div className="text-xs space-y-1 max-h-24 overflow-auto">
                {importMsg.ok > 0 && (
                  <div className="text-accent">Added {importMsg.ok} entries.</div>
                )}
                {importMsg.errors.map((e, i) => (
                  <div key={i} className="text-destructive">
                    {e}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border p-4 flex gap-2">
            <button
              onClick={saveTxt}
              className="flex-1 h-9 rounded-md bg-accent text-accent-foreground text-sm font-medium hover:opacity-90"
            >
              Save .txt
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 h-9 rounded-md border border-border text-sm hover:bg-muted"
            >
              Load .txt
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={loadTxt}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}

function SearchDialog({
  onAdd,
  onClose,
}: {
  onAdd: (result: SearchResult) => Promise<boolean>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [addingId, setAddingId] = useState<number | string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setStatus("loading");
    const timer = setTimeout(() => {
      // AniList first (it's the primary, fastest-to-respond source and
      // supports request cancellation), then fold in MyAnimeList/Kitsu
      // results as they arrive so the list doesn't wait on the slowest
      // provider before showing anything.
      searchAniList(q, controller.signal)
        .then((r) => {
          if (cancelled) return;
          setResults(r);
          setStatus("idle");
        })
        .catch((err) => {
          if (cancelled || (err as Error).name === "AbortError") return;
          setStatus("error");
        });
      searchAllTrackers(q)
        .then((extra) => {
          if (cancelled || !extra.length) return;
          setResults((prev) => [...prev, ...extra]);
          setStatus("idle");
        })
        .catch(() => {
          /* extra providers are best-effort; AniList result (or its own error) still stands */
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const handleAdd = async (result: SearchResult) => {
    setAddingId(result.id);
    const ok = await onAdd(result);
    setAddingId(null);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4">
      <div className="w-full max-w-md max-h-[85dvh] flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Search & add a title</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search manga, manhwa, manhua…"
          className="h-10 px-3 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-[11px] text-muted-foreground -mt-1">
          Powered by AniList, MyAnimeList &amp; Kitsu.
        </p>
        <div className="flex-1 overflow-y-auto scroll-touch -mx-1 px-1 space-y-2">
          {status === "loading" && (
            <p className="text-xs text-muted-foreground px-1 py-6 text-center">Searching…</p>
          )}
          {status === "error" && (
            <p className="text-xs text-destructive px-1 py-6 text-center">
              Couldn't reach the search service. Try again in a moment.
            </p>
          )}
          {status === "idle" && query.trim().length >= 2 && results.length === 0 && (
            <p className="text-xs text-muted-foreground px-1 py-6 text-center">No matches.</p>
          )}
          {results.map((r) => (
            <div
              key={`${r.source ?? "anilist"}-${r.id}`}
              className="flex items-center gap-3 rounded-md border border-border p-2 hover:bg-muted/40"
            >
              {r.coverUrl ? (
                <img
                  src={r.coverUrl}
                  alt=""
                  className="h-28 w-20 shrink-0 rounded-md object-cover bg-muted"
                />
              ) : (
                <div className="h-28 w-20 shrink-0 rounded-md bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{r.title}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.type}
                  {r.author ? ` · ${r.author}` : ""}
                  {typeof r.totalChapters === "number" ? ` · ${r.totalChapters} ch.` : ""}
                  {r.source ? ` · ${r.source}` : ""}
                </div>
              </div>
              <button
                onClick={() => void handleAdd(r)}
                disabled={addingId === r.id}
                className="shrink-0 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50"
              >
                {addingId === r.id ? "Adding…" : "Add"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChapterProgress({ chapter, total }: { chapter: number; total: number | null | undefined }) {
  if (!total || total <= 0) {
    // No known total (never enriched, or the source had no chapter count) —
    // show the chapter count on its own instead of rendering nothing.
    return (
      <div className="text-[10px] text-muted-foreground tabular-nums">
        Ch. {chapter} · total chapters unknown
      </div>
    );
  }
  const pct = Math.min(100, Math.round((chapter / total) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {chapter}/{total} · {pct}%
      </span>
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string | number; big?: boolean }) {
  return (
    <div className="flex flex-col leading-tight">
      <span
        className={
          big
            ? "text-2xl font-bold text-primary tabular-nums"
            : "text-lg font-semibold tabular-nums"
        }
      >
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

function ProfileDialog({
  userId,
  email,
  onClose,
}: {
  userId: string;
  email: string;
  onClose: () => void;
}) {
  const [username, setUsername] = useState("");
  const [newEmail, setNewEmail] = useState(email);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .maybeSingle();
      if (!active) return;
      setUsername(data?.username ?? "");
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const notes: string[] = [];
    try {
      const uname = username.trim();
      if (uname.length > 40) throw new Error("Username must be 40 characters or fewer.");
      const { error: pErr } = await supabase
        .from("profiles")
        .upsert({ id: userId, username: uname || null }, { onConflict: "id" });
      if (pErr)
        throw new Error(
          pErr.code === "23505" ? "That username is already taken." : pErr.message,
        );
      notes.push("Profile saved.");

      const trimmedEmail = newEmail.trim();
      if (trimmedEmail && trimmedEmail !== email) {
        const { error } = await supabase.auth.updateUser(
          { email: trimmedEmail },
          { emailRedirectTo: window.location.origin },
        );
        if (error) throw error;
        notes.push("Check your new email to confirm the change.");
      }

      if (password) {
        if (password.length < 6) throw new Error("Password must be at least 6 characters.");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword("");
        notes.push("Password updated.");
      }
      setMsg({ text: notes.join(" ") });
    } catch (err) {
      setMsg({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4">
      <form
        onSubmit={save}
        className="w-full max-w-sm flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Your profile</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="h-7 w-7 grid place-items-center rounded-md border border-border hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="text-xs text-muted-foreground">Username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={loading}
          maxLength={40}
          placeholder={loading ? "Loading…" : "your name"}
          className="h-9 px-3 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <label className="text-xs text-muted-foreground">Email</label>
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          className="h-9 px-3 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <label className="text-xs text-muted-foreground">New password</label>
        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank to keep current"
            className="w-full h-9 pl-3 pr-10 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? "Hide password" : "Show password"}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-8 grid place-items-center rounded text-muted-foreground hover:text-foreground"
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>


        <button
          type="submit"
          disabled={busy || loading}
          className="h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        {msg && (
          <div className={`text-xs ${msg.error ? "text-destructive" : "text-accent"}`}>
            {msg.text}
          </div>
        )}
      </form>
    </div>
  );
}

function SortTh({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  className,
  align,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  className?: string;
  align?: "right";
}) {
  const active = sortKey === k;
  const arrow = active ? (sortDir === "asc" ? "▲" : "▼") : "";
  return (
    <th className={`font-medium ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground transition ${
          align === "right" ? "justify-end w-full" : ""
        } ${active ? "text-foreground" : ""}`}
      >
        <span>{label}</span>
        <span className="text-[9px] w-2">{arrow}</span>
      </button>
    </th>
  );
}

function statusColorClasses(status: EntryStatus) {
  return status === "Ongoing"
    ? "text-ongoing"
    : status === "Dropped"
      ? "text-dropped"
      : status === "Cancelled"
        ? "text-muted-foreground"
        : "text-finished";
}

function statusRowBorder(status: EntryStatus) {
  return status === "Ongoing"
    ? "border-l-2 border-l-ongoing"
    : status === "Dropped"
      ? "border-l-2 border-l-dropped"
      : status === "Cancelled"
        ? "border-l-2 border-l-muted-foreground/50"
        : "border-l-2 border-l-finished";
}

function StatusPill({ status, count }: { status: EntryStatus; count: number }) {
  const bg =
    status === "Ongoing"
      ? "bg-ongoing/15"
      : status === "Dropped"
        ? "bg-dropped/15"
        : status === "Cancelled"
          ? "bg-cancelled/25"
          : "bg-finished/15";
  return (
    <span className={`px-2 py-1 rounded-full font-medium ${bg} ${statusColorClasses(status)}`}>
      {count} {status}
    </span>
  );
}
