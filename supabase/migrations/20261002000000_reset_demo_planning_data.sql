-- Migration: 20261002000000_reset_demo_planning_data.sql
-- Description: RPC function to purge all demo planning data (timetables, work plans, lesson plans, curriculum schemes)

CREATE OR REPLACE FUNCTION reset_demo_planning_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_caller_additional text[];
  v_is_authorized boolean := false;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, additional_roles
  INTO v_caller_role, v_caller_additional
  FROM public.profiles
  WHERE id = v_caller_id;

  -- Authorize: Head of School, Curriculum Coordinator, Director, Admin
  IF v_caller_role IN ('head_of_school', 'curriculum_coordinator', 'admin', 'director')
     OR (v_caller_additional IS NOT NULL AND 'curriculum_coordinator' = ANY(v_caller_additional)) THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Only Leadership, Head of School, and Curriculum Coordinators can reset planning data.';
  END IF;

  -- Truncate / delete all planning & curriculum tables with cascade
  TRUNCATE TABLE 
    public.lesson_plan_events,
    public.lesson_plan_objectives,
    public.lesson_plans,
    public.work_plan_events,
    public.work_plan_week_objectives,
    public.work_plan_weeks,
    public.work_plans,
    public.teacher_schedule_slots,
    public.teacher_timetables,
    public.curriculum_objectives,
    public.curriculum_topics,
    public.curriculum_schemes
  CASCADE;

  RETURN jsonb_build_object(
    'ok', true,
    'message', 'All demo timetables, work plans, lesson plans, and curriculum schemes have been permanently purged.'
  );
END;
$$;
