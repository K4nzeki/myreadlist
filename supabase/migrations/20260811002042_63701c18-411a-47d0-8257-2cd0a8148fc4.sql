DROP POLICY IF EXISTS "Public can view completion log" ON public.completion_log;
REVOKE SELECT ON public.completion_log FROM anon;