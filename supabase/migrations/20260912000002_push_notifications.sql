-- ============================================================
-- Migration: Push Notifications & Repetitive Attendance Reminders
-- Date: 2026-09-12
-- ============================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select using (
  user_id = auth.uid()
  or public.has_role('head_of_school')
  or public.has_role('director')
);

drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions for insert with check (
  user_id = auth.uid()
);

drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions for delete using (
  user_id = auth.uid()
);

-- Helper to find homeroom teachers whose classes have NOT marked attendance today
create or replace function public.get_unmarked_homeroom_teachers()
returns table (
  user_id uuid,
  teacher_name text,
  teacher_email text,
  class_id uuid,
  class_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as user_id,
    p.full_name as teacher_name,
    p.email as teacher_email,
    c.id as class_id,
    c.name as class_name
  from public.classes c
  join public.profiles p on p.id = c.homeroom_teacher_id
  where c.school_id is not null
    and not exists (
      select 1 from public.attendance a
      where a.class_id = c.id
        and a.attendance_date = current_date
    );
$$;
