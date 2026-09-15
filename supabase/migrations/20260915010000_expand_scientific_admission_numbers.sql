-- ==============================================================================
-- Migration: Expand Scientific Notation in Admission Numbers to Real Full Numbers
-- ==============================================================================

-- 1. Helper function to expand scientific notation (e.g. '2.48923E+13' -> '24892300000000'
--    and '2.48923E+13-1' -> '24892300000000-1')
create or replace function public.expand_scientific_notation(val text)
returns text
language plpgsql
immutable
as $$
declare
  matches text[];
  sci_part text;
  suffix text;
  expanded text;
begin
  if val is null or trim(val) = '' then
    return val;
  end if;

  if trim(val) ~* '^[+-]?[0-9]+(\.[0-9]+)?[e][+-]?[0-9]+' then
    matches := regexp_matches(trim(val), '^([+-]?[0-9]+(?:\.[0-9]+)?[eE][+-]?[0-9]+)(.*)$');
    sci_part := matches[1];
    suffix := matches[2];
    begin
      expanded := (sci_part::numeric)::text || coalesce(suffix, '');
      return expanded;
    exception when others then
      return val;
    end;
  end if;

  return val;
end;
$$;

-- 2. Trigger function to ensure any inserted or updated admission number is stored as a real full number
create or replace function public.trg_format_admission_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.admission_no is not null and trim(NEW.admission_no) <> '' then
    NEW.admission_no := public.expand_scientific_notation(NEW.admission_no);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_expand_scientific_admission_no on public.students;
create trigger trg_expand_scientific_admission_no
  before insert or update of admission_no on public.students
  for each row
  execute function public.trg_format_admission_no();

-- 3. Convert all existing records in public.students that have scientific notation
update public.students
set admission_no = public.expand_scientific_notation(admission_no)
where admission_no ~* '[0-9]+(\.[0-9]+)?[e][+-]?[0-9]+';
