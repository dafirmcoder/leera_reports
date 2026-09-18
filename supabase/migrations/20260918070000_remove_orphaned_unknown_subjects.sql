-- ==============================================================================
-- Migration: Remove Orphaned & Unknown Subjects from Database
-- Cleans up any unit tests and teacher assignments associated with invalid/non-existent subject IDs.
-- ==============================================================================

-- 1. Delete scores attached to orphaned unit tests
delete from public.scores
where unit_test_id in (
  select id from public.unit_tests
  where subject_id not in (select id from public.subjects)
     or subject_id in ('7a0b5c50-b228-4023-968e-f8116c51ff59', 'b3b1efc7-8ea6-4952-9516-947cbb687fba')
);

-- 2. Delete orphaned unit tests
delete from public.unit_tests
where subject_id not in (select id from public.subjects)
   or subject_id in ('7a0b5c50-b228-4023-968e-f8116c51ff59', 'b3b1efc7-8ea6-4952-9516-947cbb687fba');

-- 3. Delete orphaned class_subject_teachers assignments
delete from public.class_subject_teachers
where subject_id not in (select id from public.subjects)
   or subject_id in ('7a0b5c50-b228-4023-968e-f8116c51ff59', 'b3b1efc7-8ea6-4952-9516-947cbb687fba');

-- 4. Verification: List remaining valid tests for Teacher Grace Andrew
select
  c.name as class_name,
  s.name as subject_name,
  p.full_name as teacher_name,
  ut.title as test_title,
  ut.max_mark,
  ut.test_date
from public.unit_tests ut
join public.classes c on c.id = ut.class_id
join public.subjects s on s.id = ut.subject_id
join public.profiles p on p.id = ut.created_by
where p.id = 'd6e2754a-2594-4f1b-9d56-3eced8c090cb'
   or lower(p.full_name) like '%grace%andrew%'
order by c.name, s.name;
