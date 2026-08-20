import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Layers, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/users")({
  component: UserList,
});

type Profile = { id: string; username: string | null };

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

function UserList() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const selfId = sessionData.session?.user.id;

      let q = supabase
        .from("profiles")
        .select("id, username")
        .not("username", "is", null)
        .order("username", { ascending: true });

      if (selfId) q = q.neq("id", selfId);

      const { data } = await q;
      setProfiles(data ?? []);
      setLoading(false);
    })();
  }, []);

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
              {loading ? "Loading…" : `${profiles.length} other public ${profiles.length === 1 ? "list" : "lists"} to explore`}
            </p>
          </div>
        </div>

        <div className="mt-6">
          {loading ? (
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
                <p className="text-sm font-medium">No other public users yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Once someone else sets a username and makes their list public, it'll show up here.
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
          )}
        </div>
      </div>
    </div>
  );
}
