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
  candidate text;
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

    LOOP
      candidate := public.generate_roll_no(NEW.class_id, seq);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.students WHERE roll_no = candidate AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid));
      seq := seq + 1;
    END LOOP;

    NEW.roll_no := candidate;
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
  candidate text;
BEGIN
  IF p_class_id IS NULL THEN
    RETURN (SELECT (COALESCE(MAX(CASE WHEN roll_no ~* '^LIS-([0-9]{3})/' THEN (substring(roll_no from '^LIS-([0-9]{3})/'))::int END), 0) + 1)::text FROM public.students);
  END IF;

  SELECT COALESCE(MAX(CASE WHEN roll_no ~* '^LIS-([0-9]{3})/' THEN (substring(roll_no from '^LIS-([0-9]{3})/'))::int END), 0) + 1
  INTO next_seq
  FROM public.students
  WHERE class_id = p_class_id;

  LOOP
    candidate := public.generate_roll_no(p_class_id, next_seq);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.students WHERE roll_no = candidate);
    next_seq := next_seq + 1;
  END LOOP;

  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_roll_no(p_class_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.next_admission_no(p_class_id);
$$;

-- 6. Add documentation comments
COMMENT ON COLUMN public.schools.semester IS 'Formerly term, now semester';
COMMENT ON COLUMN public.students.roll_no IS 'Formerly admission_no, format LIS-001/9P/26';
