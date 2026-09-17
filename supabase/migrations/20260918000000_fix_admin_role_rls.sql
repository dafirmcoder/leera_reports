-- ==============================================================================
-- Migration: Fix Admin Role RLS Policies
-- Ensures admin can read classes, students, subjects, attendance, unit_tests, and scores.
-- ==============================================================================

-- 1. classes_select
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

-- 2. students_select
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

-- 3. subjects_select
drop policy if exists subjects_select on public.subjects;
create policy subjects_select on public.subjects for select using (
  school_id = public.my_school()
);

-- 4. attendance_select
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

-- 5. unit_tests_select
drop policy if exists unit_tests_select on public.unit_tests;
create policy unit_tests_select on public.unit_tests for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('admin')
    or public.has_role('director')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (
      (public.has_role('homeroom_teacher') or public.has_role('subject_teacher'))
      and (
        class_id = public.my_class()
        or (
          class_id in (select public.assigned_class_ids())
          and subject_id in (select public.assigned_class_subjects(class_id))
        )
      )
    )
  )
);

-- 6. scores_select
drop policy if exists scores_select on public.scores;
create policy scores_select on public.scores for select using (
  public.has_role('admin')
  or public.has_role('director')
  or public.has_role('head_of_school')
  or public.has_role('curriculum_coordinator')
  or public.can_see_test(unit_test_id)
);
