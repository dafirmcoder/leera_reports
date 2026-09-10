-- Fix homeroom teachers acting as subject teachers in other classes.
-- Idempotent: policies are dropped and recreated; functions are replaced.

create or replace function public.can_edit_test(p_test uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.unit_tests t
    where t.id = p_test
      and public.my_role() in ('homeroom_teacher','subject_teacher')
      and (
        t.class_id = public.my_class()
        or (
          t.class_id in (select public.assigned_class_ids())
          and t.subject_id in (select public.assigned_class_subjects(t.class_id))
        )
      )
  );
$$;

create or replace function public.can_see_test(p_test uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.unit_tests t
    join public.classes c on c.id = t.class_id
    where t.id = p_test
      and c.school_id = public.my_school()
      and (
        public.my_role() in ('director','head_of_school','curriculum_coordinator')
        or (
          public.my_role() in ('homeroom_teacher','subject_teacher')
          and (
            t.class_id = public.my_class()
            or (
              t.class_id in (select public.assigned_class_ids())
              and t.subject_id in (select public.assigned_class_subjects(t.class_id))
            )
          )
        )
      )
  );
$$;

drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes for select using (
  school_id = public.my_school()
  and (
    public.my_role() in ('director','head_of_school','curriculum_coordinator')
    or (
      public.my_role() in ('homeroom_teacher','subject_teacher')
      and (id = public.my_class() or id in (select public.assigned_class_ids()))
    )
  )
);

drop policy if exists students_select on public.students;
create policy students_select on public.students for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.my_role() in ('director','head_of_school','curriculum_coordinator')
    or (
      public.my_role() in ('homeroom_teacher','subject_teacher')
      and (class_id = public.my_class() or class_id in (select public.assigned_class_ids()))
    )
  )
);

drop policy if exists unit_tests_select on public.unit_tests;
create policy unit_tests_select on public.unit_tests for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.my_role() in ('director','head_of_school','curriculum_coordinator')
    or (
      public.my_role() in ('homeroom_teacher','subject_teacher')
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

drop policy if exists unit_tests_insert on public.unit_tests;
create policy unit_tests_insert on public.unit_tests for insert with check (
  public.my_role() in ('homeroom_teacher','subject_teacher')
  and (
    class_id = public.my_class()
    or (
      class_id in (select public.assigned_class_ids())
      and subject_id in (select public.assigned_class_subjects(class_id))
    )
  )
);

drop policy if exists unit_tests_update on public.unit_tests;
create policy unit_tests_update on public.unit_tests for update
  using (
    public.my_role() in ('homeroom_teacher','subject_teacher')
    and (
      class_id = public.my_class()
      or (class_id in (select public.assigned_class_ids()) and subject_id in (select public.assigned_class_subjects(class_id)))
    )
  )
  with check (
    public.my_role() in ('homeroom_teacher','subject_teacher')
    and (
      class_id = public.my_class()
      or (class_id in (select public.assigned_class_ids()) and subject_id in (select public.assigned_class_subjects(class_id)))
    )
  );

drop policy if exists unit_tests_delete on public.unit_tests;
create policy unit_tests_delete on public.unit_tests for delete using (
  public.my_role() in ('homeroom_teacher','subject_teacher')
  and (
    class_id = public.my_class()
    or (class_id in (select public.assigned_class_ids()) and subject_id in (select public.assigned_class_subjects(class_id)))
  )
);

drop policy if exists scores_select on public.scores;
create policy scores_select on public.scores for select using (public.can_see_test(unit_test_id));
drop policy if exists scores_insert on public.scores;
create policy scores_insert on public.scores for insert with check (public.can_edit_test(unit_test_id));
drop policy if exists scores_update on public.scores;
create policy scores_update on public.scores for update
  using (public.can_edit_test(unit_test_id))
  with check (public.can_edit_test(unit_test_id));
drop policy if exists scores_delete on public.scores;
create policy scores_delete on public.scores for delete using (public.can_edit_test(unit_test_id));
