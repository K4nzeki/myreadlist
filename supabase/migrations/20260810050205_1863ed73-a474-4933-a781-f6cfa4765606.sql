ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS author text,
  ADD COLUMN IF NOT EXISTS total_chapters integer;

CREATE TABLE IF NOT EXISTS public.completion_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  entry_id uuid,
  title text,
  month date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.completion_log TO authenticated;
GRANT ALL ON public.completion_log TO service_role;
GRANT SELECT ON public.completion_log TO anon;

ALTER TABLE public.completion_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own completion log" ON public.completion_log;
CREATE POLICY "Users manage own completion log" ON public.completion_log
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public can view completion log" ON public.completion_log;
CREATE POLICY "Public can view completion log" ON public.completion_log
  FOR SELECT TO anon USING (true);