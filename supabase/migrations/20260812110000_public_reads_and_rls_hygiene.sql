-- 1) Reading lists and profiles are an intentional public/social feature
--    (see /users directory and /u/:userId public list pages) — but until now
--    the SELECT policies only covered `authenticated`, so a share link was
--    useless to anyone without an account. Open reads to `anon` too.

GRANT SELECT ON public.entries TO anon;
GRANT SELECT ON public.profiles TO anon;

DROP POLICY IF EXISTS "Entries are viewable by everyone" ON public.entries;
CREATE POLICY "Entries are viewable by everyone"
ON public.entries FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles are viewable by everyone"
ON public.profiles FOR SELECT
TO anon, authenticated
USING (true);

-- 2) The rate-limit bucket table has RLS enabled with no policies, which is
--    intentional (it's only ever touched from inside SECURITY DEFINER
--    functions) — but the linter flags "no policies" as ambiguous. Make the
--    lockout explicit instead of implicit so it reads as a deliberate choice.
DROP POLICY IF EXISTS "No direct access" ON public.auth_rpc_attempts;
CREATE POLICY "No direct access"
ON public.auth_rpc_attempts FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
