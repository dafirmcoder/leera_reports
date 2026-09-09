-- Coordinators can assign subject teachers in any class, including users who
-- have coordinator as an additional role alongside homeroom teacher.
drop policy if exists cst_insert on public.class_subject_teachers;
create policy cst_insert on public.class_subject_teachers for insert with check (
  public.has_role('head_of_school')
  or public.has_role('curriculum_coordinator')
  or (public.has_role('homeroom_teacher') and class_id = public.my_class())
);

drop policy if exists cst_delete on public.class_subject_teachers;
create policy cst_delete on public.class_subject_teachers for delete using (
  public.has_role('head_of_school')
  or public.has_role('curriculum_coordinator')
  or (public.has_role('homeroom_teacher') and class_id = public.my_class())
);