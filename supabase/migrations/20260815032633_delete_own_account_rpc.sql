-- Apple Guideline 5.1.1(v): any app that lets a user create an account must
-- also let them delete it from inside the app. The client can't call
-- auth.admin.deleteUser directly (that needs the service-role key, which
-- must never ship in the client), so expose a narrow SECURITY DEFINER RPC
-- that only ever deletes the currently authenticated caller's own row.
--
-- All app tables (profiles, entries, chapter_log, completion_log, ...)
-- reference auth.users(id) ON DELETE CASCADE, so deleting the auth.users
-- row alone cleans up every piece of the user's data in one transaction.

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Deletes the auth.users row for the caller only — cascades remove
  -- profiles/entries/chapter_log/completion_log/etc. Nothing here ever
  -- takes a user id from the caller's input, so one user can never delete
  -- another's account.
  DELETE FROM auth.users WHERE id = caller_id;
END;
$$;

-- Only ever callable by a logged-in user, on their own behalf.
REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
