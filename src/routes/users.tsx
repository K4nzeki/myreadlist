import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/users")({
  component: UserList,
});

type Profile = { id: string; username: string | null };

function UserList() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <div className="p-6 text-muted-foreground text-sm">Loading users…</div>;

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-xl font-bold mb-4">Browse users</h1>
      <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
        {profiles.map((p) => (
          <li key={p.id}>
            <Link
              to="/u/$userId"
              params={{ userId: p.id }}
              className="block px-4 py-3 hover:bg-muted text-sm font-medium"
            >
              {p.username}
            </Link>
          </li>
        ))}
        {profiles.length === 0 && (
          <li className="px-4 py-6 text-center text-muted-foreground text-sm">No users yet.</li>
        )}
      </ul>
    </div>
  );
}
