-- Rename the "Ongoing" reading status to "Reading" everywhere it's stored.
-- 1. Update existing rows first, while the old constraint still permits it.
-- 2. Swap the CHECK constraint to allow 'Reading' instead of 'Ongoing'.

UPDATE public.entries SET status = 'Reading' WHERE status = 'Ongoing';

ALTER TABLE public.entries DROP CONSTRAINT IF EXISTS entries_status_check;
ALTER TABLE public.entries
  ADD CONSTRAINT entries_status_check
  CHECK (status IN ('Reading', 'Dropped', 'Cancelled', 'Finished'));
