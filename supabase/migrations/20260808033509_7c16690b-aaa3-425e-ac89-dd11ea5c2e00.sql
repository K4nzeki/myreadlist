CREATE TABLE public.chapter_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  entry_id UUID REFERENCES public.entries(id) ON DELETE SET NULL,
  delta INTEGER NOT NULL,
  day DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chapter_log TO authenticated;
GRANT ALL ON public.chapter_log TO service_role;

ALTER TABLE public.chapter_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own chapter log"
ON public.chapter_log FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX chapter_log_user_day_idx ON public.chapter_log (user_id, day);

CREATE TRIGGER chapter_log_set_updated_at
BEFORE UPDATE ON public.chapter_log
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();