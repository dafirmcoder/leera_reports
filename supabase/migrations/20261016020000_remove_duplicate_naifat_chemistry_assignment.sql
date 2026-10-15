-- ==============================================================================
-- Migration: 20261016020000_remove_duplicate_naifat_chemistry_assignment.sql
-- Purpose: Remove accidental duplicate assignment of Naifat Mhammed Said to Year 8 Chemistry.
--          Chemistry in Year 8 is solely taught by Raudhwat Yussuf Maalim.
-- ==============================================================================

DELETE FROM public.class_subject_teachers
WHERE id = 'f4c491fe-227a-4c25-a4f6-8c78b1a92b64'
   OR (
     class_id = 'd1094362-eb0c-41af-8010-bafd9fa7500e'
     AND subject_id = '3759ac09-e582-474b-992c-8cb7cf80a8e8'
     AND teacher_id = '505cc4a7-fcc1-4aed-b450-2c24a3e41dfa'
   );
