import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
        e.type.toLowerCase().includes(q)
