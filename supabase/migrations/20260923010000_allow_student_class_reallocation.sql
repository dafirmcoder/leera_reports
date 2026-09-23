-- ==============================================================================
-- Migration: Allow Student Reallocation Between Classes for HOS and Coordinators
-- ==============================================================================

-- 1. Update RLS policies on public.students to allow HOS and Curriculum Coordinators to update (reallocate) and insert students
DROP POLICY IF EXISTS students_update ON public.students;
CREATE POLICY students_update ON public.students FOR UPDATE
  USING (
    class_id IN (SELECT c.id FROM public.classes c WHERE c.school_id = public.my_school()) AND (
      public.has_role('head_of_school') OR
      public.has_role('curriculum_coordinator') OR
      public.has_role('admin') OR
      (public.has_role('homeroom_teacher') AND class_id = public.my_class())
    )
  )
  WITH CHECK (
    class_id IN (SELECT c.id FROM public.classes c WHERE c.school_id = public.my_school()) AND (
      public.has_role('head_of_school') OR
      public.has_role('curriculum_coordinator') OR
      public.has_role('admin') OR
      (public.has_role('homeroom_teacher') AND class_id = public.my_class())
    )
  );

DROP POLICY IF EXISTS students_insert ON public.students;
CREATE POLICY students_insert ON public.students FOR INSERT
  WITH CHECK (
    class_id IN (SELECT c.id FROM public.classes c WHERE c.school_id = public.my_school()) AND (
      public.has_role('head_of_school') OR
      public.has_role('curriculum_coordinator') OR
      public.has_role('admin') OR
      (public.has_role('homeroom_teacher') AND class_id = public.my_class())
    )
  );

-- 2. Update trigger function to handle class_id transfers smoothly without unique (class_id, student_no) collisions
CREATE OR REPLACE FUNCTION public.enforce_student_serial_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  next_seq bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.class_id IS DISTINCT FROM OLD.class_id THEN
      -- If re-allocating to another class, ensure student_no does not collide in new class
      IF EXISTS (SELECT 1 FROM public.students WHERE class_id = NEW.class_id AND student_no = OLD.student_no AND id <> NEW.id) THEN
        SELECT COALESCE(MAX(NULLIF(student_no, '')::bigint), 0) + 1 INTO next_seq
        FROM public.students WHERE class_id = NEW.class_id;
        NEW.student_no := next_seq::text;
      ELSE
        NEW.student_no := OLD.student_no;
      END IF;
    ELSE
      IF OLD.student_no IS NOT NULL AND OLD.student_no <> '' THEN
        NEW.student_no := OLD.student_no;
      END IF;
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
