-- RPC to safely delete a team member (admin only)
-- Checks if user owns data and blocks if they have assigned tickets/customers
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_admin boolean;
  v_has_assigned_tickets integer;
  v_has_assigned_customers integer;
  v_profile_name text;
BEGIN
  -- Check if current user is admin
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);
  
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can delete users';
  END IF;
  
  -- Prevent self-deletion
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot delete yourself';
  END IF;
  
  -- Get the profile name for reference
  SELECT full_name INTO v_profile_name FROM profiles WHERE id = p_user_id;
  
  IF v_profile_name IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  
  -- Check if user has assigned tickets
  SELECT COUNT(*) INTO v_has_assigned_tickets 
  FROM tickets WHERE assigned_agent = p_user_id;
  
  -- Check if user has assigned customers
  SELECT COUNT(*) INTO v_has_assigned_customers 
  FROM master_customers WHERE assigned_agent = p_user_id;
  
  IF v_has_assigned_tickets > 0 OR v_has_assigned_customers > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'blocked', true,
      'reason', format('User has %s assigned tickets and %s assigned customers. Reassign before deletion.', 
        v_has_assigned_tickets, v_has_assigned_customers),
      'assigned_tickets', v_has_assigned_tickets,
      'assigned_customers', v_has_assigned_customers
    );
  END IF;
  
  -- Delete user_roles entry
  DELETE FROM user_roles WHERE user_id = p_user_id;
  
  -- Delete profile (this won't delete auth.users but removes their profile)
  DELETE FROM profiles WHERE id = p_user_id;
  
  -- Note: Cannot delete from auth.users via SQL directly
  -- The profile deletion effectively disables the user
  
  RETURN jsonb_build_object(
    'success', true,
    'deleted_user', v_profile_name,
    'user_id', p_user_id
  );
END;
$$;

-- Add index on tickets.amount_owed for efficient sorting
CREATE INDEX IF NOT EXISTS idx_tickets_amount_owed ON tickets(amount_owed DESC);

-- Add composite index for sorted ticket queries with agent filter
CREATE INDEX IF NOT EXISTS idx_tickets_agent_amount ON tickets(assigned_agent, amount_owed DESC);

-- Add composite index for batch + amount sorting
CREATE INDEX IF NOT EXISTS idx_tickets_batch_amount ON tickets(batch_id, amount_owed DESC);