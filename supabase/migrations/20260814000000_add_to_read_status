-- Add the missing "To Read" status to the entries_status_check constraint.
--
-- The frontend's EntryStatus type has always included "To Read" (see the
-- "Add to Read" button on Discover, and the "To Read" stat on the
-- dashboard), but the constraint itself never allowed it — not in the
-- original migration, and not in the 'Ongoing' -> 'Reading' rename either.
-- Any attempt to insert a "To Read" entry has been failing with:
--   new row for relation "entries" violates check constraint "entries_status_check"

ALTER TABLE public.entries DROP CONSTRAINT IF EXISTS entries_status_check;

ALTER TABLE public.entries
  ADD CONSTRAINT entries_status_check
  CHECK (status IN ('To Read', 'Reading', 'Dropped', 'Cancelled', 'Finished'));
