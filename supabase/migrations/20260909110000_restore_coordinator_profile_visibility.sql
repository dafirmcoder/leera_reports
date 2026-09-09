-- Coordinators need to see the school's teacher profiles to assign subjects.
-- Use has_role so a homeroom teacher with coordinator as an additional role
-- receives the same visibility.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
using (
  id = auth.uid()
  or public.has_role('head_of_school')
  or public.has_role('curriculum_coordinator')
);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (
  id = auth.uid()
  or public.has_role('head_of_school')
  or public.has_role('curriculum_coordinator')
) with check (
  id = auth.uid()
  or public.has_role('head_of_school')
  or public.has_role('curriculum_coordinator')
);