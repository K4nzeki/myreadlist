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

export type TrackerProvider = 
  | "mangaupdates" 
  | "mangabaka" 
  | "shikimori" 
  | "bangumi" 
  | "hikka";

// --- Helpers ---

async function safeFetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Fetch to ${url} failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function normalizeEntryType(rawType?: string): EntryType {
  if (!rawType) return "Manga";
  const type = rawType.toLowerCase();

  if (type.includes("manhwa")) return "Manhwa";
  if (type.includes("manhua")) return "Manhua";
  if (type.includes("comic") || type.includes("novel")) return "Comic";
  
  return "Manga";
}

// --- Search Functions ---

/**
 * MyAnimeList via the Jikan public proxy API.
 */
export async function searchMAL(
  query: string, 
  limit = 8, 
  signal?: AbortSignal
): Promise<TrackerResult[]> {
  const url = `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=${limit}`;
  const json = await safeFetchJson<any>(url, signal);

  return (json.data ?? []).map((m: any) => ({
    id: m.mal_id,
    title: m.title_english || m.title || "Untitled",
    type: normalizeEntryType(m.type),
    author: m.authors?.[0]?.name ?? null,
    coverUrl: m.images?.jpg?.image_url ?? m.images?.webp?.image_url ?? null,
    totalChapters: typeof m.chapters === "number" ? m.chapters : null,
    status: m.status ?? null,
    source: "MyAnimeList",
  }));
}

/**
 * Kitsu API endpoint.
 */
export async function searchKitsu(
  query: string, 
  limit = 8, 
  signal?: AbortSignal
): Promise<TrackerResult[]> {
  const url = `https://kitsu.io/api/edge/manga?filter[text]=${encodeURIComponent(query)}&page[limit]=${limit}`;
  const json = await safeFetchJson<any>(url, signal);

  return (json.data ?? []).map((d: any) => {
    const a = d.attributes ?? {};
    return {
      id: d.id,
      title: a.titles?.en || a.titles?.en_jp || a.canonicalTitle || "Untitled",
      type: normalizeEntryType(a.mangaType || a.subtype),
      author: null, // Kitsu exposes authors via a separate relationship endpoint
      coverUrl: a.posterImage?.small ?? a.posterImage?.tiny ?? null,
      totalChapters: typeof a.chapterCount === "number" ? a.chapterCount : null,
      status: a.status ?? null,
      source: "Kitsu",
    };
  });
}

/**
 * Internal API Proxy fallback for restricted/authenticated providers.
 */
export async function searchViaProxy(
  provider: TrackerProvider,
  query: string,
  limit = 8,
  signal?: AbortSignal
): Promise<TrackerResult[]> {
  const url = `/api/trackers/${provider}?q=${encodeURIComponent(query)}&limit=${limit}`;
  return safeFetchJson<TrackerResult[]>(url, signal);
}

/**
 * Aggregates client-side searches across all direct APIs.
 */
export async function searchAllTrackers(
  query: string, 
  limit = 8, 
  signal?: AbortSignal
): Promise<TrackerResult[]> {
  const settled = await Promise.allSettled([
    searchMAL(query, limit, signal),
    searchKitsu(query, limit, signal),
  ]);

  return settled.reduce<TrackerResult[]>((acc, result) => {
    if (result.status === "fulfilled") {
      acc.push(...result.value);
    }
    return acc;
  }, []);
}
