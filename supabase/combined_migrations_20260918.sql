-- ==============================================================================
-- COMBINED LEERA REPORTS MIGRATIONS (2026-09-18)
-- Run this script in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ==============================================================================

-- >>> START OF MIGRATION: 20260917000000_standardize_serial_numbers_plain.sql <<<

-- ==============================================================================
-- Migration: Standardize Student Serial Numbers (Plain Integers: 1, 2, 3...) & Protect from Alteration
-- ==============================================================================

-- 1. Drop old trigger and constraint
DROP TRIGGER IF EXISTS trg_enforce_student_serial_no ON public.students;
DROP FUNCTION IF EXISTS public.enforce_student_serial_no();
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_student_no_format_chk;

-- 2. Standardize existing serial numbers to 1, 2, 3... per class
--    Uses temporary keys to avoid unique constraint violations on (class_id, student_no).
DO $$
BEGIN
  CREATE TEMP TABLE _std_serial ON COMMIT DROP AS
  SELECT id, class_id,
    row_number() OVER (
      PARTITION BY class_id
      ORDER BY
        COALESCE(NULLIF(regexp_replace(student_no, '[^0-9]', '', 'g'), '')::bigint, 999999),
        created_at,
        full_name,
        id
    ) AS new_no
  FROM public.students;

  UPDATE public.students s SET student_no = 'TEMP_' || s.id::text;

  UPDATE public.students s
  SET student_no = t.new_no::text
  FROM _std_serial t WHERE s.id = t.id;
END $$;

-- 3. New trigger function: auto-generate plain integer per class, protect on UPDATE
CREATE OR REPLACE FUNCTION public.enforce_student_serial_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  next_seq bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.student_no IS NOT NULL AND OLD.student_no <> '' THEN
      NEW.student_no := OLD.student_no;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.student_no IS NULL OR trim(NEW.student_no) = '' OR NEW.student_no ~ '^TEMP_' THEN
      SELECT COALESCE(MAX(NULLIF(student_no, '')::bigint), 0) + 1 INTO next_seq
      FROM public.students WHERE class_id = NEW.class_id;
      NEW.student_no := next_seq::text;
    ELSE
      -- Extract digits and store as plain integer string
      NEW.student_no := NULLIF(regexp_replace(NEW.student_no, '[^0-9]', '', 'g'), '')::bigint::text;
      IF NEW.student_no IS NULL THEN
        SELECT COALESCE(MAX(NULLIF(student_no, '')::bigint), 0) + 1 INTO next_seq
        FROM public.students WHERE class_id = NEW.class_id;
        NEW.student_no := next_seq::text;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_student_serial_no
BEFORE INSERT OR UPDATE ON public.students
FOR EACH ROW EXECUTE FUNCTION public.enforce_student_serial_no();

ALTER TABLE public.students
  ADD CONSTRAINT students_student_no_format_chk
  CHECK (student_no ~ '^[0-9]+$');


-- >>> END OF MIGRATION: 20260917000000_standardize_serial_numbers_plain.sql <<<

-- >>> START OF MIGRATION: 20260917010000_standardize_roll_numbers_LIS.sql <<<

-- ==============================================================================
-- Migration: Standardize Admission Numbers to LIS-XXX/CLASSCODE/YY (Roll Numbers)
-- ==============================================================================

-- 1. Helper to extract class code from class name
CREATE OR REPLACE FUNCTION public.get_class_code(p_class_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  yr text;
  stream text;
  code text;
BEGIN
  IF p_class_name IS NULL THEN RETURN '0'; END IF;
  -- Extract Year number
  yr := (regexp_match(p_class_name, 'Year\s*([0-9]+)', 'i'))[1];
  IF yr IS NULL THEN
    yr := (regexp_match(p_class_name, '([0-9]+)', 'i'))[1];
  END IF;
  IF yr IS NULL THEN yr := '0'; END IF;

  -- Extract stream word after year number (ATLANTIC, PACIFIC, BLUE etc)
  stream := (regexp_match(p_class_name, 'Year\s*[0-9]+\s*([A-Za-z]+)', 'i'))[1];
  IF stream IS NOT NULL THEN
    code := yr || upper(substr(stream, 1, 1));
  ELSE
    code := yr;
  END IF;
  RETURN upper(code);
END;
$$;

-- 2. Helper to get 2-digit academic year suffix from schools table or current year
CREATE OR REPLACE FUNCTION public.get_year_suffix(p_school_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ay text;
  yr int;
BEGIN
  SELECT academic_year INTO ay FROM public.schools WHERE id = p_school_id LIMIT 1;
  IF ay IS NULL THEN SELECT academic_year INTO ay FROM public.schools ORDER BY created_at LIMIT 1; END IF;
  -- Try to extract first 4-digit year from academic_year like '2026/2027'
  yr := (regexp_match(ay, '([0-9]{4})'))[1]::int;
  IF yr IS NULL THEN yr := EXTRACT(YEAR FROM CURRENT_DATE)::int; END IF;
  RETURN lpad(((yr % 100)::text), 2, '0');
END;
$$;

-- 3. Function to generate standardized Roll No (LIS-001/9P/26)
CREATE OR REPLACE FUNCTION public.generate_roll_no(p_class_id uuid, p_seq int)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_name text;
  c_code text;
  s_id uuid;
  y_suffix text;
BEGIN
  SELECT name, school_id INTO c_name, s_id FROM public.classes WHERE id = p_class_id;
  c_code := public.get_class_code(c_name);
  y_suffix := public.get_year_suffix(s_id);
  RETURN 'LIS-' || lpad(p_seq::text, 3, '0') || '/' || c_code || '/' || y_suffix;
END;
$$;

-- 4. Standardize existing students' admission numbers per class
DO $$
DECLARE
  r record;
BEGIN
  -- Temporarily clear admission_no to prevent unique violations
  UPDATE public.students SET admission_no = 'TEMP_' || id::text;

  FOR r IN SELECT id, name, school_id FROM public.classes LOOP
    WITH ordered AS (
      SELECT id, row_number() OVER (
        ORDER BY
          COALESCE(NULLIF(regexp_replace(student_no, '[^0-9]', '', 'g'), '')::bigint, 999999),
          created_at,
          full_name,
          id
      ) AS rn
      FROM public.students WHERE class_id = r.id
    )
    UPDATE public.students s
    SET admission_no = public.generate_roll_no(r.id, o.rn::int)
    FROM ordered o WHERE s.id = o.id;
  END LOOP;

  -- Fallback for any orphaned students whose class_id was not found
  UPDATE public.students s
  SET admission_no = 'LIS-' || lpad(s.id::text, 3, '0') || '/0/' || to_char(CURRENT_DATE, 'YY')
  WHERE s.admission_no LIKE 'TEMP_%';
END $$;

-- 5. Trigger function to auto-generate and validate admission_no / roll_no
CREATE OR REPLACE FUNCTION public.trg_format_admission_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  seq int;
BEGIN
  -- If admission_no already matches LIS-xxx/CODE/YY, normalize to uppercase and keep it
  IF NEW.admission_no ~* '^LIS-[0-9]{3}/[0-9]+[A-Z]?/[0-9]{2}$' THEN
    NEW.admission_no := upper(NEW.admission_no);
    RETURN NEW;
  END IF;

  -- If admission_no is empty or invalid, auto-generate next sequence for the class
  IF NEW.admission_no IS NULL OR trim(NEW.admission_no) = '' OR NEW.admission_no !~* '^LIS-' THEN
    SELECT COALESCE(MAX(
      CASE WHEN admission_no ~* '^LIS-([0-9]{3})/'
      THEN (substring(admission_no from '^LIS-([0-9]{3})/'))::int END
    ), 0) + 1 INTO seq FROM public.students WHERE class_id = NEW.class_id;

    NEW.admission_no := public.generate_roll_no(NEW.class_id, seq);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expand_scientific_admission_no ON public.students;
DROP TRIGGER IF EXISTS trg_format_admission_no ON public.students;
CREATE TRIGGER trg_format_admission_no
BEFORE INSERT OR UPDATE OF admission_no ON public.students
FOR EACH ROW EXECUTE FUNCTION public.trg_format_admission_no();

-- 6. RPC functions: next_admission_no and next_roll_no
CREATE OR REPLACE FUNCTION public.next_admission_no(p_class_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  next_seq int;
BEGIN
  IF p_class_id IS NULL THEN
    RETURN (SELECT (COALESCE(MAX(CASE WHEN admission_no ~* '^LIS-([0-9]{3})/' THEN (substring(admission_no from '^LIS-([0-9]{3})/'))::int END), 0) + 1)::text FROM public.students);
  END IF;

  SELECT COALESCE(MAX(CASE WHEN admission_no ~* '^LIS-([0-9]{3})/' THEN (substring(admission_no from '^LIS-([0-9]{3})/'))::int END), 0) + 1
  INTO next_seq
  FROM public.students
  WHERE class_id = p_class_id;

  RETURN public.generate_roll_no(p_class_id, next_seq);
END;
$$;

CREATE OR REPLACE FUNCTION public.next_roll_no(p_class_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.next_admission_no(p_class_id);
$$;


-- >>> END OF MIGRATION: 20260917010000_standardize_roll_numbers_LIS.sql <<<

-- >>> START OF MIGRATION: 20260917020000_rename_term_to_semester_and_admission_to_roll.sql <<<

-- ==============================================================================
-- Migration: Rename term -> semester and admission_no -> roll_no
-- ==============================================================================

-- 1. Rename term -> semester on schools table (idempotent)
-- 2. Rename admission_no -> roll_no on students table (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' and table_name = 'schools' and column_name = 'term'
  ) THEN
    ALTER TABLE public.schools RENAME COLUMN term TO semester;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' and table_name = 'students' and column_name = 'admission_no'
  ) THEN
    ALTER TABLE public.students RENAME COLUMN admission_no TO roll_no;
  END IF;
END $$;

-- 3. Update unique index
DROP INDEX IF EXISTS students_admission_no_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS students_roll_no_unique_idx ON public.students (roll_no);

-- 4. Update trigger function and trigger for roll_no
CREATE OR REPLACE FUNCTION public.trg_format_roll_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  seq int;
BEGIN
  -- If roll_no already matches LIS-xxx/CODE/YY, normalize to uppercase and keep it
  IF NEW.roll_no ~* '^LIS-[0-9]{3}/[0-9]+[A-Z]?/[0-9]{2}$' THEN
    NEW.roll_no := upper(NEW.roll_no);
    RETURN NEW;
  END IF;

  -- If roll_no is empty or invalid, auto-generate next sequence for the class
  IF NEW.roll_no IS NULL OR trim(NEW.roll_no) = '' OR NEW.roll_no !~* '^LIS-' THEN
    SELECT COALESCE(MAX(
      CASE WHEN roll_no ~* '^LIS-([0-9]{3})/'
      THEN (substring(roll_no from '^LIS-([0-9]{3})/'))::int END
    ), 0) + 1 INTO seq FROM public.students WHERE class_id = NEW.class_id;

    NEW.roll_no := public.generate_roll_no(NEW.class_id, seq);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_format_admission_no ON public.students;
DROP TRIGGER IF EXISTS trg_format_roll_no ON public.students;
CREATE TRIGGER trg_format_roll_no
BEFORE INSERT OR UPDATE OF roll_no ON public.students
FOR EACH ROW EXECUTE FUNCTION public.trg_format_roll_no();

-- 5. Update RPC functions to query roll_no
CREATE OR REPLACE FUNCTION public.next_admission_no(p_class_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  next_seq int;
BEGIN
  IF p_class_id IS NULL THEN
    RETURN (SELECT (COALESCE(MAX(CASE WHEN roll_no ~* '^LIS-([0-9]{3})/' THEN (substring(roll_no from '^LIS-([0-9]{3})/'))::int END), 0) + 1)::text FROM public.students);
  END IF;

  SELECT COALESCE(MAX(CASE WHEN roll_no ~* '^LIS-([0-9]{3})/' THEN (substring(roll_no from '^LIS-([0-9]{3})/'))::int END), 0) + 1
  INTO next_seq
  FROM public.students
  WHERE class_id = p_class_id;

  RETURN public.generate_roll_no(p_class_id, next_seq);
END;
$$;

CREATE OR REPLACE FUNCTION public.next_roll_no(p_class_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.next_admission_no(p_class_id);
$$;

-- 6. Add documentation comments
COMMENT ON COLUMN public.schools.semester IS 'Formerly term, now semester';
COMMENT ON COLUMN public.students.roll_no IS 'Formerly admission_no, format LIS-001/9P/26';


-- >>> END OF MIGRATION: 20260917020000_rename_term_to_semester_and_admission_to_roll.sql <<<

-- >>> START OF MIGRATION: 20260918000000_fix_admin_role_rls.sql <<<

-- ==============================================================================
-- Migration: Fix Admin Role RLS Policies
-- Ensures admin can read classes, students, subjects, attendance, unit_tests, and scores.
-- ==============================================================================

-- 1. classes_select
drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes for select using (
  school_id = public.my_school()
  and (
    public.has_role('admin')
    or public.has_role('director')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (
      (public.has_role('homeroom_teacher') or public.has_role('subject_teacher'))
      and (id = public.my_class() or id in (select public.assigned_class_ids()))
    )
  )
);

-- 2. students_select
drop policy if exists students_select on public.students;
create policy students_select on public.students for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('admin')
    or public.has_role('director')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (
      (public.has_role('homeroom_teacher') or public.has_role('subject_teacher'))
      and (class_id = public.my_class() or class_id in (select public.assigned_class_ids()))
    )
  )
);

-- 3. subjects_select
drop policy if exists subjects_select on public.subjects;
create policy subjects_select on public.subjects for select using (
  school_id = public.my_school()
);

-- 4. attendance_select
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('admin')
    or public.has_role('director')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (public.has_role('homeroom_teacher') and class_id = public.my_class())
  )
);

-- 5. unit_tests_select
drop policy if exists unit_tests_select on public.unit_tests;
create policy unit_tests_select on public.unit_tests for select using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('admin')
    or public.has_role('director')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
    or (
      (public.has_role('homeroom_teacher') or public.has_role('subject_teacher'))
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

-- 6. scores_select
drop policy if exists scores_select on public.scores;
create policy scores_select on public.scores for select using (
  public.has_role('admin')
  or public.has_role('director')
  or public.has_role('head_of_school')
  or public.has_role('curriculum_coordinator')
  or public.can_see_test(unit_test_id)
);


-- >>> END OF MIGRATION: 20260918000000_fix_admin_role_rls.sql <<<

-- >>> START OF MIGRATION: 20260918010000_add_exam_paper_to_unit_tests.sql <<<

-- ==============================================================================
-- Migration: Add Exam Paper Columns & Storage Bucket for Unit Tests
-- ==============================================================================

-- 1. Add exam paper columns to unit_tests
alter table public.unit_tests add column if not exists exam_paper_url text;
alter table public.unit_tests add column if not exists exam_paper_path text;
alter table public.unit_tests add column if not exists exam_paper_name text;

-- 2. Create storage bucket for exam papers
insert into storage.buckets (id, name, public)
values ('exam-papers', 'exam-papers', true)
on conflict (id) do update set public = true;

-- 3. Storage policies for exam-papers bucket
drop policy if exists "Allow authenticated to upload exam papers" on storage.objects;
create policy "Allow authenticated to upload exam papers" on storage.objects for insert to authenticated
with check (bucket_id = 'exam-papers');

drop policy if exists "Allow school members to read exam papers" on storage.objects;
create policy "Allow school members to read exam papers" on storage.objects for select to authenticated
using (bucket_id = 'exam-papers');

drop policy if exists "Allow teachers to update own exam papers" on storage.objects;
create policy "Allow teachers to update own exam papers" on storage.objects for update to authenticated
using (bucket_id = 'exam-papers');

drop policy if exists "Allow teachers to delete own exam papers" on storage.objects;
create policy "Allow teachers to delete own exam papers" on storage.objects for delete to authenticated
using (bucket_id = 'exam-papers');


-- >>> END OF MIGRATION: 20260918010000_add_exam_paper_to_unit_tests.sql <<<

-- >>> START OF MIGRATION: 20260918020000_fix_unit_tests_rls.sql <<<

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

-- >>> END OF MIGRATION: 20260918020000_fix_unit_tests_rls.sql <<<



-- >>> START OF MIGRATION: 20260918030000_restrict_unit_tests_delete_to_coordinators.sql <<<

-- ==============================================================================
-- Migration: Restrict Unit Tests Delete to Coordinators and Leadership
-- Teachers (except coordinators) cannot delete a test.
-- ==============================================================================

-- 1. Restrict unit_tests_delete to admin, head_of_school, and curriculum_coordinator
drop policy if exists unit_tests_delete on public.unit_tests;
create policy unit_tests_delete on public.unit_tests for delete using (
  class_id in (select c.id from public.classes c where c.school_id = public.my_school())
  and (
    public.has_role('admin')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
  )
);

-- 2. Restrict exam papers deletion to coordinators and leadership
drop policy if exists "Allow teachers to delete own exam papers" on storage.objects;
drop policy if exists "Allow authorized to delete exam papers" on storage.objects;
create policy "Allow authorized to delete exam papers" on storage.objects for delete to authenticated
using (
  bucket_id = 'exam-papers'
  and (
    public.has_role('admin')
    or public.has_role('head_of_school')
    or public.has_role('curriculum_coordinator')
  )
);

-- >>> END OF MIGRATION: 20260918030000_restrict_unit_tests_delete_to_coordinators.sql <<<
