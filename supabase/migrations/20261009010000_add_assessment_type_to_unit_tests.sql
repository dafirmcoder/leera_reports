-- Migration: Add assessment_type column to unit_tests table
-- Supports distinguishing between 'unit_test' (End of Unit Test) and 'midterm' (Midterm Exam)

ALTER TABLE unit_tests
ADD COLUMN IF NOT EXISTS assessment_type TEXT NOT NULL DEFAULT 'unit_test';

COMMENT ON COLUMN unit_tests.assessment_type IS 'Assessment type: unit_test (End of Unit Test) or midterm (Midterm Exam)';

-- Index to optimize querying assessments by class and assessment_type
CREATE INDEX IF NOT EXISTS idx_unit_tests_assessment_type ON unit_tests (class_id, assessment_type);
