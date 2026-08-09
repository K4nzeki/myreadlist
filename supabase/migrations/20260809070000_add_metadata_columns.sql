ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS author TEXT,
  ADD COLUMN IF NOT EXISTS total_chapters INTEGER;

COMMENT ON COLUMN public.entries.cover_url IS 'Cover art URL, populated from title search auto-fill (e.g. AniList).';
COMMENT ON COLUMN public.entries.author IS 'Author/creator, populated from title search auto-fill.';
COMMENT ON COLUMN public.entries.total_chapters IS 'Known total chapter count for progress bar; NULL if unknown/ongoing/unset.';
