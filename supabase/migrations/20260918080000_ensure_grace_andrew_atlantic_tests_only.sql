-- ==============================================================================
-- Migration: 20260918080000_ensure_grace_andrew_atlantic_tests_only.sql
-- Purpose: Strictly restrict tests and assignments for Teacher Grace Andrew
--          to the Atlantic stream classes (Year 5 - Atlantic, Year 6 - Atlantic, Year 8 - Atlantic).
-- ==============================================================================

DO $$
DECLARE
  v_teacher_id uuid := 'd6e2754a-2594-4f1b-9d56-3eced8c090cb';
  v_y5_atlantic_id uuid;
  v_y6_atlantic_id uuid;
  v_y8_atlantic_id uuid;
  v_english_id uuid;
  v_geography_id uuid;
BEGIN
  -- Resolve teacher id fallback if needed
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_teacher_id) THEN
    SELECT id INTO v_teacher_id FROM public.profiles WHERE lower(full_name) LIKE '%grace%andrew%' LIMIT 1;
  END IF;

  -- 1. Ensure teacher has subject_teacher role
  UPDATE public.profiles
  SET additional_roles = CASE
    WHEN additional_roles IS NULL OR additional_roles = '{}' THEN ARRAY['subject_teacher']::text[]
    WHEN NOT ('subject_teacher' = ANY(additional_roles)) THEN array_append(additional_roles, 'subject_teacher')
    ELSE additional_roles
  END
  WHERE id = v_teacher_id;

  -- 2. Identify target class and subject IDs
  SELECT id INTO v_y5_atlantic_id FROM public.classes WHERE name ILIKE 'year 5%atlantic%' LIMIT 1;
  SELECT id INTO v_y6_atlantic_id FROM public.classes WHERE name ILIKE 'year 6%atlantic%' LIMIT 1;
  SELECT id INTO v_y8_atlantic_id FROM public.classes WHERE name ILIKE 'year 8%atlantic%' LIMIT 1;

  SELECT id INTO v_english_id FROM public.subjects WHERE lower(trim(name)) = 'english' LIMIT 1;
  SELECT id INTO v_geography_id FROM public.subjects WHERE lower(trim(name)) = 'geography' LIMIT 1;

  -- 3. Delete any unit tests created by Grace Andrew for NON-Atlantic classes
  DELETE FROM public.scores
  WHERE unit_test_id IN (
    SELECT ut.id FROM public.unit_tests ut
    JOIN public.classes c ON c.id = ut.class_id
    WHERE ut.created_by = v_teacher_id
      AND c.name NOT ILIKE '%atlantic%'
  );

  DELETE FROM public.unit_tests
  WHERE created_by = v_teacher_id
    AND class_id IN (
      SELECT id FROM public.classes WHERE name NOT ILIKE '%atlantic%'
    );

  -- 4. Delete non-Atlantic class_subject_teachers assignments for Grace Andrew in Years 5, 6, 8
  DELETE FROM public.class_subject_teachers
  WHERE teacher_id = v_teacher_id
    AND class_id IN (
      SELECT id FROM public.classes
      WHERE name NOT ILIKE '%atlantic%'
        AND (name ILIKE '%year 5%' OR name ILIKE '%year 6%' OR name ILIKE '%year 8%')
    );

  -- 5. Ensure class_subject_teachers assignments exist for the Atlantic classes
  IF v_y5_atlantic_id IS NOT NULL AND v_english_id IS NOT NULL THEN
    INSERT INTO public.class_subject_teachers (class_id, subject_id, teacher_id)
    VALUES (v_y5_atlantic_id, v_english_id, v_teacher_id)
    ON CONFLICT (class_id, subject_id, teacher_id) DO NOTHING;
  END IF;

  IF v_y6_atlantic_id IS NOT NULL AND v_english_id IS NOT NULL THEN
    INSERT INTO public.class_subject_teachers (class_id, subject_id, teacher_id)
    VALUES (v_y6_atlantic_id, v_english_id, v_teacher_id)
    ON CONFLICT (class_id, subject_id, teacher_id) DO NOTHING;
  END IF;

  IF v_y8_atlantic_id IS NOT NULL AND v_english_id IS NOT NULL THEN
    INSERT INTO public.class_subject_teachers (class_id, subject_id, teacher_id)
    VALUES (v_y8_atlantic_id, v_english_id, v_teacher_id)
    ON CONFLICT (class_id, subject_id, teacher_id) DO NOTHING;
  END IF;

  IF v_y8_atlantic_id IS NOT NULL AND v_geography_id IS NOT NULL THEN
    INSERT INTO public.class_subject_teachers (class_id, subject_id, teacher_id)
    VALUES (v_y8_atlantic_id, v_geography_id, v_teacher_id)
    ON CONFLICT (class_id, subject_id, teacher_id) DO NOTHING;
  END IF;

  -- 6. Ensure the 4 End of Unit Tests exist for Atlantic classes
  -- 1) Year 5 - Atlantic: English
  IF v_y5_atlantic_id IS NOT NULL AND v_english_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.unit_tests
      WHERE class_id = v_y5_atlantic_id AND subject_id = v_english_id AND created_by = v_teacher_id
    ) THEN
      INSERT INTO public.unit_tests (class_id, subject_id, created_by, title, test_date, max_mark)
      VALUES (v_y5_atlantic_id, v_english_id, v_teacher_id, 'Unit 1: English Assessment', CURRENT_DATE, 100);
    END IF;
  END IF;

  -- 2) Year 6 - Atlantic: English
  IF v_y6_atlantic_id IS NOT NULL AND v_english_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.unit_tests
      WHERE class_id = v_y6_atlantic_id AND subject_id = v_english_id AND created_by = v_teacher_id
    ) THEN
      INSERT INTO public.unit_tests (class_id, subject_id, created_by, title, test_date, max_mark)
      VALUES (v_y6_atlantic_id, v_english_id, v_teacher_id, 'Unit 1: English Assessment', CURRENT_DATE, 100);
    END IF;
  END IF;

  -- 3) Year 8 - Atlantic: English
  IF v_y8_atlantic_id IS NOT NULL AND v_english_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.unit_tests
      WHERE class_id = v_y8_atlantic_id AND subject_id = v_english_id AND created_by = v_teacher_id
    ) THEN
      INSERT INTO public.unit_tests (class_id, subject_id, created_by, title, test_date, max_mark)
      VALUES (v_y8_atlantic_id, v_english_id, v_teacher_id, 'Unit 1: English Assessment', CURRENT_DATE, 100);
    END IF;
  END IF;

  -- 4) Year 8 - Atlantic: Geography
  IF v_y8_atlantic_id IS NOT NULL AND v_geography_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.unit_tests
      WHERE class_id = v_y8_atlantic_id AND subject_id = v_geography_id AND created_by = v_teacher_id
    ) THEN
      INSERT INTO public.unit_tests (class_id, subject_id, created_by, title, test_date, max_mark)
      VALUES (v_y8_atlantic_id, v_geography_id, v_teacher_id, 'Unit 1: Geography Assessment', CURRENT_DATE, 100);
    END IF;
  END IF;

  -- 7. Initialize score records for enrolled students (default NULL score)
  INSERT INTO public.scores (unit_test_id, student_id, score)
  SELECT ut.id, s.id, NULL
  FROM public.unit_tests ut
  JOIN public.students s ON s.class_id = ut.class_id
  WHERE ut.created_by = v_teacher_id
    AND ut.class_id IN (v_y5_atlantic_id, v_y6_atlantic_id, v_y8_atlantic_id)
  ON CONFLICT (unit_test_id, student_id) DO NOTHING;

END $$;

-- 8. Verification query
SELECT
  c.name AS class_name,
  s.name AS subject_name,
  p.full_name AS teacher_name,
  ut.title AS test_title,
  ut.max_mark,
  ut.test_date,
  (SELECT COUNT(*) FROM public.scores sc WHERE sc.unit_test_id = ut.id) AS student_score_slots
FROM public.unit_tests ut
JOIN public.classes c ON c.id = ut.class_id
JOIN public.subjects s ON s.id = ut.subject_id
JOIN public.profiles p ON p.id = ut.created_by
WHERE ut.created_by = 'd6e2754a-2594-4f1b-9d56-3eced8c090cb'
   OR lower(p.full_name) LIKE '%grace%andrew%'
ORDER BY c.name, s.name;
