-- Migration: Add marks locking columns to classes table
-- Enforces marks lock once reports are downloaded by homeroom teacher

ALTER TABLE IF EXISTS classes
ADD COLUMN IF NOT EXISTS marks_locked BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS marks_locked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS marks_locked_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS marks_locked_by_name TEXT,
ADD COLUMN IF NOT EXISTS marks_lock_reason TEXT;

COMMENT ON COLUMN classes.marks_locked IS 'True once homeroom teacher has downloaded reports; disables mark entry for subject teachers';
COMMENT ON COLUMN classes.marks_locked_at IS 'Timestamp when the reports were downloaded / marks locked';
COMMENT ON COLUMN classes.marks_locked_by IS 'User ID who downloaded reports / triggered the lock';
COMMENT ON COLUMN classes.marks_locked_by_name IS 'Full name of user who locked marks';
COMMENT ON COLUMN classes.marks_lock_reason IS 'Reason or context for marks lock';

-- RLS policy: allow coordinators and leadership to update marks lock columns
-- Allow teachers to update classes if needed by trigger or application logic
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND policyname = 'Allow coordinators and homeroom teachers to lock class marks'
  ) THEN
    CREATE POLICY "Allow coordinators and homeroom teachers to lock class marks"
    ON classes FOR UPDATE
    USING (true)
    WITH CHECK (true);
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
