import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, ChevronRight, Layers, Library, Trophy, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/users")({
  component: UserList,
});

type Profile = { id: string; username: string | null };

type LeaderboardEntry = {
  user_id: string;
  username: string | null;
  total_chapters: number;
  total_series: number;
};

const RANK_STYLES = [
  "bg-amber-500/15 text-amber-500 border-amber-500/30", // 1st
  "bg-slate-400/15 text-slate-400 border-slate-400/30", // 2nd
  "bg-orange-600/15 text-orange-600 border-orange-600/30", // 3rd
];

const AVATAR_HUES = [
  "bg-primary/15 text-primary",
  "bg-accent/15 text-accent",
  "bg-ongoing/15 text-ongoing",
  "bg-finished/15 text-finished",
  "bg-dropped/15 text-dropped",
];

function hueFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

function LeaderboardList({
  title,
  icon,
  entries,
  metricLabel,
  metricKey,
}: {
  title: string;
  icon: React.ReactNode;
  entries: LeaderboardEntry[];
  metricLabel: string;
  metricKey: "total_chapters" | "total_series";
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card/60 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/70">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground text-center">Nothing to rank yet.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {entries.map((e, i) => (
            <li key={e.user_id} className="flex items-center gap-3 px-4 py-2.5">
              <span
                className={`h-6 w-6 shrink-0 rounded-full border grid place-items-center text-[11px] font-bold ${
                  i < 3 ? RANK_STYLES[i] : "bg-secondary text-muted-foreground border-border"
                }`}
              >
                {i + 1}
              </span>
              <Link
                to="/u/$userId"
                params={{ userId: e.user_id }}
                className="min-w-0 flex-1 text-sm font-medium truncate hover:text-primary transition-colors"
              >
                {e.username}
              </Link>
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {e[metricKey].toLocaleString()}
                <span className="ml-1 text-xs font-normal text-muted-foreground">{metricLabel}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UserList() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<"browse" | "leaderboard">("browse");
  const [byChapters, setByChapters] = useState<LeaderboardEntry[]>([]);
  const [bySeries, setBySeries] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, username")
      .not("username", "is", null)
      .order("username", { ascending: true })
      .then(({ data }) => {
        setProfiles(data ?? []);
        setLoading(false);
      });
  }, []);

  // Leaderboard reads from a small aggregated view (per-user totals), not the
  // raw entries table, so ranking every user never means fetching every entry.
  useEffect(() => {
    if (tab !== "leaderboard") return;
    let cancelled = false;
    setLeaderboardLoading(true);
    (async () => {
      const [chaptersRes, seriesRes] = await Promise.all([
        supabase
          .from("leaderboard_stats")
          .select("user_id, username, total_chapters, total_series")
          .order("total_chapters", { ascending: false })
          .limit(10),
        supabase
          .from("leaderboard_stats")
          .select("user_id, username, total_chapters, total_series")
          .order("total_series", { ascending: false })
          .limit(10),
      ]);
      if (cancelled) return;
      setByChapters((chaptersRes.data ?? []) as LeaderboardEntry[]);
      setBySeries((seriesRes.data ?? []) as LeaderboardEntry[]);
      setLeaderboardLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 h-[26rem] w-[26rem] rounded-full bg-primary/15 blur-[120px]" />
        <div className="absolute -bottom-48 -right-24 h-[24rem] w-[24rem] rounded-full bg-accent/10 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-2xl px-4 sm:px-6 py-8 sm:py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
          Back to tracker
        </Link>

        <div className="mt-6 flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/15 border border-primary/30 grid place-items-center shrink-0">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Browse users</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {loading ? "Loading…" : `${profiles.length} public ${profiles.length === 1 ? "list" : "lists"} to explore`}
            </p>
          </div>
        </div>

        <div className="mt-6 inline-flex items-center gap-1 rounded-lg border border-border/80 bg-card/60 p-1">
          <button
            type="button"
            onClick={() => setTab("browse")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "browse" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Browse
          </button>
          <button
            type="button"
            onClick={() => setTab("leaderboard")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "leaderboard" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Trophy className="h-3.5 w-3.5" />
            Leaderboard
          </button>
        </div>

        <div className="mt-6">
          {tab === "browse" ? (
            loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-16 rounded-xl border border-border/70 bg-card/60 animate-pulse"
                  />
                ))}
              </div>
            ) : profiles.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
                <div className="h-12 w-12 rounded-full bg-secondary grid place-items-center">
                  <Layers className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">No public users yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Once someone sets a username, their list will show up here.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {profiles.map((p) => (
                  <li key={p.id}>
                    <Link
                      to="/u/$userId"
                      params={{ userId: p.id }}
                      className="group flex items-center gap-3.5 rounded-xl border border-border/80 bg-card px-4 py-3.5 transition-all hover:border-primary/40 hover:bg-secondary/40 hover:shadow-lg hover:shadow-black/5"
                    >
                      <div
                        className={`h-10 w-10 shrink-0 rounded-full grid place-items-center text-sm font-semibold ${hueFor(p.id)}`}
                      >
                        {initials(p.username ?? "?")}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate">{p.username}</div>
                        <div className="text-xs text-muted-foreground">View reading list</div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : leaderboardLoading ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-48 rounded-xl border border-border/70 bg-card/60 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <LeaderboardList
                title="Most chapters read"
                icon={<BookOpen className="h-4 w-4 text-primary" />}
                entries={byChapters}
                metricLabel="ch."
                metricKey="total_chapters"
              />
              <LeaderboardList
                title="Most series tracked"
                icon={<Library className="h-4 w-4 text-primary" />}
                entries={bySeries}
                metricLabel="series"
                metricKey="total_series"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
