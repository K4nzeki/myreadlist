-- Support unique usernames + "sign in with username or email".
-- (profiles.username already has a case-insensitive UNIQUE index from an earlier migration.)

-- 1) Anonymous-callable check for username availability, used during signup.
CREATE OR REPLACE FUNCTION public.username_available(p_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE lower(username) = lower(trim(p_username))
  );
$$;

REVOKE ALL ON FUNCTION public.username_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.username_available(text) TO anon, authenticated;

-- 2) Anonymous-callable lookup of the account email for a given username, so the
--    client can resolve "username or email" into an email before calling
--    signInWithPassword. Returns NULL (rather than erroring) when there's no match,
--    to avoid leaking whether a username exists via error vs. success shape.
CREATE OR REPLACE FUNCTION public.email_for_username(p_username text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.email::text
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(p.username) = lower(trim(p_username))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.email_for_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_for_username(text) TO anon, authenticated;
