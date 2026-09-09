-- Return the next numeric admission number for the signed-in user's school.
-- SECURITY DEFINER is required because homeroom teachers can only read their
-- own class, while admission numbers must be considered school-wide.
create or replace function public.next_admission_no()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select (coalesce(max(case when trim(s.admission_no) ~ '^[0-9]+$' then trim(s.admission_no)::bigint end), 0) + 1)::text
  from public.students s
  join public.classes c on c.id = s.class_id
  where c.school_id = public.my_school();
$$;