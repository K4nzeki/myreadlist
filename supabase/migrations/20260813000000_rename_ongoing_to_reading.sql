-- Rename the "Ongoing" reading status to "Reading" everywhere it's stored.
-- 1. Drop the old constraint FIRST — it only allows 'Ongoing', so the
--    rename below would violate it if it were still in place.
-- 2. Update existing rows now that nothing is blocking the new value.
-- 3. Re-add the constraint with 'Reading' swapped in for 'Ongoing'. This
--    also re-validates every row, which is fine now that step 2 has
--    already renamed them all.

ALTER TABLE public.entries DROP CONSTRAINT IF EXISTS entries_status_check;

UPDATE public.entries SET status = 'Reading' WHERE status = 'Ongoing';

ALTER TABLE public.entries
  ADD CONSTRAINT entries_status_check
  CHECK (status IN ('Reading', 'Dropped', 'Cancelled', 'Finished'));
