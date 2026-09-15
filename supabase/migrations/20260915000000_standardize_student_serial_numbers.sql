-- ==============================================================================
-- Migration: Standardize Student Serial Numbers (ST-001 format) & Protect from Teacher Interference
-- ==============================================================================

-- 1. Standardize existing student serial numbers across all classes to ST-001, ST-002, etc.
--    Extracts digits from existing records to preserve natural ordering within each class.
--    Uses temporary keys to avoid unique constraint violations on (class_id, student_no).
do $$
begin
  -- Build standardized sequence per class based on existing numbers/order
  create temp table _standardized_students on commit drop as
  select
    id,
    class_id,
    'ST-' || lpad(row_number() over (
      partition by class_id
      order by
        coalesce(nullif(regexp_replace(student_no, '[^0-9]', '', 'g'), '')::bigint, 999999),
        created_at,
        full_name,
        id
    )::text, 3, '0') as new_student_no
  from public.students;

  -- Temporarily clear unique collisions on (class_id, student_no)
  update public.students s
  set student_no = 'TEMP_' || s.id::text;

  -- Apply standardized ST-001 format
  update public.students s
  set student_no = t.new_student_no
  from _standardized_students t
  where s.id = t.id;
end $$;

-- 2. Trigger function to enforce ST-xxx format on INSERT and disallow modifications on UPDATE
create or replace function public.enforce_student_serial_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_seq bigint;
  extracted_num bigint;
begin
  if TG_OP = 'UPDATE' then
    -- Prevent teachers or any client update from altering an assigned serial number
    if OLD.student_no is not null and OLD.student_no <> '' then
      NEW.student_no := OLD.student_no;
    end if;
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    -- If student_no is provided, extract digits and format to ST-xxx
    if NEW.student_no is not null and trim(NEW.student_no) <> '' then
      extracted_num := nullif(regexp_replace(NEW.student_no, '[^0-9]', '', 'g'), '')::bigint;
    end if;

    if extracted_num is not null then
      NEW.student_no := 'ST-' || lpad(extracted_num::text, 3, '0');
    else
      -- Auto-generate next serial number for this class if missing or unformatted
      select coalesce(max(nullif(regexp_replace(student_no, '[^0-9]', '', 'g'), '')::bigint), 0) + 1
      into next_seq
      from public.students
      where class_id = NEW.class_id;

      NEW.student_no := 'ST-' || lpad(next_seq::text, 3, '0');
    end if;

    return NEW;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_student_serial_no on public.students;
create trigger trg_enforce_student_serial_no
  before insert or update on public.students
  for each row
  execute function public.enforce_student_serial_no();

-- 3. Enforce valid ST-xxx format with a check constraint (3 or more digits, e.g. ST-001, ST-100)
alter table public.students
  drop constraint if exists students_student_no_format_chk;

alter table public.students
  add constraint students_student_no_format_chk
  check (student_no ~ '^ST-[0-9]{3,}$');
