-- Migration: Add effective_from and effective_until to timetables and schedule slots
-- Ensures uploaded timetables only take effect from the date of upload and do not retroactively alter historical weeks.

alter table public.teacher_timetables
  add column if not exists effective_from date not null default current_date,
  add column if not exists effective_until date;

alter table public.teacher_schedule_slots
  add column if not exists effective_from date,
  add column if not exists effective_until date;

-- Backfill existing timetables with created_at::date
update public.teacher_timetables
set effective_from = created_at::date
where effective_from is null;

-- Backfill existing slots from their timetable or created_at
update public.teacher_schedule_slots s
set effective_from = coalesce(t.effective_from, s.created_at::date, current_date),
    effective_until = t.effective_until
from public.teacher_timetables t
where s.timetable_id = t.id
  and s.effective_from is null;

create index if not exists idx_timetables_teacher_dates on public.teacher_timetables (teacher_id, effective_from, effective_until);
create index if not exists idx_schedule_slots_dates on public.teacher_schedule_slots (teacher_id, effective_from, effective_until);
