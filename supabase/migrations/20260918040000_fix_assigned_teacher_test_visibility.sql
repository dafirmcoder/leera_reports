-- ==============================================================================
-- Migration: Fix Assigned Teacher Test Visibility & Permissions
-- Allows any teacher assigned in class_subject_teachers (regardless of primary role,
-- e.g. homeroom_teacher assigned to teach subjects in other classes) or creator
-- to view, insert, and edit unit tests and scores.
-- ==============================================================================

-- 1. Helper function: can_edit_test(p_test uuid)
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
          t.class_id in (select public.assigned_class_ids())
          and t.subject_id in (select public.assigned_class_subjects(t.class_id))
        )
        or t.created_by = auth.uid()
      )
  );
$$;

-- 2. Helper function: can_see_test(p_test uuid)
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
          t.class_id in (select public.assigned_class_ids())
          and t.subject_id in (select public.assigned_class_subjects(t.class_id))
        )
        or t.created_by = auth.uid()
      )
  );
$$;

-- 3. unit_tests_select
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

-- 4. unit_tests_insert
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

-- 5. unit_tests_update
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
