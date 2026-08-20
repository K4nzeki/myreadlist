-- Removes the leaderboard feature and adds a per-user "show/hide my list"
-- toggle on the profile, independent of whether a username is set.
--
-- Previously, public visibility was entirely implicit: setting a username
-- opted a user's profile + entries into public reads (see
-- 20260815040000_restrict_public_reads_to_opted_in.sql). Users had no way
-- to keep a username (needed to sign in / for @mentions elsewhere) while
-- hiding their list from /u/:userId and /users. `list_visible` makes that
-- explicit and defaults to true so existing public lists keep working.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS list_visible BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.list_visible IS
  'Whether this profile''s username + reading list are visible to other users (/users, /u/:userId). Owner can always see their own regardless.';

DROP POLICY IF EXISTS "Entries are viewable by their owner or opted-in public profiles" ON public.entries;
CREATE POLICY "Entries are viewable by their owner or visible public profiles"
ON public.entries FOR SELECT
TO anon, authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = entries.user_id
      AND p.username IS NOT NULL
      AND p.list_visible = true
  )
);

DROP POLICY IF EXISTS "Profiles are viewable by their owner or when public" ON public.profiles;
CREATE POLICY "Profiles are viewable by their owner or when visible"
ON public.profiles FOR SELECT
TO anon, authenticated
USING (
  auth.uid() = id
  OR (username IS NOT NULL AND list_visible = true)
);

-- Leaderboards have been removed from the app; drop the aggregated view
-- that powered them.
DROP VIEW IF EXISTS public.leaderboard_stats;
