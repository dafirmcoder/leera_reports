-- Admission numbers are school-wide identifiers. Repair existing duplicates
-- before enforcing uniqueness for all future inserts and updates.
do $$
declare
  next_no bigint;
begin
  select coalesce(max(case
    when trim(admission_no) ~ '^[0-9]+$' then trim(admission_no)::bigint
  end), 0)
  into next_no
  from public.students;

  with ranked as (
    select id, admission_no,
      row_number() over (partition by admission_no order by created_at, id) as duplicate_rank
    from public.students
  ),
  repairs as (
    select id, row_number() over (order by id) as repair_number
    from ranked
    where duplicate_rank > 1 or trim(admission_no) = ''
  )
  update public.students s
  set admission_no = (next_no + repairs.repair_number)::text
  from repairs
  where s.id = repairs.id;
end $$;

create unique index if not exists students_admission_no_unique_idx
  on public.students (admission_no);