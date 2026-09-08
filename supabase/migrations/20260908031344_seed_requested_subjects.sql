-- Seed the school's requested subject list without duplicating existing subjects.
insert into public.subjects (school_id, name, sort_order)
select s.id, requested.name, requested.sort_order
from public.schools s
cross join (values
  ('Mathematics', 1),
  ('English', 2),
  ('Science', 3),
  ('Biology', 4),
  ('Chemistry', 5),
  ('Physics', 6),
  ('Global Perspectives', 7),
  ('Geography', 8),
  ('Humanities', 9),
  ('ICT', 10),
  ('Business Studies', 11),
  ('Economics', 12),
  ('Computer Science', 13),
  ('Art', 14),
  ('Chinese', 15)
) as requested(name, sort_order)
where not exists (
  select 1
  from public.subjects existing
  where existing.school_id = s.id
    and lower(existing.name) = lower(requested.name)
);
