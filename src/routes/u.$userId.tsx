import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, ArrowDown, BookOpen, Loader2, Search, User, X } from "lucide-react";
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
  cover_url?: string | null;
  created_at: string;
};

type SortKey = "title" | "type" | "chapter" | "status" | "created_at";
type SortDir = "asc" | "desc";

const TYPES: EntryType[] = ["Manga", "Manhwa", "Manhua", "Comic"];
const STATUSES: EntryStatus[] = ["Ongoing", "Dropped", "Cancelled", "Finished"];

function statusClasses(status: EntryStatus) {
  return status === "Ongoing"
    ? "text-ongoing bg-ongoing/12 border-ongoing/30"
    : status === "Dropped"
      ? "text-dropped bg-dropped/12 border-dropped/30"
      : status === "Cancelled"
        ? "text-muted-foreground bg-cancelled/20 border-border"
        : "text-finished bg-finished/12 border-finished/30";
}

function rowBorder(status: EntryStatus) {
  return status === "Ongoing"
    ? "border-l-2 border-l-ongoing"
    : status === "Dropped"
      ? "border-l-2 border-l-dropped"
      : status === "Cancelled"
        ? "border-l-2 border-l-muted-foreground/50"
        : "border-l-2 border-l-finished";
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

const PAGE_SIZE = 24;

function PublicList() {
  const { userId } = Route.useParams();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const [filter, setFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<EntryType | "">("");
  const [statusFilter, setStatusFilter] = useState<EntryStatus | "">("");
  const [sortKey, setSortKey] = useState<SortKey | null>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [statusCounts, setStatusCounts] = useState<Record<EntryStatus, number>>({
    Ongoing: 0,
    Dropped: 0,
    Cancelled: 0,
    Finished: 0,
  });

  // Debounce the free-text search so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilter(filter.trim()), 300);
    return () => clearTimeout(t);
  }, [filter]);

  // Username + per-status counts: cheap, fetched once (counts use head:true so no rows come back).
  useEffect(() => {
    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .maybeSingle();
      setUsername(profile?.username ?? "Unknown user");

      const counts = await Promise.all(
        STATUSES.map((s) =>
          supabase
            .from("entries")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("status", s)
        )
      );
      setStatusCounts({
        Ongoing: counts[0].count ?? 0,
        Dropped: counts[1].count ?? 0,
        Cancelled: counts[2].count ?? 0,
        Finished: counts[3].count ?? 0,
      });
    })();
  }, [userId]);

  const requestId = useRef(0);

  const buildQuery = useCallback(
    (from: number, to: number) => {
      let q = supabase
        .from("entries")
        .select("id, title, type, chapter, status, cover_url, created_at", { count: "exact" })
        .eq("user_id", userId);

      if (typeFilter) q = q.eq("type", typeFilter);
      if (statusFilter) q = q.eq("status", statusFilter);
      if (debouncedFilter) q = q.ilike("title", `%${debouncedFilter}%`);

      const col = sortKey ?? "title";
      q = q.order(col, { ascending: sortKey ? sortDir === "asc" : true });
      if (sortKey === "title") q = q.order("id", { ascending: true });

      return q.range(from, to);
    },
    [userId, typeFilter, statusFilter, debouncedFilter, sortKey, sortDir]
  );

  // Fetch just the first page whenever filters/sort change; a fresh page replaces the list.
  useEffect(() => {
    if (!userId) return;
    const myId = ++requestId.current;
    setLoading(true);
    (async () => {
      const { data, count } = await buildQuery(0, PAGE_SIZE - 1);
      if (myId !== requestId.current) return; // a newer request superseded this one
      setEntries((data ?? []) as Entry[]);
      setTotalCount(count ?? 0);
      setHasMore((count ?? 0) > (data?.length ?? 0));
      setLoading(false);
    })();
  }, [buildQuery, userId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    const myId = requestId.current;
    setLoadingMore(true);
    const { data } = await buildQuery(entries.length, entries.length + PAGE_SIZE - 1);
    if (myId !== requestId.current) return; // filters changed mid-flight; drop this page
    setEntries((prev) => [...prev, ...((data ?? []) as Entry[])]);
    setHasMore((data?.length ?? 0) === PAGE_SIZE);
    setLoadingMore(false);
  }, [buildQuery, entries.length, hasMore, loading, loadingMore]);

  // Infinite scroll: load the next page only once the sentinel row scrolls into view.
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entriesObserved) => {
        if (entriesObserved[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

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

  function SortHeader({ label, k, className }: { label: string; k: SortKey; className?: string }) {
    const active = sortKey === k;
    return (
      <th className={`font-medium ${className ?? ""}`}>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={`inline-flex items-center gap-1 uppercase tracking-wide text-xs transition-colors hover:text-foreground ${
            active ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {label}
          {active &&
            (sortDir === "asc" ? (
              <ArrowUp className="h-3 w-3" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            ))}
        </button>
      </th>
    );
  }

  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 h-[26rem] w-[26rem] rounded-full bg-primary/12 blur-[120px]" />
        <div className="absolute -bottom-48 -right-24 h-[24rem] w-[24rem] rounded-full bg-accent/10 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-10">
        <Link
          to="/users"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
          Back to users
        </Link>

        <div className="mt-4 flex items-center gap-3.5">
          <div className="h-12 w-12 shrink-0 rounded-full bg-primary/15 border border-primary/30 grid place-items-center text-primary font-semibold">
            {initials(username)}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight truncate">{username}'s list</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {loading ? "Loading…" : `${totalCount ?? entries.length} titles`}
            </p>
          </div>
        </div>

        {!loading && (totalCount ?? 0) > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {STATUSES.map((s) => (
              <span
                key={s}
                className={`px-2.5 py-1 rounded-full font-semibold border whitespace-nowrap text-xs ${statusClasses(s)}`}
              >
                {statusCounts[s]} {s}
              </span>
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[10rem]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search titles…"
              className="w-full h-10 pl-9 pr-8 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary/40 transition-all"
            />
            {filter && (
              <button
                type="button"
                onClick={() => setFilter("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as EntryType | "")}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 cursor-pointer"
          >
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as EntryStatus | "")}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 cursor-pointer"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {(filter || typeFilter || statusFilter) && (
            <button
              type="button"
              onClick={() => {
                setFilter("");
                setTypeFilter("");
                setStatusFilter("");
              }}
              className="h-10 px-3 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-border/80 bg-card/40">
          {loading ? (
            <div className="divide-y divide-border">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-14 w-10 rounded bg-muted animate-pulse shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-1/2 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-1/4 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left border-b border-border">
                  <tr>
                    <th className="w-14 px-3 py-2.5"></th>
                    <SortHeader label="Title" k="title" className="text-left px-3 py-2.5" />
                    <SortHeader label="Type" k="type" className="text-left px-3 py-2.5" />
                    <SortHeader label="Chapter" k="chapter" className="text-left px-3 py-2.5" />
                    <SortHeader label="Status" k="status" className="text-left px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {entries.map((e) => (
                    <tr key={e.id} className={`group hover:bg-secondary/40 transition-colors ${rowBorder(e.status)}`}>
                      <td className="px-3 py-2">
                        <a
                          href={`https://anilist.co/search/manga?search=${encodeURIComponent(e.title)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${e.title} details on AniList`}
                          title={`Open "${e.title}" on AniList`}
                          className="block rounded-md transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {e.cover_url ? (
                            <img
                              src={e.cover_url}
                              alt={`${e.title} cover`}
                              loading="lazy"
                              className="h-14 w-10 rounded-md object-cover shadow-sm ring-1 ring-border/60 group-hover:ring-primary/30 transition-all"
                            />
                          ) : (
                            <div className="h-14 w-10 rounded-md bg-muted grid place-items-center">
                              <BookOpen className="h-4 w-4 text-muted-foreground/40" />
                            </div>
                          )}
                        </a>
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground max-w-[22rem]">
                        <span className="line-clamp-2">{e.title}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{e.type}</td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">Ch. {e.chapter}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap ${statusClasses(e.status)}`}>
                          {e.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-16 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <div className="h-10 w-10 rounded-full bg-secondary grid place-items-center">
                            <User className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {(totalCount ?? 0) === 0 ? "This list is empty." : "No titles match your filters."}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {hasMore && entries.length > 0 && (
                    <tr ref={sentinelRef}>
                      <td colSpan={5} className="px-3 py-4 text-center">
                        {loadingMore ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Loading more…
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={loadMore}
                            className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Load more
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
