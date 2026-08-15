-- Fix a privacy gap ahead of App Store review: the SELECT policies added in
-- 20260812110000_public_reads_and_rls_hygiene.sql granted `USING (true)` to
-- `anon` on both `entries` and `profiles` — meaning literally every user's
-- full reading list and profile row was readable by anyone with the
-- anon/publishable key (which ships in the client bundle and is not a
-- secret), regardless of whether that user ever set a username or opted
-- into a public list page.
--
-- This contradicts what the in-app Privacy Policy (/privacy) actually
-- promises: "your reading list becomes visible on a public, shareable page
-- ... if you set a username" — i.e. public visibility is meant to be
-- opt-in, gated on having chosen a username. Tighten both policies so a
-- row is only publicly readable once its owner has actually opted in
-- (profiles.username IS NOT NULL), while every user can still always read
-- their own rows regardless of that flag.
--
-- No app code changes needed: /u/:userId and /users already only ever
-- display users who have a username, so this only removes access the UI
-- never relied on in the first place.

DROP POLICY IF EXISTS "Entries are viewable by everyone" ON public.entries;
CREATE POLICY "Entries are viewable by their owner or opted-in public profiles"
ON public.entries FOR SELECT
TO anon, authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = entries.user_id AND p.username IS NOT NULL
  )
);

DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles are viewable by their owner or when public"
ON public.profiles FOR SELECT
TO anon, authenticated
USING (
  auth.uid() = id
  OR username IS NOT NULL
);
