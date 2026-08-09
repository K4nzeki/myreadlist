import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/u/$userId")({
  component: PublicList,
});

type Entry = {
  id: string;
  title: string;
  type: string;
  chapter: number;
  status: string;
  reread: number;
  cover_url?: string | null;
};

function PublicList() {
  const { userId } = Route.useParams();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);

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
      setEntries(rows ?? []);
      setLoading(false);
    })();
  }, [userId]);

  if (loading) return <div className="p-6 text-muted-foreground text-sm">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-xl font-bold mb-4">{username}'s list</h1>
      <p className="text-xs text-muted-foreground mb-4">Read-only view</p>
      <table className="w-full text-sm border border-border rounded-md overflow-hidden">
        <thead className="bg-card text-xs uppercase text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2">Title</th>
            <th className="text-left px-2 py-2">Type</th>
            <th className="text-right px-2 py-2">Ch.</th>
            <th className="text-left px-2 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-border">
              <td className="px-4 py-2 flex items-center gap-2">
                {e.cover_url && <img src={e.cover_url} alt="" className="h-8 w-6 rounded object-cover" />}
                {e.title}
              </td>
              <td className="px-2 py-2">{e.type}</td>
              <td className="px-2 py-2 text-right">{e.chapter}</td>
              <td className="px-2 py-2">{e.status}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                No titles yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
