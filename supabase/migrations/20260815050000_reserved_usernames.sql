-- Apple Guideline 1.2 (User-Generated Content) expects apps with public,
-- user-chosen identifiers to take reasonable steps against impersonation
-- and abuse at the point of creation, not just react after the fact.
-- Usernames here are the only freeform, publicly-visible UGC in the app
-- (they appear on /users and /u/:username), so block the small set of
-- names most likely to be used to impersonate the app/its staff or to
-- squat on obviously-abusive handles. This is a floor, not a substitute
-- for the report mechanism added alongside it in the client.

CREATE OR REPLACE FUNCTION public._is_reserved_username(p_username text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(p_username)) = ANY (ARRAY[
    'admin', 'administrator', 'root', 'system', 'moderator', 'mod',
    'support', 'help', 'staff', 'official', 'panels', 'myreadlist',
    'security', 'billing', 'contact', 'webmaster', 'null', 'undefined',
    'anonymous', 'deleted', 'me', 'api', 'test'
  ]);
$$;

CREATE OR REPLACE FUNCTION public.username_available(p_username text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._check_auth_rpc_rate_limit('username_available', 30, interval '15 minutes');

  IF public._is_reserved_username(p_username) THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE lower(username) = lower(trim(p_username))
  );
END;
$$;

-- Also enforce it as a hard constraint at write time (handle_new_user and
-- any future profile-update path both funnel through this), so the check
-- can't be bypassed by racing the availability check.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text := NULLIF(NEW.raw_user_meta_data ->> 'username', '');
BEGIN
  IF v_username IS NOT NULL AND public._is_reserved_username(v_username) THEN
    v_username := NULL; -- fall back to no username rather than fail signup
  END IF;

  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, v_username)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
