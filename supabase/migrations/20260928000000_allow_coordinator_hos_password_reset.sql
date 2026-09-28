-- Migration: 20260928000000_allow_coordinator_hos_password_reset.sql
-- Description: Allow Head of School and Curriculum Coordinators to reset any user's password back to default (00123456)

CREATE OR REPLACE FUNCTION reset_user_password_to_default(target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_caller_additional text[];
  v_caller_school uuid;
  v_target_school uuid;
  v_target_name text;
  v_target_email text;
  v_is_authorized boolean := false;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, additional_roles, school_id
  INTO v_caller_role, v_caller_additional, v_caller_school
  FROM public.profiles
  WHERE id = v_caller_id;

  -- Authorize: Head of School, Curriculum Coordinator, Director, Admin
  IF v_caller_role IN ('head_of_school', 'curriculum_coordinator', 'admin', 'director')
     OR (v_caller_additional IS NOT NULL AND 'curriculum_coordinator' = ANY(v_caller_additional)) THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Only Head of School and Curriculum Coordinators can reset passwords.';
  END IF;

  SELECT school_id, full_name, email
  INTO v_target_school, v_target_name, v_target_email
  FROM public.profiles
  WHERE id = target_user_id;

  IF v_target_school IS NULL OR (v_caller_school IS NOT NULL AND v_target_school <> v_caller_school) THEN
    RAISE EXCEPTION 'Target user not found or not in your school.';
  END IF;

  -- Reset password in auth.users to default '00123456' using bcrypt hash
  UPDATE auth.users
  SET encrypted_password = crypt('00123456', gen_salt('bf')),
      updated_at = now()
  WHERE id = target_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'message', format('Password for %s has been reset to default (00123456).', coalesce(v_target_name, v_target_email, 'user'))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION reset_user_password_to_default(uuid) TO authenticated;
