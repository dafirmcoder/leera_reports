-- Migration: Create app_settings table for school-wide system and AI configurations
-- Enables storing Gemini API key in the database so all teachers and coordinators share it

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings' AND policyname = 'Allow read app_settings'
  ) THEN
    CREATE POLICY "Allow read app_settings" ON public.app_settings FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings' AND policyname = 'Allow insert app_settings'
  ) THEN
    CREATE POLICY "Allow insert app_settings" ON public.app_settings FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings' AND policyname = 'Allow update app_settings'
  ) THEN
    CREATE POLICY "Allow update app_settings" ON public.app_settings FOR UPDATE USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings' AND policyname = 'Allow delete app_settings'
  ) THEN
    CREATE POLICY "Allow delete app_settings" ON public.app_settings FOR DELETE USING (true);
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- Note: Dynamic settings such as 'gemini_api_key' are managed dynamically via the app Settings or admin SQL.

