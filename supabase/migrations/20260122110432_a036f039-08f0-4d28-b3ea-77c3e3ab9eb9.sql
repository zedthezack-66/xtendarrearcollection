-- Drop and recreate confirm_ticket_resolution with updated logic
DROP FUNCTION IF EXISTS public.confirm_ticket_resolution(UUID);

CREATE FUNCTION public.confirm_ticket_resolution(p_ticket_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_ticket RECORD;
BEGIN
  -- Validate user
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;
  
  -- Get ticket
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id;
  
  IF v_ticket.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ticket not found');
  END IF;
  
  -- Check if ticket has pending confirmation flag
  IF NOT COALESCE(v_ticket.arrears_cleared_pending_confirmation, FALSE) THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Ticket is not pending confirmation. Current status: ' || v_ticket.status || 
               ', Pending flag: ' || COALESCE(v_ticket.arrears_cleared_pending_confirmation::TEXT, 'false')
    );
  END IF;
  
  -- Check permissions (admin or assigned agent)
  IF NOT has_role(v_user_id, 'admin') THEN
    IF v_ticket.assigned_agent != v_user_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'You can only confirm tickets assigned to you');
    END IF;
  END IF;
  
  -- Resolve the ticket
  UPDATE tickets
  SET 
    status = 'Resolved',
    arrears_cleared_pending_confirmation = FALSE,
    resolved_date = NOW(),
    updated_at = NOW()
  WHERE id = p_ticket_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Ticket resolved successfully',
    'ticket_id', p_ticket_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;