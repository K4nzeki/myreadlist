import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/u/$userId")({
  component: PublicList,
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
  cover_url?: string | null;
};

type SortKey = "title" | "type" | "chapter" | "status" | "reread";
type SortDir = "asc" | "desc";

const TYPES: EntryType[] = ["Manga", "Manhwa", "Manhua", "Comic"];
const STATUSES: EntryStatus[] = ["Ongoing", "Dropped", "Cancelled", "Finished"];

function PublicList() {
  const { userId } = Route.useParams();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<EntryType | "">("");
  const [statusFilter, setStatusFilter] = useState<EntryStatus | "">("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    (async () => {
      const [{ data: profile }, { data: rows }] = await Promise.all([
        supabase.from("profiles").select("username").eq("id", userId).maybeSingle(),
        supabase
          .from("entries")
          .select("id, title, type, chapter, status, reread, cover_url")
          .eq("user_id", userId)
          .order("created_at", { ascending: true }),
      ]);
      setUsername(profile?.username ?? "Unknown user");
      setEntries((rows ?? []) as Entry[]);
      setLoading(false);
    })();
  }, [userId]);

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

    if (sortKey) {
      list.sort((a, b) => {
        let cmp = 0;
        if (sortKey === "chapter" || sortKey === "reread") {
          cmp = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
        } else {
          cmp = String(a[sortKey]).localeCompare(String(b[sortKey]));
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
    } else {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return list;
  }, [entries, filter, typeFilter, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir("asc");
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading list…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link
        to="/users"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={16} />
        Back to users
      </Link>
      <h1 className="mt-4 text-xl font-bold text-foreground">{username}'s list</h1>
      <p className="mt-1 text-sm text-muted-foreground">{entries.length} titles</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search…"
          className="h-9 flex-1 min-w-[10rem] rounded-md border border-border bg-background px-3 text-sm"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as EntryType | "")}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as EntryStatus | "")}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="w-14 px-3 py-2 font-medium">Cover</th>
              {(["title", "type", "chapter", "status", "reread"] as SortKey[]).map((k) => (
                <th
                  key={k}
                  onClick={() => toggleSort(k)}
                  className="cursor-pointer select-none px-3 py-2 font-medium capitalize"
                >
                  {k}
                  {sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2">
                  {e.cover_url ? (
                    <img
                      src={e.cover_url}
                      alt={`${e.title} cover`}
                      loading="lazy"
                      className="h-14 w-10 rounded object-cover border border-border"
                    />
                  ) : (
                    <div className="h-14 w-10 rounded bg-muted" />
                  )}
                </td>
                <td className="px-3 py-2 font-medium text-foreground">{e.title}</td>
                <td className="px-3 py-2 text-muted-foreground">{e.type}</td>
                <td className="px-3 py-2">{e.chapter}</td>
                <td className="px-3 py-2">{e.status}</td>
                <td className="px-3 py-2">{e.reread}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No titles found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
