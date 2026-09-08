-- Allow a teacher to hold a primary role plus additional responsibilities.
alter table public.profiles
  add column if not exists additional_roles text[] not null default '{}';

create or replace function public.has_role(required_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select required_role = role or required_role = any(coalesce(additional_roles, '{}'))
  from public.profiles where id = auth.uid();
$$;

-- Keep the existing role policies, but let additive roles satisfy the same
-- permissions as their corresponding primary role.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or school_id = public.my_school());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (
  id = auth.uid() or (public.has_role('head_of_school') or public.has_role('curriculum_coordinator'))
  and school_id = public.my_school()
) with check (
  id = auth.uid() or (public.has_role('head_of_school') or public.has_role('curriculum_coordinator'))
  and school_id = public.my_school()
);

drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes for select using (
  school_id = public.my_school() and (
    public.has_role('director') or public.has_role('head_of_school') or public.has_role('curriculum_coordinator')
    or (public.has_role('homeroom_teacher') and id = public.my_class())
    or (public.has_role('subject_teacher') and id in (select public.assigned_class_ids()))
  )
);

drop policy if exists subjects_select on public.subjects;
create policy subjects_select on public.subjects for select using (school_id = public.my_school());
drop policy if exists subjects_insert on public.subjects;
create policy subjects_insert on public.subjects for insert
  with check ((public.has_role('head_of_school') or public.has_role('curriculum_coordinator')) and school_id = public.my_school());
drop policy if exists subjects_update on public.subjects;
create policy subjects_update on public.subjects for update
  using ((public.has_role('head_of_school') or public.has_role('curriculum_coordinator')) and school_id = public.my_school())
  with check ((public.has_role('head_of_school') or public.has_role('curriculum_coordinator')) and school_id = public.my_school());
drop policy if exists subjects_delete on public.subjects;
create policy subjects_delete on public.subjects for delete
  using ((public.has_role('head_of_school') or public.has_role('curriculum_coordinator')) and school_id = public.my_school());

drop policy if exists students_select on public.students;
create policy students_select on public.students for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school()) and (
    public.has_role('director') or public.has_role('head_of_school') or public.has_role('curriculum_coordinator')
    or (public.has_role('homeroom_teacher') and class_id = public.my_class())
    or (public.has_role('subject_teacher') and class_id in (select public.assigned_class_ids()))
  )
);
drop policy if exists students_insert on public.students;
create policy students_insert on public.students for insert
  with check (public.has_role('homeroom_teacher') and class_id = public.my_class());
drop policy if exists students_update on public.students;
create policy students_update on public.students for update
  using (public.has_role('homeroom_teacher') and class_id = public.my_class())
  with check (public.has_role('homeroom_teacher') and class_id = public.my_class());
drop policy if exists students_delete on public.students;
create policy students_delete on public.students for delete
  using (public.has_role('homeroom_teacher') and class_id = public.my_class());

-- Additive homeroom/coordinator users need the same class/test/score access as
-- homeroom teachers and coordinator read access to the whole school.
drop policy if exists unit_tests_select on public.unit_tests;
create policy unit_tests_select on public.unit_tests for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school()) and (
    public.has_role('director') or public.has_role('head_of_school') or public.has_role('curriculum_coordinator')
    or (public.has_role('homeroom_teacher') and class_id = public.my_class())
    or (public.has_role('subject_teacher') and class_id in (select public.assigned_class_ids()) and subject_id in (select public.assigned_class_subjects(class_id)))
  )
);
drop policy if exists unit_tests_insert on public.unit_tests;
create policy unit_tests_insert on public.unit_tests for insert with check (
  (public.has_role('homeroom_teacher') and class_id = public.my_class())
  or (public.has_role('subject_teacher') or public.has_role('head_of_school')) and exists (
    select 1 from public.class_subject_teachers a where a.teacher_id = auth.uid() and a.class_id = unit_tests.class_id and a.subject_id = unit_tests.subject_id
  )
);
drop policy if exists unit_tests_update on public.unit_tests;
create policy unit_tests_update on public.unit_tests for update
  using ((public.has_role('homeroom_teacher') and class_id = public.my_class()) or ((public.has_role('subject_teacher') or public.has_role('head_of_school')) and exists (select 1 from public.class_subject_teachers a where a.teacher_id = auth.uid() and a.class_id = unit_tests.class_id and a.subject_id = unit_tests.subject_id)))
  with check ((public.has_role('homeroom_teacher') and class_id = public.my_class()) or ((public.has_role('subject_teacher') or public.has_role('head_of_school')) and exists (select 1 from public.class_subject_teachers a where a.teacher_id = auth.uid() and a.class_id = unit_tests.class_id and a.subject_id = unit_tests.subject_id)));
drop policy if exists unit_tests_delete on public.unit_tests;
create policy unit_tests_delete on public.unit_tests for delete using ((public.has_role('homeroom_teacher') and class_id = public.my_class()) or ((public.has_role('subject_teacher') or public.has_role('head_of_school')) and exists (select 1 from public.class_subject_teachers a where a.teacher_id = auth.uid() and a.class_id = unit_tests.class_id and a.subject_id = unit_tests.subject_id)));

-- Score policies mirror the test permissions.
drop policy if exists scores_select on public.scores;
create policy scores_select on public.scores for select using (
  exists (select 1 from public.unit_tests t join public.classes c on c.id = t.class_id where t.id = unit_test_id and c.school_id = public.my_school()) and (
    public.has_role('director') or public.has_role('head_of_school') or public.has_role('curriculum_coordinator')
    or (public.has_role('homeroom_teacher') and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class()))
    or (public.has_role('subject_teacher') and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id in (select public.assigned_class_ids()) and t.subject_id in (select public.assigned_class_subjects(t.class_id))))
  )
);
drop policy if exists scores_insert on public.scores;
create policy scores_insert on public.scores for insert with check ((public.has_role('homeroom_teacher') and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class())) or ((public.has_role('subject_teacher') or public.has_role('head_of_school')) and exists (select 1 from public.unit_tests t join public.class_subject_teachers a on a.class_id = t.class_id and a.subject_id = t.subject_id where t.id = unit_test_id and a.teacher_id = auth.uid())));
drop policy if exists scores_update on public.scores;
create policy scores_update on public.scores for update using ((public.has_role('homeroom_teacher') and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class())) or ((public.has_role('subject_teacher') or public.has_role('head_of_school')) and exists (select 1 from public.unit_tests t join public.class_subject_teachers a on a.class_id = t.class_id and a.subject_id = t.subject_id where t.id = unit_test_id and a.teacher_id = auth.uid()))) with check ((public.has_role('homeroom_teacher') and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class())) or ((public.has_role('subject_teacher') or public.has_role('head_of_school')) and exists (select 1 from public.unit_tests t join public.class_subject_teachers a on a.class_id = t.class_id and a.subject_id = t.subject_id where t.id = unit_test_id and a.teacher_id = auth.uid())));
drop policy if exists scores_delete on public.scores;
create policy scores_delete on public.scores for delete using ((public.has_role('homeroom_teacher') and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class())) or ((public.has_role('subject_teacher') or public.has_role('head_of_school')) and exists (select 1 from public.unit_tests t join public.class_subject_teachers a on a.class_id = t.class_id and a.subject_id = t.subject_id where t.id = unit_test_id and a.teacher_id = auth.uid())));

-- Assignment visibility/management also recognizes combined homeroom users.
drop policy if exists cst_select on public.class_subject_teachers;
create policy cst_select on public.class_subject_teachers for select using (class_id in (select c.id from public.classes c where c.school_id = public.my_school()) and (public.has_role('director') or public.has_role('head_of_school') or public.has_role('curriculum_coordinator') or (public.has_role('homeroom_teacher') and class_id = public.my_class()) or teacher_id = auth.uid()));
drop policy if exists cst_insert on public.class_subject_teachers;
create policy cst_insert on public.class_subject_teachers for insert with check (public.has_role('head_of_school') or (public.has_role('homeroom_teacher') and class_id = public.my_class()));
drop policy if exists cst_delete on public.class_subject_teachers;
create policy cst_delete on public.class_subject_teachers for delete using (public.has_role('head_of_school') or (public.has_role('homeroom_teacher') and class_id = public.my_class()));
