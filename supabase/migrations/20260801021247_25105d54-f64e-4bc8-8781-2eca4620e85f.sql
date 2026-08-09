ALTER TABLE public.entries REPLICA IDENTITY FULL; 
DO $$ BEGIN IF NOT EXISTS (
  SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'entries' 
  ) 
  THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.entries; 
END IF; END $$;
