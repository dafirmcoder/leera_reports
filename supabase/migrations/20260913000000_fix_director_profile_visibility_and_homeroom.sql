-- ============================================================
-- Migration: Fix Director / Admin Profile Visibility and Homeroom Teacher Sync
-- Date: 2026-09-13
-- ============================================================

-- 1. Ensure profiles_select allows Director, Admin, Head of School, Coordinator,
--    and school members to see teacher and staff profiles in the same school.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
using (
  id = auth.uid()
  or public.has_role('admin')
  or public.has_role('director')
  or public.has_role('head_of_school')
  or public.has_role('curriculum_coordinator')
  or school_id = public.my_school()
);

-- 2. Allow Admin to update profiles alongside Head of School & Coordinator
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (
  id = auth.uid()
  or (
    (public.has_role('admin') or public.has_role('head_of_school') or public.has_role('curriculum_coordinator'))
    and school_id = public.my_school()
  )
) with check (
  id = auth.uid()
  or (
    (public.has_role('admin') or public.has_role('head_of_school') or public.has_role('curriculum_coordinator'))
    and school_id = public.my_school()
  )
);

-- 3. Allow Admin to update classes alongside Head of School
drop policy if exists classes_update on public.classes;
create policy classes_update on public.classes for update
  using (
    (public.has_role('admin') or public.has_role('head_of_school'))
    and school_id = public.my_school()
  )
  with check (
    (public.has_role('admin') or public.has_role('head_of_school'))
    and school_id = public.my_school()
  );

-- 4. Allow Admin to insert classes
drop policy if exists classes_insert on public.classes;
create policy classes_insert on public.classes for insert
  with check (
    (public.has_role('admin') or public.has_role('head_of_school'))
    and school_id = public.my_school()
  );

-- 5. Allow Admin to delete classes
drop policy if exists classes_delete on public.classes;
create policy classes_delete on public.classes for delete
  using (
    (public.has_role('admin') or public.has_role('head_of_school'))
    and school_id = public.my_school()
  );

-- 6. Backfill and sync homeroom teachers between profiles.class_id and classes.homeroom_teacher_id
update public.classes c
set homeroom_teacher_id = p.id
from public.profiles p
where p.class_id = c.id
  and (p.role = 'homeroom_teacher' or 'homeroom_teacher' = any(coalesce(p.additional_roles, '{}')))
  and c.homeroom_teacher_id is null;

update public.profiles p
set class_id = c.id
from public.classes c
where c.homeroom_teacher_id = p.id
  and (p.class_id is null or p.class_id <> c.id)
  and (p.role = 'homeroom_teacher' or 'homeroom_teacher' = any(coalesce(p.additional_roles, '{}')));
