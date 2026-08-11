ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS position INTEGER;

-- Backfill existing rows with a stable position per user, based on their
-- current created_at ordering, so nothing appears to "jump" the first time
-- a reader opens the app after this migration.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC) - 1 AS rn
  FROM public.entries
)
UPDATE public.entries e
SET position = ordered.rn
FROM ordered
WHERE e.id = ordered.id;

ALTER TABLE public.entries
  ALTER COLUMN position SET DEFAULT 0,
  ALTER COLUMN position SET NOT NULL;

CREATE INDEX IF NOT EXISTS entries_user_id_position_idx ON public.entries (user_id, position);

COMMENT ON COLUMN public.entries.position IS 'User-controlled sort order for drag-and-drop reordering. Lower = higher priority.';
