-- Optional per-entry "where you actually read this" link (e.g. a MangaDex
-- or Comick title page) — separate from cover_url/author/etc, which come
-- from AniList/MAL/Kitsu tracking metadata and have nothing to do with
-- which unofficial source a reader uses in Mihon/Tachiyomi-family apps.
--
-- Nullable and unvalidated beyond "starts with http(s)://": we can't know
-- what reading-source URLs look like in general (that's the whole point —
-- it's arbitrary, whatever site the reader's Mihon extension points at),
-- so this is intentionally permissive. The app opens it through the system
-- browser rather than the in-app WebView so Android's app-link resolution
-- gets a chance to hand off to an installed extension that supports deep
-- linking for that domain (MangaDex does this today; most sources don't
-- yet). When that happens, the app just opens a normal browser tab —
-- there's no way to reliably detect success either way, and that's fine.

ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS read_on_url text;

ALTER TABLE public.entries
  ADD CONSTRAINT entries_read_on_url_scheme_check
  CHECK (read_on_url IS NULL OR read_on_url ~* '^https?://');
