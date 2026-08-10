export type EntryType = "Manga" | "Manhwa" | "Manhua" | "Comic";

export type TrackerResult = {
  id: string | number;
  title: string;
  type: EntryType;
  author: string | null;
  coverUrl: string | null;
  totalChapters: number | null;
  status: string | null;
  source: string;
};

async function safeFetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status}`);
  return res.json();
}

// MyAnimeList, via the Jikan public proxy API (no key required, CORS-enabled).
export async function searchMAL(query: string, limit = 8): Promise<TrackerResult[]> {
  const url = `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=${limit}`;
  const json = await safeFetchJson(url);
  return (json.data ?? []).map((m: any) => ({
    id: m.mal_id,
    title: m.title,
    type: "Manga" as EntryType,
    author: m.authors?.[0]?.name ?? null,
    coverUrl: m.images?.jpg?.image_url ?? m.images?.webp?.image_url ?? null,
    totalChapters: typeof m.chapters === "number" ? m.chapters : null,
    status: m.status ?? null,
    source: "MyAnimeList",
  }));
}

export async function searchKitsu(query: string, limit = 8): Promise<TrackerResult[]> {
  const url = `https://kitsu.io/api/edge/manga?filter[text]=${encodeURIComponent(query)}&page[limit]=${limit}`;
  const json = await safeFetchJson(url);
  return (json.data ?? []).map((d: any) => {
    const a = d.attributes ?? {};
    return {
      id: d.id,
      title: a.titles?.en || a.titles?.en_jp || a.canonicalTitle || "Untitled",
      type: "Manga" as EntryType,
      author: null, // Kitsu exposes authors via a separate relationship call — skipped to keep this a single request.
      coverUrl: a.posterImage?.small ?? a.posterImage?.tiny ?? null,
      totalChapters: typeof a.chapterCount === "number" ? a.chapterCount : null,
      status: a.status ?? null,
      source: "Kitsu",
    };
  });
}

export async function searchViaProxy(
  provider: "mangaupdates" | "mangabaka" | "shikimori" | "bangumi" | "hikka",
  query: string,
  limit = 8,
): Promise<TrackerResult[]> {
  const url = `/api/trackers/${provider}?q=${encodeURIComponent(query)}&limit=${limit}`;
  const json = await safeFetchJson(url);
  return json as TrackerResult[];
}

export async function searchAllTrackers(query: string, limit = 8): Promise<TrackerResult[]> {
  const settled = await Promise.allSettled([searchMAL(query, limit), searchKitsu(query, limit)]);
  return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
