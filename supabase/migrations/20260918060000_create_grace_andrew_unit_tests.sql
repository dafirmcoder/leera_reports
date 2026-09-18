-- ==============================================================================
-- Migration: Create End of Unit Tests for Teacher Grace Andrew & Fix Visibility
-- 1. Year 5 English (Teacher: Grace Andrew, Max: 100)
-- 2. Year 6 English (Teacher: Grace Andrew, Max: 100)
-- 3. Year 8 English (Teacher: Grace Andrew, Max: 100)
-- 4. Year 8 Geography (Teacher: Grace Andrew, Max: 100)
-- ==============================================================================

-- 1. Ensure Grace Andrew has 'subject_teacher' in additional_roles so dual role permissions pass
update public.profiles
set additional_roles = case
  when additional_roles is null or additional_roles = '{}' then array['subject_teacher']::text[]
  when not ('subject_teacher' = any(additional_roles)) then array_append(additional_roles, 'subject_teacher')
  else additional_roles
end
where id = 'd6e2754a-2594-4f1b-9d56-3eced8c090cb'
   or lower(full_name) like '%grace%andrew%'
   or lower(email) = 'grace.andrew@leeraschool.ac.tz';

-- 2. Ensure Teacher Subject Assignments exist in class_subject_teachers
insert into public.class_subject_teachers (class_id, subject_id, teacher_id)
select c.id, s.id, p.id
from public.classes c
cross join public.subjects s
cross join public.profiles p
where (p.id = 'd6e2754a-2594-4f1b-9d56-3eced8c090cb' or lower(p.full_name) like '%grace%andrew%')
  and (
    ((trim(lower(c.name)) = 'year 5' or c.name ilike '%year 5%') and trim(lower(s.name)) = 'english')
    or ((trim(lower(c.name)) = 'year 6' or c.name ilike '%year 6%') and trim(lower(s.name)) = 'english')
    or ((trim(lower(c.name)) = 'year 8' or c.name ilike '%year 8%') and trim(lower(s.name)) = 'english')
    or ((trim(lower(c.name)) = 'year 8' or c.name ilike '%year 8%') and trim(lower(s.name)) = 'geography')
  )
on conflict (class_id, subject_id, teacher_id) do nothing;

-- 3. Ensure Row Level Security (RLS) policies permit assigned teachers and test creators to view & manage
drop policy if exists unit_tests_select on public.unit_tests;
create policy unit_tests_select on public.unit_tests for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('admin')
    or public.has_role('director')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (
      public.has_role('homeroom_teacher')
      and (class_id = public.my_class() or class_id in (select c.id from public.classes c where c.homeroom_teacher_id = auth.uid()))
    )
    or (
      class_id in (select public.assigned_class_ids())
      and subject_id in (select public.assigned_class_subjects(class_id))
    )
    or created_by = auth.uid()
  )
);

drop policy if exists unit_tests_insert on public.unit_tests;
create policy unit_tests_insert on public.unit_tests for insert with check (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('admin')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (
      public.has_role('homeroom_teacher')
      and (class_id = public.my_class() or class_id in (select c.id from public.classes c where c.homeroom_teacher_id = auth.uid()))
    )
    or (
      class_id in (select public.assigned_class_ids())
      and subject_id in (select public.assigned_class_subjects(class_id))
    )
    or created_by = auth.uid()
  )
);

drop policy if exists unit_tests_update on public.unit_tests;
create policy unit_tests_update on public.unit_tests for update
using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('admin')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (
      public.has_role('homeroom_teacher')
      and (class_id = public.my_class() or class_id in (select c.id from public.classes c where c.homeroom_teacher_id = auth.uid()))
    )
    or (
      class_id in (select public.assigned_class_ids())
      and subject_id in (select public.assigned_class_subjects(class_id))
    )
    or created_by = auth.uid()
  )
)
with check (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('admin')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (
      public.has_role('homeroom_teacher')
      and (class_id = public.my_class() or class_id in (select c.id from public.classes c where c.homeroom_teacher_id = auth.uid()))
    )
    or (
      class_id in (select public.assigned_class_ids())
      and subject_id in (select public.assigned_class_subjects(class_id))
    )
    or created_by = auth.uid()
  )
);

drop policy if exists scores_select on public.scores;
create policy scores_select on public.scores for select using (
  exists (
    select 1 from public.unit_tests t
    join public.classes c on c.id = t.class_id
    where t.id = unit_test_id and c.school_id = public.my_school()
  )
  and (
    public.has_role('admin')
    or public.has_role('director')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (
      public.has_role('homeroom_teacher')
      and exists (select 1 from public.unit_tests t where t.id = unit_test_id and (t.class_id = public.my_class() or t.created_by = auth.uid()))
    )
    or (
      exists (
        select 1 from public.unit_tests t
        where t.id = unit_test_id
          and (
            (t.class_id in (select public.assigned_class_ids()) and t.subject_id in (select public.assigned_class_subjects(t.class_id)))
            or t.created_by = auth.uid()
          )
      )
    )
  )
);

drop policy if exists scores_update on public.scores;
create policy scores_update on public.scores for update using (
  (public.has_role('admin') or public.has_role('head_of_school') or public.has_role('curriculum_coordinator'))
  or (public.has_role('homeroom_teacher') and exists (select 1 from public.unit_tests t where t.id = unit_test_id and (t.class_id = public.my_class() or t.created_by = auth.uid())))
  or exists (
    select 1 from public.unit_tests t
    where t.id = unit_test_id
      and (
        (t.class_id in (select public.assigned_class_ids()) and t.subject_id in (select public.assigned_class_subjects(t.class_id)))
        or t.created_by = auth.uid()
      )
  )
) with check (
  (public.has_role('admin') or public.has_role('head_of_school') or public.has_role('curriculum_coordinator'))
  or (public.has_role('homeroom_teacher') and exists (select 1 from public.unit_tests t where t.id = unit_test_id and (t.class_id = public.my_class() or t.created_by = auth.uid())))
  or exists (
    select 1 from public.unit_tests t
    where t.id = unit_test_id
      and (
        (t.class_id in (select public.assigned_class_ids()) and t.subject_id in (select public.assigned_class_subjects(t.class_id)))
        or t.created_by = auth.uid()
      )
  )
);

-- 4. Insert the 4 requested End of Unit Tests (if not already existing)
-- 1) Year 5 English
insert into public.unit_tests (class_id, subject_id, created_by, title, test_date, max_mark)
select c.id, s.id, p.id, 'Unit 1: English Assessment', current_date, 100
from public.classes c
cross join public.subjects s
cross join public.profiles p
where (p.id = 'd6e2754a-2594-4f1b-9d56-3eced8c090cb' or lower(p.full_name) like '%grace%andrew%')
  and (trim(lower(c.name)) = 'year 5' or c.name ilike '%year 5%')
  and trim(lower(s.name)) = 'english'
  and not exists (
    select 1 from public.unit_tests ut
    where ut.class_id = c.id and ut.subject_id = s.id and ut.created_by = p.id
  );

-- 2) Year 6 English
insert into public.unit_tests (class_id, subject_id, created_by, title, test_date, max_mark)
select c.id, s.id, p.id, 'Unit 1: English Assessment', current_date, 100
from public.classes c
cross join public.subjects s
cross join public.profiles p
where (p.id = 'd6e2754a-2594-4f1b-9d56-3eced8c090cb' or lower(p.full_name) like '%grace%andrew%')
  and (trim(lower(c.name)) = 'year 6' or c.name ilike '%year 6%')
  and trim(lower(s.name)) = 'english'
  and not exists (
    select 1 from public.unit_tests ut
    where ut.class_id = c.id and ut.subject_id = s.id and ut.created_by = p.id
  );

-- 3) Year 8 English
insert into public.unit_tests (class_id, subject_id, created_by, title, test_date, max_mark)
select c.id, s.id, p.id, 'Unit 1: English Assessment', current_date, 100
from public.classes c
cross join public.subjects s
cross join public.profiles p
where (p.id = 'd6e2754a-2594-4f1b-9d56-3eced8c090cb' or lower(p.full_name) like '%grace%andrew%')
  and (trim(lower(c.name)) = 'year 8' or c.name ilike '%year 8%')
  and trim(lower(s.name)) = 'english'
  and not exists (
    select 1 from public.unit_tests ut
    where ut.class_id = c.id and ut.subject_id = s.id and ut.created_by = p.id
  );

-- 4) Year 8 Geography
insert into public.unit_tests (class_id, subject_id, created_by, title, test_date, max_mark)
select c.id, s.id, p.id, 'Unit 1: Geography Assessment', current_date, 100
from public.classes c
cross join public.subjects s
cross join public.profiles p
where (p.id = 'd6e2754a-2594-4f1b-9d56-3eced8c090cb' or lower(p.full_name) like '%grace%andrew%')
  and (trim(lower(c.name)) = 'year 8' or c.name ilike '%year 8%')
  and trim(lower(s.name)) = 'geography'
  and not exists (
    select 1 from public.unit_tests ut
    where ut.class_id = c.id and ut.subject_id = s.id and ut.created_by = p.id
  );

-- 5. Initialize Student Score Rows (Score = NULL) for all students in these classes
insert into public.scores (unit_test_id, student_id, score)
select ut.id, s.id, null
from public.unit_tests ut
join public.students s on s.class_id = ut.class_id
where ut.created_by = 'd6e2754a-2594-4f1b-9d56-3eced8c090cb'
   or ut.created_by in (select id from public.profiles where lower(full_name) like '%grace%andrew%')
on conflict (unit_test_id, student_id) do nothing;

-- 6. Immediate verification output in Supabase SQL editor
select
  c.name as class_name,
  s.name as subject_name,
  p.full_name as teacher_name,
  ut.title as unit_test_title,
  ut.max_mark,
  ut.test_date,
  (select count(*) from public.scores sc where sc.unit_test_id = ut.id) as enrolled_students_initialized
from public.unit_tests ut
join public.classes c on c.id = ut.class_id
join public.subjects s on s.id = ut.subject_id
join public.profiles p on p.id = ut.created_by
where p.id = 'd6e2754a-2594-4f1b-9d56-3eced8c090cb'
   or lower(p.full_name) like '%grace%andrew%'
order by c.name, s.name;
