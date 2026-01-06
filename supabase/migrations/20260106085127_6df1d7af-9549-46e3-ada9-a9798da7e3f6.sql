-- RPC for admin to promote/demote users between AGENT and ADMIN
CREATE OR REPLACE FUNCTION public.update_user_role(
  p_target_user_id uuid,
  p_new_role app_role
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_admin boolean;
  v_current_role app_role;
BEGIN
  -- Check if current user is admin
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);
  
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can change user roles';
  END IF;
  
  -- Prevent self-demotion (admin can't demote themselves)
  IF p_target_user_id = auth.uid() AND p_new_role = 'agent' THEN
    RAISE EXCEPTION 'You cannot demote yourself';
  END IF;
  
  -- Get current role
  SELECT role INTO v_current_role 
  FROM user_roles 
  WHERE user_id = p_target_user_id;
  
  IF v_current_role IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  
  -- Update the role
  UPDATE user_roles 
  SET role = p_new_role 
  WHERE user_id = p_target_user_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_target_user_id,
    'old_role', v_current_role,
    'new_role', p_new_role
  );
END;
$$;