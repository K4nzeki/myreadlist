import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export const Route = createFileRoute("/")({
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
};

const TYPES: EntryType[] = ["Manga", "Manhwa", "Manhua", "Comic"];
const STATUSES: EntryStatus[] = ["Ongoing", "Dropped", "Cancelled", "Finished"];

type SortKey = "title" | "type" | "chapter" | "status" | "reread";
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
          options: { emailRedirectTo: window.location.origin },
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
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min 6)"
          className="h-9 px-3 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring"
        />
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
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("entries")
        .select("id, title, type, chapter, status, reread")
        .order("created_at", { ascending: false });
      if (!error && data) setEntries(data as Entry[]);
      setLoading(false);
    })();
  }, [userId]);

  const stats = useMemo(() => {
    const s = {
      chapters: 0,
      total: entries.length,
      rereads: 0,
      types: { Manga: 0, Manhwa: 0, Manhua: 0, Comic: 0 } as Record<EntryType, number>,
      statuses: { Ongoing: 0, Dropped: 0, Cancelled: 0, Finished: 0 } as Record<EntryStatus, number>,
    };
    for (const e of entries) {
      s.chapters += Number(e.chapter) || 0;
      s.rereads += Number(e.reread) || 0;
      s.types[e.type]++;
      s.statuses[e.status]++;
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
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
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

  const update = (id: string, patch: Partial<Entry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    void supabase.from("entries").update(patch).eq("id", id);
  };
  const remove = async (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    await supabase.from("entries").delete().eq("id", id);
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
      .select("id, title, type, chapter, status, reread")
      .single();
    if (!error && data) setEntries((prev) => [data as Entry, ...prev]);
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
        .select("id, title, type, chapter, status, reread");
      if (error) errors.push(error.message);
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
        const { data } = await supabase
          .from("entries")
          .insert(rows)
          .select("id, title, type, chapter, status, reread");
        if (data) setEntries((prev) => [...(data as Entry[]), ...prev]);
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
      {/* Header + stats */}
      <header className="border-b border-border px-6 py-3 flex items-center gap-6 flex-wrap">
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-primary">Panels</span>
          </h1>
          <span className="text-xs text-muted-foreground">reading tracker</span>
        </div>

        <div className="flex items-center gap-5 flex-wrap text-sm ml-auto">
          <Stat label="Chapters" value={stats.chapters.toLocaleString()} big />
          <Stat label="Titles" value={stats.total} />
          <Stat label="Rereads" value={stats.rereads} />
          <div className="h-8 w-px bg-border" />
          <div className="flex gap-3 text-xs">
            {TYPES.map((t) => (
              <span key={t} className="text-muted-foreground">
                <span className="text-foreground font-semibold">{stats.types[t]}</span> {t}
              </span>
            ))}
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="flex gap-2 text-xs">
            {STATUSES.map((s) => (
              <StatusPill key={s} status={s} count={stats.statuses[s]} />
            ))}
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground hidden sm:inline">{email}</span>
            <button
              onClick={() => supabase.auth.signOut()}
              className="h-8 px-3 rounded-md border border-border hover:bg-muted"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main grid */}
      <main className="flex-1 grid grid-cols-[1fr_360px] min-h-0">
        {/* Table panel */}
        <section className="flex flex-col min-h-0 border-r border-border">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by title, type, status…"
              className="flex-1 h-9 px-3 rounded-md bg-input text-foreground placeholder:text-muted-foreground text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              value={sortValue}
              onChange={(e) => applySortValue(e.target.value)}
              className="h-9 px-2 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring cursor-pointer"
              title="Sort"
            >
              <option value="">Sort: Default</option>
              <option value="title:asc">Title A → Z</option>
              <option value="title:desc">Title Z → A</option>
              <option value="chapter:desc">Chapter High → Low</option>
              <option value="chapter:asc">Chapter Low → High</option>
            </select>
            <button
              onClick={addBlank}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              + Add
            </button>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm">
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
                  <tr key={e.id} className="border-t border-border hover:bg-muted/40 group">
                    <td className="px-4 py-1.5">
                      <input
                        value={e.title}
                        onChange={(ev) => update(e.id, { title: ev.target.value })}
                        className="w-full bg-transparent outline-none focus:bg-input rounded px-2 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={e.type}
                        onChange={(ev) => update(e.id, { type: ev.target.value as EntryType })}
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
                          value={e.chapter}
                          onChange={(ev) =>
                            update(e.id, { chapter: Number(ev.target.value) || 0 })
                          }
                          className="w-16 bg-transparent text-right outline-none focus:bg-input rounded px-2 py-1"
                        />
                        <button
                          onClick={() => update(e.id, { chapter: e.chapter + 1 })}
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
                          update(e.id, { status: ev.target.value as EntryStatus })
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
                        value={e.reread}
                        onChange={(ev) =>
                          update(e.id, { reread: Number(ev.target.value) || 0 })
                        }
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

        {/* Side panel */}
        <aside className="flex flex-col min-h-0 bg-card">
          <div className="px-4 py-2 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">Bulk import</h2>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Title … Ch Status Type Reread
            </span>
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

function StatusPill({ status, count }: { status: EntryStatus; count: number }) {
  const color =
    status === "Ongoing"
      ? "bg-ongoing/15 text-ongoing"
      : status === "Dropped"
        ? "bg-dropped/15 text-dropped"
        : status === "Cancelled"
          ? "bg-cancelled/25 text-muted-foreground"
          : "bg-finished/15 text-finished";
  return (
    <span className={`px-2 py-1 rounded-full font-medium ${color}`}>
      {count} {status}
    </span>
  );
}
