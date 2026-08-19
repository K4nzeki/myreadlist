-- Tracks the last time an entry's chapter count was bumped, separate from
-- created_at (when it was first added to the list). Used to make the
-- default "Newly Added" sort also bubble up whatever you're actively
-- reading, not just what you recently added — set explicitly by the app
-- (routes/index.tsx's update()) only when the patch includes a chapter
-- change, not on every edit (renaming a title, setting a "Read on" link,
-- etc. shouldn't bump it).

ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS last_read_at timestamptz;
