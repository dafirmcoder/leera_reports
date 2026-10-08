-- Migration: Create student_subject_allocations table
-- Enables elective and selective subject allocation for students in Year 10 and above

CREATE TABLE IF NOT EXISTS public.student_subject_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_student_subject_allocations_class ON public.student_subject_allocations(class_id);
CREATE INDEX IF NOT EXISTS idx_student_subject_allocations_student ON public.student_subject_allocations(student_id);

ALTER TABLE public.student_subject_allocations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_subject_allocations' AND policyname = 'Allow read student_subject_allocations'
  ) THEN
    CREATE POLICY "Allow read student_subject_allocations" ON public.student_subject_allocations FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_subject_allocations' AND policyname = 'Allow insert student_subject_allocations'
  ) THEN
    CREATE POLICY "Allow insert student_subject_allocations" ON public.student_subject_allocations FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_subject_allocations' AND policyname = 'Allow update student_subject_allocations'
  ) THEN
    CREATE POLICY "Allow update student_subject_allocations" ON public.student_subject_allocations FOR UPDATE USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_subject_allocations' AND policyname = 'Allow delete student_subject_allocations'
  ) THEN
    CREATE POLICY "Allow delete student_subject_allocations" ON public.student_subject_allocations FOR DELETE USING (true);
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
