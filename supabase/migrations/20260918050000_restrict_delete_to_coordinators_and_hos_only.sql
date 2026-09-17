-- ==============================================================================
-- Migration: Restrict Unit Test & Exam Paper Delete to Coordinators and HOS ONLY
-- Regular teachers (homeroom, subject) and admin cannot delete tests.
-- Only curriculum_coordinator and head_of_school have deletion privileges.
-- ==============================================================================

-- 1. unit_tests_delete: strictly head_of_school and curriculum_coordinator
drop policy if exists unit_tests_delete on public.unit_tests;
create policy unit_tests_delete on public.unit_tests for delete using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
  )
);

-- 2. Storage exam-papers delete: strictly head_of_school and curriculum_coordinator
drop policy if exists "Allow authorized to delete exam papers" on storage.objects;
create policy "Allow authorized to delete exam papers" on storage.objects for delete to authenticated
using (
  bucket_id = 'exam-papers'
  and (
    public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
  )
);
