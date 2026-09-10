-- Teachers can mark only today's attendance. Coordinators can backfill past
-- dates, but nobody can create or change attendance for a future date.
drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance for insert with check (
  attendance_date <= current_date
  and (
    (public.has_role('curriculum_coordinator'))
    or (public.has_role('homeroom_teacher') and class_id = public.my_class() and attendance_date = current_date)
  )
);

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance for update
using (
  attendance_date <= current_date
  and (
    public.has_role('curriculum_coordinator')
    or (public.has_role('homeroom_teacher') and class_id = public.my_class() and attendance_date = current_date)
  )
)
with check (
  attendance_date <= current_date
  and (
    public.has_role('curriculum_coordinator')
    or (public.has_role('homeroom_teacher') and class_id = public.my_class() and attendance_date = current_date)
  )
);

drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance for delete
using (
  attendance_date <= current_date
  and (
    public.has_role('curriculum_coordinator')
    or (public.has_role('homeroom_teacher') and class_id = public.my_class() and attendance_date = current_date)
  )
);