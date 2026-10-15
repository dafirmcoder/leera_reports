-- ==============================================================================
-- Migration: 20261016010000_remove_grace_andrew_orphaned_assignments.sql
-- Purpose: Remove orphaned class-subject assignments for Teacher Grace Andrew
--          in Year 6 and Year 8 that reference non-existent / deleted subjects.
-- ==============================================================================

-- 1. Remove orphaned assignments in class_subject_teachers where subject does not exist
DELETE FROM public.class_subject_teachers
WHERE teacher_id IN (
  SELECT id FROM public.profiles WHERE lower(full_name) LIKE '%grace%andrew%' OR id = 'd6e2754a-2594-4f1b-9d56-3eced8c090cb'
)
AND (
  subject_id NOT IN (SELECT id FROM public.subjects)
  OR subject_id IN ('7a0b5c50-b228-4023-968e-f8116c51ff59', 'b3b1efc7-8ea6-4952-9516-947cbb687fba')
);

-- 2. Clean up any scores or unit_tests pointing to non-existent subjects for safety
DELETE FROM public.scores
WHERE unit_test_id IN (
  SELECT id FROM public.unit_tests
  WHERE subject_id NOT IN (SELECT id FROM public.subjects)
     OR subject_id IN ('7a0b5c50-b228-4023-968e-f8116c51ff59', 'b3b1efc7-8ea6-4952-9516-947cbb687fba')
);

DELETE FROM public.unit_tests
WHERE subject_id NOT IN (SELECT id FROM public.subjects)
   OR subject_id IN ('7a0b5c50-b228-4023-968e-f8116c51ff59', 'b3b1efc7-8ea6-4952-9516-947cbb687fba');
