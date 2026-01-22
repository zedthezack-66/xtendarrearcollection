-- Drop all functions that need return type changes
DROP FUNCTION IF EXISTS public.confirm_ticket_resolution(uuid);
DROP FUNCTION IF EXISTS public.reopen_ticket(uuid, numeric);
DROP FUNCTION IF EXISTS public.get_pending_confirmation_tickets(uuid);

-- Recreate confirm_ticket_resolution
CREATE OR REPLACE FUNCTION public.confirm_ticket_resolution(p_ticket_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket record;
  v_user_id uuid := auth.uid();
BEGIN
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id;
  
  IF v_ticket IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Ticket not found');
  END IF;

  IF NOT has_role(v_user_id, 'admin') AND v_ticket.assigned_agent != v_user_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF NOT v_ticket.arrears_cleared_pending_confirmation THEN
    RETURN json_build_object('success', false, 'error', 'Ticket is not pending confirmation');
  END IF;

  UPDATE tickets SET
    status = 'Resolved',
    arrears_cleared_pending_confirmation = false,
    resolved_date = now(),
    updated_at = now()
  WHERE id = p_ticket_id;

  UPDATE master_customers SET
    payment_status = 'Paid',
    outstanding_balance = 0,
    updated_at = now()
  WHERE id = v_ticket.master_customer_id;

  UPDATE agent_notifications SET is_read = true
  WHERE related_ticket_id = p_ticket_id AND type = 'arrears_cleared';

  RETURN json_build_object('success', true, 'message', 'Ticket resolved', 'ticket_id', p_ticket_id);
END;
$$;

-- Recreate reopen_ticket
CREATE OR REPLACE FUNCTION public.reopen_ticket(p_ticket_id uuid, p_new_amount_owed numeric DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket record;
  v_user_id uuid := auth.uid();
  v_new_amount numeric;
BEGIN
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id;
  
  IF v_ticket IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Ticket not found');
  END IF;

  IF NOT has_role(v_user_id, 'admin') AND v_ticket.assigned_agent != v_user_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  v_new_amount := COALESCE(p_new_amount_owed, v_ticket.amount_owed);

  UPDATE tickets SET
    status = CASE WHEN v_new_amount > 0 THEN 'In Progress' ELSE 'Open' END,
    arrears_cleared_pending_confirmation = false,
    amount_owed = v_new_amount,
    resolved_date = NULL,
    updated_at = now()
  WHERE id = p_ticket_id;

  UPDATE master_customers SET
    payment_status = 'Not Paid',
    outstanding_balance = v_new_amount,
    updated_at = now()
  WHERE id = v_ticket.master_customer_id;

  RETURN json_build_object('success', true, 'message', 'Ticket reopened', 'ticket_id', p_ticket_id);
END;
$$;

-- Recreate get_pending_confirmation_tickets
CREATE OR REPLACE FUNCTION public.get_pending_confirmation_tickets(p_agent_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT 
        t.id, t.customer_name, t.nrc_number, t.amount_owed, t.status,
        t.arrears_cleared_pending_confirmation, t.assigned_agent, t.created_at, t.updated_at,
        p.display_name as agent_name, mc.loan_book_arrears as previous_arrears
      FROM tickets t
      LEFT JOIN profiles p ON t.assigned_agent = p.id
      LEFT JOIN master_customers mc ON t.master_customer_id = mc.id
      WHERE t.arrears_cleared_pending_confirmation = true
        AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id)
      ORDER BY t.updated_at DESC
      LIMIT 100
    ) t
  );
END;
$$;