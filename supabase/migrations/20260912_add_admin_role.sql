-- ============================================================
-- Migration: Add Admin Role (Attendance Summaries & XLSX/CSV Reports)
-- Date: 2026-09-12
-- ============================================================

-- 1. Update profiles role check constraint to include 'admin'
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('pending', 'admin', 'director', 'head_of_school', 'curriculum_coordinator', 'homeroom_teacher', 'subject_teacher'));

-- 2. Attendance select policy: Allow Admin, Director, Head of School, Coordinator
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('admin')
    or public.has_role('director')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (public.has_role('homeroom_teacher') and class_id = public.my_class())
  )
);

-- 3. Classes select policy: Allow Admin, Director, HOS, Coordinator, and teachers
drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes for select using (
  school_id = public.my_school()
  and (
    public.has_role('admin')
    or public.has_role('director')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (
      (public.has_role('homeroom_teacher') or public.has_role('subject_teacher'))
      and (id = public.my_class() or id in (select public.assigned_class_ids()))
    )
  )
);

-- 4. Students select policy: Allow Admin, Director, HOS, Coordinator, and teachers
drop policy if exists students_select on public.students;
create policy students_select on public.students for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('admin')
    or public.has_role('director')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (
      (public.has_role('homeroom_teacher') or public.has_role('subject_teacher'))
      and (class_id = public.my_class() or class_id in (select public.assigned_class_ids()))
    )
  )
);

-- 5. Schools select policy: Ensure Admin can read school details
drop policy if exists schools_select on public.schools;
create policy schools_select on public.schools for select using (
  id = public.my_school()
  or public.my_role() is not null
);
