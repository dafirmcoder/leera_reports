-- A curriculum coordinator can also act as a subject teacher when assigned
-- to a class and subject.
drop policy if exists unit_tests_insert on public.unit_tests;
create policy unit_tests_insert on public.unit_tests for insert with check (
  (public.has_role('homeroom_teacher') and class_id = public.my_class())
  or (
    (public.has_role('subject_teacher') or public.has_role('curriculum_coordinator') or public.has_role('head_of_school'))
    and exists (
      select 1 from public.class_subject_teachers a
      where a.teacher_id = auth.uid()
        and a.class_id = unit_tests.class_id
        and a.subject_id = unit_tests.subject_id
    )
  )
);

drop policy if exists unit_tests_update on public.unit_tests;
create policy unit_tests_update on public.unit_tests for update
using (
  (public.has_role('homeroom_teacher') and class_id = public.my_class())
  or (
    (public.has_role('subject_teacher') or public.has_role('curriculum_coordinator') or public.has_role('head_of_school'))
    and exists (
      select 1 from public.class_subject_teachers a
      where a.teacher_id = auth.uid()
        and a.class_id = unit_tests.class_id
        and a.subject_id = unit_tests.subject_id
    )
  )
)
with check (
  (public.has_role('homeroom_teacher') and class_id = public.my_class())
  or (
    (public.has_role('subject_teacher') or public.has_role('curriculum_coordinator') or public.has_role('head_of_school'))
    and exists (
      select 1 from public.class_subject_teachers a
      where a.teacher_id = auth.uid()
        and a.class_id = unit_tests.class_id
        and a.subject_id = unit_tests.subject_id
    )
  )
);

drop policy if exists unit_tests_delete on public.unit_tests;
create policy unit_tests_delete on public.unit_tests for delete using (
  (public.has_role('homeroom_teacher') and class_id = public.my_class())
  or (
    (public.has_role('subject_teacher') or public.has_role('curriculum_coordinator') or public.has_role('head_of_school'))
    and exists (
      select 1 from public.class_subject_teachers a
      where a.teacher_id = auth.uid()
        and a.class_id = unit_tests.class_id
        and a.subject_id = unit_tests.subject_id
    )
  )
);

drop policy if exists scores_insert on public.scores;
create policy scores_insert on public.scores for insert with check (
  (
    public.has_role('homeroom_teacher')
    and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class())
  )
  or (
    (public.has_role('subject_teacher') or public.has_role('curriculum_coordinator') or public.has_role('head_of_school'))
    and exists (
      select 1
      from public.unit_tests t
      join public.class_subject_teachers a on a.class_id = t.class_id and a.subject_id = t.subject_id
      where t.id = unit_test_id and a.teacher_id = auth.uid()
    )
  )
);

drop policy if exists scores_update on public.scores;
create policy scores_update on public.scores for update
using (
  (
    public.has_role('homeroom_teacher')
    and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class())
  )
  or (
    (public.has_role('subject_teacher') or public.has_role('curriculum_coordinator') or public.has_role('head_of_school'))
    and exists (
      select 1
      from public.unit_tests t
      join public.class_subject_teachers a on a.class_id = t.class_id and a.subject_id = t.subject_id
      where t.id = unit_test_id and a.teacher_id = auth.uid()
    )
  )
)
with check (
  (
    public.has_role('homeroom_teacher')
    and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class())
  )
  or (
    (public.has_role('subject_teacher') or public.has_role('curriculum_coordinator') or public.has_role('head_of_school'))
    and exists (
      select 1
      from public.unit_tests t
      join public.class_subject_teachers a on a.class_id = t.class_id and a.subject_id = t.subject_id
      where t.id = unit_test_id and a.teacher_id = auth.uid()
    )
  )
);

drop policy if exists scores_delete on public.scores;
create policy scores_delete on public.scores for delete using (
  (
    public.has_role('homeroom_teacher')
    and exists (select 1 from public.unit_tests t where t.id = unit_test_id and t.class_id = public.my_class())
  )
  or (
    (public.has_role('subject_teacher') or public.has_role('curriculum_coordinator') or public.has_role('head_of_school'))
    and exists (
      select 1
      from public.unit_tests t
      join public.class_subject_teachers a on a.class_id = t.class_id and a.subject_id = t.subject_id
      where t.id = unit_test_id and a.teacher_id = auth.uid()
    )
  )
);