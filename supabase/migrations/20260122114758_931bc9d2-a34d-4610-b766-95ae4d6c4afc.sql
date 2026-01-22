-- Drop the function first to change return type
DROP FUNCTION IF EXISTS public.get_pending_confirmation_tickets(UUID);

-- Recreate get_pending_confirmation_tickets with correct return type
CREATE FUNCTION public.get_pending_confirmation_tickets(p_agent_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'customer_name', mc.customer_name,
      'nrc_number', mc.nrc_number,
      'amount_owed', t.amount_owed,
      'status', t.status,
      'arrears_cleared_pending_confirmation', t.arrears_cleared_pending_confirmation,
      'assigned_agent', t.assigned_agent,
      'agent_name', p.display_name,
      'previous_arrears', t.previous_arrears,
      'created_at', t.created_at,
      'updated_at', t.updated_at
    )
  ) INTO v_result
  FROM tickets t
  JOIN master_customers mc ON t.master_customer_id = mc.id
  LEFT JOIN profiles p ON t.assigned_agent = p.id
  WHERE t.arrears_cleared_pending_confirmation = TRUE
    AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id);
  
  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

-- Drop and recreate confirm_ticket_resolution
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
  v_customer_name TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;
  
  SELECT t.*, mc.customer_name INTO v_ticket
  FROM tickets t
  JOIN master_customers mc ON t.master_customer_id = mc.id
  WHERE t.id = p_ticket_id;
  
  IF v_ticket.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ticket not found');
  END IF;
  
  v_customer_name := v_ticket.customer_name;
  
  IF NOT COALESCE(v_ticket.arrears_cleared_pending_confirmation, FALSE) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ticket is not pending confirmation');
  END IF;
  
  IF NOT has_role(v_user_id, 'admin') THEN
    IF v_ticket.assigned_agent != v_user_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'You can only confirm tickets assigned to you');
    END IF;
  END IF;
  
  UPDATE tickets
  SET 
    status = 'Resolved',
    arrears_cleared_pending_confirmation = FALSE,
    resolved_date = NOW(),
    updated_at = NOW()
  WHERE id = p_ticket_id;
  
  RETURN jsonb_build_object('success', true, 'customer_name', v_customer_name);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Drop and recreate reopen_ticket
DROP FUNCTION IF EXISTS public.reopen_ticket(UUID, NUMERIC);

CREATE FUNCTION public.reopen_ticket(p_ticket_id UUID, p_new_amount_owed NUMERIC DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_ticket RECORD;
  v_customer_name TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;
  
  SELECT t.*, mc.customer_name INTO v_ticket
  FROM tickets t
  JOIN master_customers mc ON t.master_customer_id = mc.id
  WHERE t.id = p_ticket_id;
  
  IF v_ticket.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ticket not found');
  END IF;
  
  v_customer_name := v_ticket.customer_name;
  
  IF NOT has_role(v_user_id, 'admin') THEN
    IF v_ticket.assigned_agent != v_user_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'You can only reopen tickets assigned to you');
    END IF;
  END IF;
  
  UPDATE tickets
  SET 
    status = 'In Progress',
    arrears_cleared_pending_confirmation = FALSE,
    resolved_date = NULL,
    amount_owed = COALESCE(p_new_amount_owed, amount_owed),
    updated_at = NOW()
  WHERE id = p_ticket_id;
  
  RETURN jsonb_build_object('success', true, 'customer_name', v_customer_name);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;