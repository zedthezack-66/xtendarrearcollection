-- Fix the reopen_ticket function - use correct column names
CREATE OR REPLACE FUNCTION public.reopen_ticket(p_ticket_id UUID, p_new_amount_owed NUMERIC DEFAULT NULL)
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
  
  -- Get ticket data - customer_name is on the tickets table itself
  SELECT * INTO v_ticket
  FROM tickets
  WHERE id = p_ticket_id;
  
  IF v_ticket.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ticket not found');
  END IF;
  
  -- customer_name is stored directly on tickets table
  v_customer_name := v_ticket.customer_name;
  
  -- Permission check
  IF NOT has_role(v_user_id, 'admin') THEN
    IF v_ticket.assigned_agent != v_user_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'You can only reopen tickets assigned to you');
    END IF;
  END IF;
  
  -- Update ticket status
  UPDATE tickets
  SET 
    status = 'In Progress',
    resolved_date = NULL,
    amount_owed = COALESCE(p_new_amount_owed, amount_owed),
    updated_at = NOW()
  WHERE id = p_ticket_id;
  
  RETURN jsonb_build_object('success', true, 'customer_name', v_customer_name);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;