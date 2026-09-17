-- ==============================================================================
-- Migration: Restrict Unit Tests Delete to Coordinators and Leadership
-- Teachers (except coordinators) cannot delete a test.
-- ==============================================================================

-- 1. Restrict unit_tests_delete to admin, head_of_school, and curriculum_coordinator
drop policy if exists unit_tests_delete on public.unit_tests;
create policy unit_tests_delete on public.unit_tests for delete using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('admin')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
  )
);

-- 2. Restrict exam papers deletion to coordinators and leadership
drop policy if exists "Allow teachers to delete own exam papers" on storage.objects;
drop policy if exists "Allow authorized to delete exam papers" on storage.objects;
create policy "Allow authorized to delete exam papers" on storage.objects for delete to authenticated
using (
  bucket_id = 'exam-papers'
  and (
    public.has_role('admin')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
  )
);
