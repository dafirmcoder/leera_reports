-- ==============================================================================
-- Migration: Fix Unit Tests RLS Policies for Leadership, Coordinators & Teachers
-- Resolves: "new row violates row-level security policy for table unit_tests"
-- ==============================================================================

-- 1. Helper function: my_class() fallback to homeroom_teacher_id
create or replace function public.my_class()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select class_id from public.profiles where id = auth.uid()),
    (select id from public.classes where homeroom_teacher_id = auth.uid() limit 1)
  );
$$;

-- 2. Helper function: can_edit_test(p_test uuid)
create or replace function public.can_edit_test(p_test uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.unit_tests t
    join public.classes c on c.id = t.class_id
    where t.id = p_test
      and c.school_id = public.my_school()
      and (
        public.has_role('admin')
        or public.has_role('head_of_school')
        or public.has_role('curriculum_coordinator')
        or (
          public.has_role('homeroom_teacher')
          and (t.class_id = public.my_class() or c.homeroom_teacher_id = auth.uid())
        )
        or (
          public.has_role('subject_teacher')
          and t.class_id in (select public.assigned_class_ids())
          and t.subject_id in (select public.assigned_class_subjects(t.class_id))
        )
      )
  );
$$;

-- 3. Helper function: can_see_test(p_test uuid)
create or replace function public.can_see_test(p_test uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.unit_tests t
    join public.classes c on c.id = t.class_id
    where t.id = p_test
      and c.school_id = public.my_school()
      and (
        public.has_role('admin')
        or public.has_role('director')
        or public.has_role('head_of_school')
        or public.has_role('curriculum_coordinator')
        or (
          public.has_role('homeroom_teacher')
          and (t.class_id = public.my_class() or c.homeroom_teacher_id = auth.uid())
        )
        or (
          public.has_role('subject_teacher')
          and t.class_id in (select public.assigned_class_ids())
          and t.subject_id in (select public.assigned_class_subjects(t.class_id))
        )
      )
  );
$$;

-- 4. unit_tests_select
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
      public.has_role('subject_teacher')
      and class_id in (select public.assigned_class_ids())
      and subject_id in (select public.assigned_class_subjects(class_id))
    )
  )
);

-- 5. unit_tests_insert
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
      public.has_role('subject_teacher')
      and class_id in (select public.assigned_class_ids())
      and subject_id in (select public.assigned_class_subjects(class_id))
    )
  )
);

-- 6. unit_tests_update
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
      public.has_role('subject_teacher')
      and class_id in (select public.assigned_class_ids())
      and subject_id in (select public.assigned_class_subjects(class_id))
    )
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
      public.has_role('subject_teacher')
      and class_id in (select public.assigned_class_ids())
      and subject_id in (select public.assigned_class_subjects(class_id))
    )
  )
);

-- 7. unit_tests_delete
drop policy if exists unit_tests_delete on public.unit_tests;
create policy unit_tests_delete on public.unit_tests for delete using (
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
      public.has_role('subject_teacher')
      and class_id in (select public.assigned_class_ids())
      and subject_id in (select public.assigned_class_subjects(class_id))
    )
  )
);

-- 8. Storage bucket update policy with explicit WITH CHECK
drop policy if exists "Allow teachers to update own exam papers" on storage.objects;
create policy "Allow teachers to update own exam papers" on storage.objects for update to authenticated
using (bucket_id = 'exam-papers')
with check (bucket_id = 'exam-papers');
