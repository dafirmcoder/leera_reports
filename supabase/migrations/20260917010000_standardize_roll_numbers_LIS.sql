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
  -- Extract Year number or generic number
  yr := (regexp_match(p_class_name, 'Year\s*([0-9]+)', 'i'))[1];
  IF yr IS NULL THEN
    yr := (regexp_match(p_class_name, '([0-9]+)', 'i'))[1];
  END IF;

  -- Extract stream word after year number (ATLANTIC, PACIFIC, BLUE etc)
  stream := (regexp_match(p_class_name, '(?:Year\s*[0-9]+|[0-9]+)\s*[-–—:]?\s*([A-Za-z]+)', 'i'))[1];

  IF yr IS NOT NULL THEN
    IF stream IS NOT NULL THEN
      code := yr || upper(substr(stream, 1, 1));
    ELSE
      code := yr;
    END IF;
  ELSE
    -- If no numbers found, e.g. Reception, take first 3 letters
    code := upper(substring(regexp_replace(p_class_name, '[^A-Za-z]', '', 'g') from 1 for 3));
    IF code IS NULL OR code = '' THEN code := '0'; END IF;
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

-- 4. Standardize existing students' admission numbers per class with guaranteed uniqueness
DO $$
DECLARE
  r record;
  s_rec record;
  v_code text;
  v_suffix text;
  v_seq int;
  v_roll text;
BEGIN
  -- Temporarily clear admission_no to prevent unique violations
  UPDATE public.students SET admission_no = 'TEMP_' || id::text;

  FOR r IN SELECT id, name, school_id FROM public.classes ORDER BY name, created_at LOOP
    v_code := public.get_class_code(r.name);
    v_suffix := public.get_year_suffix(r.school_id);
    v_seq := 1;

    FOR s_rec IN 
      SELECT id FROM public.students 
      WHERE class_id = r.id 
      ORDER BY 
        COALESCE(NULLIF(regexp_replace(student_no, '[^0-9]', '', 'g'), '')::bigint, 999999),
        created_at,
        full_name,
        id
    LOOP
      LOOP
        v_roll := 'LIS-' || lpad(v_seq::text, 3, '0') || '/' || v_code || '/' || v_suffix;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.students WHERE admission_no = v_roll);
        v_seq := v_seq + 1;
      END LOOP;

      UPDATE public.students SET admission_no = v_roll WHERE id = s_rec.id;
      v_seq := v_seq + 1;
    END LOOP;
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
  c_code text;
  s_id uuid;
  y_suffix text;
  candidate text;
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

    SELECT public.get_class_code(name), school_id INTO c_code, s_id FROM public.classes WHERE id = NEW.class_id;
    y_suffix := public.get_year_suffix(s_id);

    LOOP
      candidate := 'LIS-' || lpad(seq::text, 3, '0') || '/' || c_code || '/' || y_suffix;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.students WHERE admission_no = candidate AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid));
      seq := seq + 1;
    END LOOP;

    NEW.admission_no := candidate;
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
  candidate text;
BEGIN
  IF p_class_id IS NULL THEN
    RETURN (SELECT (COALESCE(MAX(CASE WHEN admission_no ~* '^LIS-([0-9]{3})/' THEN (substring(admission_no from '^LIS-([0-9]{3})/'))::int END), 0) + 1)::text FROM public.students);
  END IF;

  SELECT COALESCE(MAX(CASE WHEN admission_no ~* '^LIS-([0-9]{3})/' THEN (substring(admission_no from '^LIS-([0-9]{3})/'))::int END), 0) + 1
  INTO next_seq
  FROM public.students
  WHERE class_id = p_class_id;

  LOOP
    candidate := public.generate_roll_no(p_class_id, next_seq);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.students WHERE admission_no = candidate);
    next_seq := next_seq + 1;
  END LOOP;

  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_roll_no(p_class_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.next_admission_no(p_class_id);
$$;
