import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

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
const STORAGE_KEY = "panels.entries.v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

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

function parsePipeLine(line: string): Entry | null {
  const parts = line.split("|").map((p) => p.trim());
  if (parts.length < 5) return null;
  const [title, chap, status, type, reread] = parts;
  const t = normalizeType(type);
  const s = normalizeStatus(status);
  const c = Number(chap);
  const r = Number(reread);
  if (!title || !t || !s || Number.isNaN(c) || Number.isNaN(r)) return null;
  return { id: uid(), title, type: t, chapter: c, status: s, reread: r };
}

function parseSpaceLine(line: string): { entry?: Entry; error?: string } {
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
  return { entry: { id: uid(), title, type: t, chapter: c, status: s, reread: r } };
}

function loadInitial(): Entry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Entry[];
  } catch {
    return [];
  }
}

function Tracker() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<{ ok: number; errors: string[] } | null>(null);
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEntries(loadInitial());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries, hydrated]);

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
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.status.toLowerCase().includes(q),
    );
  }, [entries, filter]);

  const update = (id: string, patch: Partial<Entry>) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const remove = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id));
  const addBlank = () =>
    setEntries((prev) => {
      const taken = new Set(prev.map((e) => e.title.trim().toLowerCase()));
      let title = "New title";
      let n = 2;
      while (taken.has(title.toLowerCase())) title = `New title ${n++}`;
      return [
        { id: uid(), title, type: "Manga", chapter: 0, status: "Ongoing", reread: 0 },
        ...prev,
      ];
    });

  const runImport = () => {
    const lines = importText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const added: Entry[] = [];
    const errors: string[] = [];
    const existing = new Set(entries.map((e) => e.title.trim().toLowerCase()));
    lines.forEach((line, i) => {
      const piped = line.includes("|") ? parsePipeLine(line) : null;
      if (piped) {
        const key = piped.title.trim().toLowerCase();
        if (existing.has(key)) {
          errors.push(`Line ${i + 1}: duplicate title "${piped.title}"`);
        } else {
          existing.add(key);
          added.push(piped);
        }
        return;
      }
      const { entry, error } = parseSpaceLine(line);
      if (entry) {
        const key = entry.title.trim().toLowerCase();
        if (existing.has(key)) {
          errors.push(`Line ${i + 1}: duplicate title "${entry.title}"`);
        } else {
          existing.add(key);
          added.push(entry);
        }
      } else errors.push(`Line ${i + 1}: ${error}`);
    });
    if (added.length) setEntries((prev) => [...added, ...prev]);
    setImportMsg({ ok: added.length, errors });
    if (added.length && !errors.length) setImportText("");
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
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const loaded: Entry[] = [];
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const e = parsePipeLine(line);
        if (e) loaded.push(e);
      }
      setEntries(loaded);
    };
    reader.readAsText(file);
    ev.target.value = "";
  };

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
                  <th className="text-left font-medium px-4 py-2">Title</th>
                  <th className="text-left font-medium px-2 py-2 w-28">Type</th>
                  <th className="text-right font-medium px-2 py-2 w-24">Ch.</th>
                  <th className="text-left font-medium px-2 py-2 w-32">Status</th>
                  <th className="text-right font-medium px-2 py-2 w-20">Reread</th>
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
