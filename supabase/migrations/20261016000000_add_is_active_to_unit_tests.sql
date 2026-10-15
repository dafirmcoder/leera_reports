-- Migration: Add is_active column to unit_tests table
-- Tests are created inactive (is_active = false) until the first score is entered.
-- This makes determining active/administered tests simpler and faster across the system.

ALTER TABLE unit_tests
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN unit_tests.is_active IS 'Active status: false upon creation, becomes true once at least one student mark is entered';

-- Backfill existing tests: if a test already has at least one recorded score, set is_active = true
UPDATE unit_tests ut
SET is_active = true
WHERE EXISTS (
  SELECT 1 FROM scores s
  WHERE s.unit_test_id = ut.id
    AND s.score IS NOT NULL
);

-- Index to optimize querying active unit tests by class
CREATE INDEX IF NOT EXISTS idx_unit_tests_is_active ON unit_tests (class_id, is_active);

-- Trigger function: Automatically update unit_tests.is_active when scores are entered/updated/deleted
CREATE OR REPLACE FUNCTION update_unit_test_is_active()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    IF NEW.score IS NOT NULL THEN
      UPDATE unit_tests
      SET is_active = true
      WHERE id = NEW.unit_test_id AND is_active = false;
    ELSE
      -- Score was set to NULL; check if ANY score remains non-null
      IF NOT EXISTS (
        SELECT 1 FROM scores
        WHERE unit_test_id = NEW.unit_test_id AND score IS NOT NULL AND id <> NEW.id
      ) THEN
        UPDATE unit_tests
        SET is_active = false
        WHERE id = NEW.unit_test_id AND is_active = true;
      END IF;
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    IF NOT EXISTS (
      SELECT 1 FROM scores
      WHERE unit_test_id = OLD.unit_test_id AND score IS NOT NULL AND id <> OLD.id
    ) THEN
      UPDATE unit_tests
      SET is_active = false
      WHERE id = OLD.unit_test_id AND is_active = true;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_unit_test_is_active ON scores;
CREATE TRIGGER trg_update_unit_test_is_active
AFTER INSERT OR UPDATE OF score OR DELETE ON scores
FOR EACH ROW
EXECUTE FUNCTION update_unit_test_is_active();
