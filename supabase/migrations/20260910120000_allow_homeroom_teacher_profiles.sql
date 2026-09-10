-- Homeroom teachers need teacher profiles for the subject-assignment dropdown.
-- Their class_subject_teachers policies still restrict writes to their own class.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
using (
  id = auth.uid()
  or public.has_role('head_of_school')
  or public.has_role('curriculum_coordinator')
  or (
    public.has_role('homeroom_teacher')
    and school_id = public.my_school()
    and (
      role in ('subject_teacher', 'homeroom_teacher')
      or 'subject_teacher' = any(coalesce(additional_roles, '{}'))
      or 'homeroom_teacher' = any(coalesce(additional_roles, '{}'))
    )
  )
);