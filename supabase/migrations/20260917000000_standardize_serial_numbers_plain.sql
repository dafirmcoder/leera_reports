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
