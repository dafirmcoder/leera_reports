-- Daily attendance with an absence reason required for status A.
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  attendance_date date not null default current_date,
  status text not null check (status in ('P', 'A', 'E')),
  reason text not null default '',
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  unique (class_id, student_id, attendance_date),
  check (status <> 'A' or length(trim(reason)) > 0)
);

create index if not exists attendance_class_date_idx on public.attendance (class_id, attendance_date);
create index if not exists attendance_student_idx on public.attendance (student_id);
alter table public.attendance enable row level security;

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (public.has_role('homeroom_teacher') and class_id = public.my_class())
  )
);

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance for insert with check (
  public.has_role('homeroom_teacher') and class_id = public.my_class()
);

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance for update
using (public.has_role('homeroom_teacher') and class_id = public.my_class())
with check (public.has_role('homeroom_teacher') and class_id = public.my_class());

drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance for delete
using (public.has_role('homeroom_teacher') and class_id = public.my_class());
