import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { Eye, EyeOff, Menu, User, X } from "lucide-react";
import { toast } from "sonner";

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

type EntryType = "Manga" | "Manhwa" | "Manhua" | "Comic";
type EntryStatus = "Ongoing" | "Dropped" | "Cancelled" | "Finished";

type Entry = {
  id: string;
  title: string;
  type: EntryType;
  chapter: number;
  status: EntryStatus;
  reread: number;
  created_at?: string;
};

const TYPES: EntryType[] = ["Manga", "Manhwa", "Manhua", "Comic"];
const STATUSES: EntryStatus[] = ["Ongoing", "Dropped", "Cancelled", "Finished"];

type SortKey = "title" | "type" | "chapter" | "status" | "reread" | "created_at";
type SortDir = "asc" | "desc";

function serialize(entries: Entry[]) {
  return entries
    .map((e) => `${e.title}|${e.chapter}|${e.status}|${e.type}|${e.reread}`)
    .join("\n");
}

function normalizeType(raw: string): EntryType | null {
  const found = TYPES.find((t) => t.toLowerCase() === raw.toLowerCase());
  return found ?? null;
}
function normalizeStatus(raw: string): EntryStatus | null {
  const found = STATUSES.find((s) => s.toLowerCase() === raw.toLowerCase());
  return found ?? null;
}

type Parsed = Omit<Entry, "id">;

function parsePipeLine(line: string): Parsed | null {
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

function parseSpaceLine(line: string): { entry?: Parsed; error?: string } {
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
    return (
      <div className="h-screen w-screen grid place-items-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (!session) return <AuthPanel />;
  return <TrackerApp userId={session.user.id} email={session.user.email ?? ""} />;
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
  const [loading, setLoading] = useState(true);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<{ ok: number; errors: string[] } | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [statsOpen, setStatsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const reportDatabaseError = useCallback((action: string, error: { message: string }) => {
    const message = `${action} failed: ${error.message}`;
    console.error(`[Panels database] ${message}`, error);
    setSyncError(message);
    toast.error(message);
  }, []);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from("entries")
      .select("id, title, type, chapter, status, reread, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
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
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
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
          const row = payload.new as Entry;
          setEntries((prev) => {
            const idx = prev.findIndex((e) => e.id === row.id);
            const clean: Entry = {
              id: row.id,
              title: row.title,
              type: row.type,
              chapter: row.chapter,
              status: row.status,
              reread: row.reread,
            };
            if (idx === -1) return [clean, ...prev];
            const next = [...prev];
            next[idx] = clean;
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
    const list = !q
      ? entries
      : entries.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            e.type.toLowerCase().includes(q) ||
            e.status.toLowerCase().includes(q),
        );
    if (!sortKey) return list;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      if (sortKey === "created_at") return String(av) < String(bv) ? -dir : String(av) > String(bv) ? dir : 0;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
    });
  }, [entries, filter, sortKey, sortDir]);

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
      const { data, error } = await supabase
        .from("entries")
        .update(patch)
        .eq("id", id)
        .eq("user_id", userId)
        .select("id, title, type, chapter, status, reread, created_at")
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
      return true;
    },
    [reportDatabaseError, userId],
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
  const addBlank = async () => {
    const taken = new Set(entries.map((e) => e.title.trim().toLowerCase()));
    let title = "New title";
    let n = 2;
    while (taken.has(title.toLowerCase())) title = `New title ${n++}`;
    const row = { user_id: userId, title, type: "Manga", chapter: 0, status: "Ongoing", reread: 0 };
    const { data, error } = await supabase
      .from("entries")
      .insert(row)
      .select("id, title, type, chapter, status, reread, created_at")
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
      const rows = toInsert.map((p) => ({ ...p, user_id: userId }));
      const { data, error } = await supabase
        .from("entries")
        .insert(rows)
        .select("id, title, type, chapter, status, reread, created_at");
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
        const rows = loaded.map((p) => ({ ...p, user_id: userId }));
        const { data, error } = await supabase
          .from("entries")
          .insert(rows)
          .select("id, title, type, chapter, status, reread, created_at");
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

  if (loading) {
    return (
      <div className="h-screen w-screen grid place-items-center bg-background text-muted-foreground text-sm">
        Loading your list…
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground flex flex-col">
      {syncError && (
        <div className="px-3 sm:px-6 py-1.5 text-xs bg-destructive/15 text-destructive border-b border-destructive/30">
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
          onClick={() => setPanelOpen((v) => !v)}
          aria-label="Toggle bulk import panel"
          aria-expanded={panelOpen}
          className="ml-auto order-1 lg:order-none shrink-0 h-9 w-9 grid place-items-center rounded-md border border-border hover:bg-muted"
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
            <span className="text-muted-foreground hidden sm:inline">{email}</span>
            <button
              onClick={() => setProfileOpen(true)}
              className="h-8 px-3 rounded-md border border-border hover:bg-muted inline-flex items-center gap-1.5"
            >
              <User className="h-3.5 w-3.5" />
              Profile
            </button>
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
        <ProfileDialog userId={userId} email={email} onClose={() => setProfileOpen(false)} />
      )}

      {/* Status-by-type breakdown */}
      <div className="border-b border-border px-3 sm:px-6 py-1.5">
        <button
          onClick={() => setStatsOpen((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {statsOpen ? "▾" : "▸"} Status by type
        </button>
        {statsOpen && (
          <div className="mt-2 overflow-x-auto">
            <table className="text-xs min-w-[420px]">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-2 py-1">Type</th>
                  {STATUSES.map((s) => (
                    <th key={s} className="text-right font-medium px-2 py-1">
                      {s}
                    </th>
                  ))}
                  <th className="text-right font-medium px-2 py-1">Total</th>
                </tr>
              </thead>
              <tbody>
                {TYPES.map((t) => (
                  <tr key={t} className="border-t border-border">
                    <td className="px-2 py-1 font-medium">{t}</td>
                    {STATUSES.map((s) => (
                      <td key={s} className="px-2 py-1 text-right tabular-nums">
                        {stats.matrix[t][s]}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right tabular-nums font-semibold">{stats.types[t]}</td>
                  </tr>
                ))}
                <tr className="border-t border-border text-muted-foreground">
                  <td className="px-2 py-1 font-medium">All</td>
                  {STATUSES.map((s) => (
                    <td key={s} className="px-2 py-1 text-right tabular-nums">
                      {stats.statuses[s]}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right tabular-nums font-semibold">{stats.total}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Main grid */}
      <main className="flex-1 min-h-0 flex relative">
        {/* Table panel */}
        <section className="flex flex-col min-h-0 flex-1 border-r border-border">
          <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-border">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="flex-1 min-w-0 h-9 px-3 rounded-md bg-input text-foreground placeholder:text-muted-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              value={sortValue}
              onChange={(e) => applySortValue(e.target.value)}
              className="h-9 px-2 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring cursor-pointer shrink-0 max-w-[9rem]"
              title="Sort"
            >
              <option value="">Sort</option>
              <option value="created_at:desc">Latest added</option>
              <option value="created_at:asc">Oldest added</option>
              <option value="title:asc">Title A → Z</option>
              <option value="title:desc">Title Z → A</option>
              <option value="chapter:desc">Chapter High → Low</option>
              <option value="chapter:asc">Chapter Low → High</option>
            </select>
            <button
              onClick={addBlank}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 shrink-0"
            >
              +<span className="hidden sm:inline"> Add</span>
            </button>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground z-10">
                <tr>
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
                    <td colSpan={6} className="px-4 py-16 text-center text-muted-foreground">
                      {entries.length === 0
                        ? "No titles yet. Add one, or paste a list on the right."
                        : "Nothing matches that filter."}
                    </td>
                  </tr>
                )}
                {filtered.map((e) => (
                  <tr
                    key={e.id}
                    className={`border-t border-border hover:bg-muted/40 group ${statusRowBorder(e.status)}`}
                  >
                    <td className="px-4 py-1.5">
                      <input
                         key={`${e.id}-${e.title}`}
                         defaultValue={e.title}
                         onBlur={(ev) => {
                           const title = ev.target.value.trim();
                           if (!title) {
                             ev.target.value = e.title;
                             toast.error("A title cannot be empty");
                           } else if (title !== e.title) {
                             void update(e.id, { title }).then((saved) => {
                               if (!saved) ev.target.value = e.title;
                             });
                           }
                         }}
                        className="w-full bg-transparent outline-none focus:bg-input rounded px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={e.type}
                         onChange={(ev) => void update(e.id, { type: ev.target.value as EntryType })}
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
                      <input
                        type="number"
                         key={`${e.id}-reread-${e.reread}`}
                         defaultValue={e.reread}
                         onBlur={(ev) => {
                           const reread = Number(ev.target.value) || 0;
                           if (reread !== e.reread) void update(e.id, { reread });
                         }}
                        className="w-full bg-transparent text-right outline-none focus:bg-input rounded px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${e.title}"?`)) remove(e.id);
                        }}
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
          className={`${panelOpen ? "flex" : "hidden"} flex-col min-h-0 bg-card fixed inset-y-0 right-0 z-40 w-[88%] max-w-sm border-l border-border shadow-xl lg:static lg:z-auto lg:w-[360px] lg:max-w-none lg:shadow-none`}
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
