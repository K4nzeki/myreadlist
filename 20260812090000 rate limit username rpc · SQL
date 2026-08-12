-- Rate-limit the anonymous-callable username/email lookup RPCs so they can't be
-- used to brute-force enumerate usernames or harvest emails at volume.
-- (These stay SECURITY DEFINER + callable by anon/authenticated on purpose —
-- that's how a logged-out visitor can sign in with a username or check
-- availability at signup. This migration hardens the behavior, not the grants.)

CREATE TABLE IF NOT EXISTS public.auth_rpc_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_rpc_attempts_bucket_idx
  ON public.auth_rpc_attempts (bucket_key, created_at);

ALTER TABLE public.auth_rpc_attempts ENABLE ROW LEVEL SECURITY;
-- No policies: nothing can read/write this table directly, not even
-- authenticated users. It's only touched from inside the SECURITY DEFINER
-- functions below, which run with the function owner's privileges.
REVOKE ALL ON public.auth_rpc_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.auth_rpc_attempts TO service_role;

CREATE OR REPLACE FUNCTION public._check_auth_rpc_rate_limit(
  p_bucket_prefix text,
  p_limit int,
  p_window interval
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_count int;
BEGIN
  v_key := p_bucket_prefix || ':' ||
    coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', 'unknown');

  DELETE FROM public.auth_rpc_attempts WHERE created_at < now() - p_window;

  SELECT count(*) INTO v_count FROM public.auth_rpc_attempts WHERE bucket_key = v_key;
  IF v_count >= p_limit THEN
    RAISE EXCEPTION 'Too many attempts. Please try again in a few minutes.'
      USING ERRCODE = '42901';
  END IF;

  INSERT INTO public.auth_rpc_attempts (bucket_key) VALUES (v_key);
END;
$$;

REVOKE ALL ON FUNCTION public._check_auth_rpc_rate_limit(text, int, interval) FROM PUBLIC;
-- Intentionally not granted to anon/authenticated: only called internally by
-- the two functions below.

CREATE OR REPLACE FUNCTION public.username_available(p_username text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._check_auth_rpc_rate_limit('username_available', 30, interval '15 minutes');

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE lower(username) = lower(trim(p_username))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.username_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.username_available(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.email_for_username(p_username text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text;
BEGIN
  PERFORM public._check_auth_rpc_rate_limit('email_for_username', 15, interval '15 minutes');

  SELECT u.email::text INTO v_email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(p.username) = lower(trim(p_username))
  LIMIT 1;

  RETURN v_email;
END;
$$;

REVOKE ALL ON FUNCTION public.email_for_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_for_username(text) TO anon, authenticated;
