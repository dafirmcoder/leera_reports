-- ============================================================
-- Migration: Scheduled Attendance Reminders via pg_cron & pg_net
-- Date: 2026-09-23
-- ============================================================

-- Enable pg_cron and pg_net extensions if available in project
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Safely unschedule previous jobs if already scheduled
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('attendance-morning-reminder') where exists (select 1 from cron.job where jobname = 'attendance-morning-reminder');
    perform cron.unschedule('attendance-hourly-repeat') where exists (select 1 from cron.job where jobname = 'attendance-hourly-repeat');
  end if;
exception when others then
  -- Ignore if cron.job is not accessible or not initialized
  null;
end $$;

-- 1. Morning Attendance Reminder (05:00 UTC = 08:00 AM EAT, Monday to Friday)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule(
      'attendance-morning-reminder',
      '0 5 * * 1-5',
      $cron$
      select net.http_post(
        url := 'https://vkceztpdfyvnvsfxzyuc.supabase.co/functions/v1/attendance-reminder',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      ) as request_id;
      $cron$
    );

    -- 2. Repetitive Follow-up Reminder (06:00, 07:00, 08:00, 09:00 UTC = 09:00, 10:00, 11:00, 12:00 EAT Mon-Fri)
    -- (The edge function only sends to teachers whose class has NOT yet marked attendance today)
    perform cron.schedule(
      'attendance-hourly-repeat',
      '0 6,7,8,9 * * 1-5',
      $cron$
      select net.http_post(
        url := 'https://vkceztpdfyvnvsfxzyuc.supabase.co/functions/v1/attendance-reminder',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      ) as request_id;
      $cron$
    );
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;
