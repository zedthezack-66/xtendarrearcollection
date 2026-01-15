-- Fix get_dashboard_stats to calculate outstanding balance dynamically from tickets
-- Outstanding = SUM(amount_owed) - SUM(payments)
CREATE OR REPLACE FUNCTION get_dashboard_stats(p_agent_id uuid DEFAULT NULL, p_batch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_result jsonb;
  v_total_customers integer;
  v_total_owed numeric;
  v_total_collected numeric;
  v_total_outstanding numeric;
  v_open_tickets integer;
  v_in_progress_tickets integer;
  v_resolved_tickets integer;
BEGIN
  -- Check if current user is admin
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);
  
  -- If not admin, force agent_id to be current user
  IF NOT v_is_admin THEN
    p_agent_id := auth.uid();
  END IF;

  -- Calculate stats from tickets + payments dynamically (most accurate)
  IF p_batch_id IS NOT NULL THEN
    -- Batch-specific stats
    SELECT 
      COUNT(DISTINCT t.master_customer_id),
      COALESCE(SUM(t.amount_owed), 0),
      COALESCE((
        SELECT SUM(p.amount)
        FROM payments p
        JOIN tickets t2 ON p.ticket_id = t2.id
        WHERE t2.batch_id = p_batch_id
          AND (p_agent_id IS NULL OR t2.assigned_agent = p_agent_id)
      ), 0)
    INTO v_total_customers, v_total_owed, v_total_collected
    FROM tickets t
    WHERE t.batch_id = p_batch_id
      AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id);
  ELSE
    -- Global stats - calculate dynamically from tickets and payments
    WITH ticket_payments AS (
      SELECT 
        t.master_customer_id,
        t.amount_owed,
        COALESCE(SUM(p.amount), 0) AS total_paid
      FROM tickets t
      LEFT JOIN payments p ON p.ticket_id = t.id
      WHERE (p_agent_id IS NULL OR t.assigned_agent = p_agent_id)
      GROUP BY t.id, t.master_customer_id, t.amount_owed
    )
    SELECT 
      COUNT(DISTINCT master_customer_id),
      COALESCE(SUM(amount_owed), 0),
      COALESCE(SUM(total_paid), 0)
    INTO v_total_customers, v_total_owed, v_total_collected
    FROM ticket_payments;
  END IF;

  -- Outstanding = Total Owed - Total Collected (never negative)
  v_total_outstanding := GREATEST(v_total_owed - v_total_collected, 0);

  -- Get ticket stats
  IF p_batch_id IS NOT NULL THEN
    SELECT 
      COUNT(*) FILTER (WHERE status = 'Open'),
      COUNT(*) FILTER (WHERE status = 'In Progress'),
      COUNT(*) FILTER (WHERE status = 'Resolved')
    INTO v_open_tickets, v_in_progress_tickets, v_resolved_tickets
    FROM tickets
    WHERE batch_id = p_batch_id
      AND (p_agent_id IS NULL OR assigned_agent = p_agent_id);
  ELSE
    SELECT 
      COUNT(*) FILTER (WHERE status = 'Open'),
      COUNT(*) FILTER (WHERE status = 'In Progress'),
      COUNT(*) FILTER (WHERE status = 'Resolved')
    INTO v_open_tickets, v_in_progress_tickets, v_resolved_tickets
    FROM tickets
    WHERE (p_agent_id IS NULL OR assigned_agent = p_agent_id);
  END IF;

  v_result := jsonb_build_object(
    'total_customers', v_total_customers,
    'total_outstanding', v_total_outstanding,
    'total_collected', v_total_collected,
    'collection_rate', CASE WHEN v_total_owed > 0 
      THEN ROUND((v_total_collected / v_total_owed) * 100, 1) 
      ELSE 0 END,
    'open_tickets', v_open_tickets,
    'in_progress_tickets', v_in_progress_tickets,
    'resolved_tickets', v_resolved_tickets
  );

  RETURN v_result;
END;
$$;

-- Fix get_admin_agent_analytics to use In Progress + Resolved as interaction_count
CREATE OR REPLACE FUNCTION get_admin_agent_analytics(
  p_agent_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Check if caller is admin
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can access this function';
  END IF;
  
  WITH ticket_data AS (
    SELECT 
      t.assigned_agent,
      t.amount_owed,
      t.status,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.ticket_id = t.id), 0) AS paid
    FROM tickets t
    WHERE (p_agent_id IS NULL OR t.assigned_agent = p_agent_id)
  ),
  agent_stats AS (
    SELECT 
      pr.id AS agent_id,
      COALESCE(pr.display_name, pr.full_name) AS agent_name,
      (SELECT COUNT(*) FROM tickets t WHERE t.assigned_agent = pr.id 
        AND (p_agent_id IS NULL OR pr.id = p_agent_id)) AS total_tickets,
      (SELECT COALESCE(SUM(t.amount_owed), 0) FROM tickets t 
        WHERE t.assigned_agent = pr.id 
        AND (p_agent_id IS NULL OR pr.id = p_agent_id)) AS total_owed,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p 
        WHERE p.recorded_by = pr.id 
        AND (p_agent_id IS NULL OR pr.id = p_agent_id)) AS total_collected,
      -- Interactions = In Progress + Resolved tickets (not call_logs count)
      (SELECT COUNT(*) FROM tickets t 
        WHERE t.assigned_agent = pr.id 
        AND t.status IN ('In Progress', 'Resolved')
        AND (p_agent_id IS NULL OR pr.id = p_agent_id)) AS interaction_count
    FROM profiles pr
    WHERE (p_agent_id IS NULL OR pr.id = p_agent_id)
  )
  SELECT json_build_object(
    'agents', (
      SELECT json_agg(json_build_object(
        'agent_id', agent_id,
        'agent_name', agent_name,
        'total_tickets', total_tickets,
        'total_owed', total_owed,
        'total_collected', total_collected,
        'outstanding_balance', GREATEST(total_owed - total_collected, 0),
        'collection_rate', CASE WHEN total_owed > 0 
          THEN ROUND((total_collected::NUMERIC / total_owed::NUMERIC) * 100, 2) 
          ELSE 0 
        END,
        'interaction_count', interaction_count
      ))
      FROM agent_stats
      WHERE total_tickets > 0 OR interaction_count > 0
    ),
    'totals', (
      SELECT json_build_object(
        'total_tickets', COALESCE(SUM(total_tickets), 0),
        'total_owed', COALESCE(SUM(total_owed), 0),
        'total_collected', COALESCE(SUM(total_collected), 0),
        'outstanding_balance', COALESCE(SUM(GREATEST(total_owed - total_collected, 0)), 0),
        'total_interactions', COALESCE(SUM(interaction_count), 0)
      )
      FROM agent_stats
    )
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;

-- Fix get_interaction_analytics to use In Progress + Resolved as interactions
CREATE OR REPLACE FUNCTION get_interaction_analytics(
  p_agent_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_start_date TIMESTAMP WITH TIME ZONE;
  v_end_date TIMESTAMP WITH TIME ZONE;
BEGIN
  v_start_date := COALESCE(p_start_date::TIMESTAMP WITH TIME ZONE, NOW() - INTERVAL '7 days');
  v_end_date := COALESCE(p_end_date::TIMESTAMP WITH TIME ZONE, NOW());
  
  WITH agent_stats AS (
    SELECT 
      pr.id AS agent_id,
      pr.display_name,
      pr.full_name,
      -- In Progress tickets for this agent
      (SELECT COUNT(*) FROM tickets t 
        WHERE t.assigned_agent = pr.id 
        AND t.status = 'In Progress') AS in_progress_tickets,
      -- Resolved tickets for this agent
      (SELECT COUNT(*) FROM tickets t 
        WHERE t.assigned_agent = pr.id 
        AND t.status = 'Resolved') AS tickets_resolved,
      -- Collection amount
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p 
        WHERE p.recorded_by = pr.id 
        AND p.created_at >= v_start_date AND p.created_at <= v_end_date) AS collected_amount
    FROM profiles pr
    WHERE (p_agent_id IS NULL OR pr.id = p_agent_id)
  )
  SELECT json_build_object(
    'total_interactions', (SELECT COALESCE(SUM(in_progress_tickets + tickets_resolved), 0) FROM agent_stats),
    'total_tickets_resolved', (SELECT COALESCE(SUM(tickets_resolved), 0) FROM agent_stats),
    'total_collected', (SELECT COALESCE(SUM(collected_amount), 0) FROM agent_stats),
    'by_agent', (
      SELECT json_agg(json_build_object(
        'agent_id', agent_id,
        'agent_name', COALESCE(display_name, full_name),
        'in_progress_tickets', in_progress_tickets,
        'tickets_resolved', tickets_resolved,
        'collected_amount', collected_amount,
        'total_interactions', in_progress_tickets + tickets_resolved
      ))
      FROM agent_stats
    )
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;

-- RPC for batch transfer: move a client (ticket + batch_customer) to another batch
CREATE OR REPLACE FUNCTION transfer_client_to_batch(
  p_ticket_id UUID,
  p_target_batch_id UUID,
  p_target_agent_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_old_batch_id UUID;
  v_master_customer_id UUID;
  v_ticket RECORD;
  v_batch_customer_id UUID;
  v_old_batch_amount NUMERIC;
  v_new_amount_owed NUMERIC;
BEGIN
  -- Check if caller is admin
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can transfer clients between batches';
  END IF;

  -- Get ticket info
  SELECT id, batch_id, master_customer_id, amount_owed, assigned_agent
  INTO v_ticket
  FROM tickets
  WHERE id = p_ticket_id;
  
  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;
  
  v_old_batch_id := v_ticket.batch_id;
  v_master_customer_id := v_ticket.master_customer_id;
  v_new_amount_owed := v_ticket.amount_owed;
  
  IF v_old_batch_id = p_target_batch_id THEN
    RAISE EXCEPTION 'Client is already in the target batch';
  END IF;

  -- Find the batch_customer entry in the old batch
  SELECT id, amount_owed INTO v_batch_customer_id, v_old_batch_amount
  FROM batch_customers
  WHERE batch_id = v_old_batch_id AND master_customer_id = v_master_customer_id
  LIMIT 1;

  -- 1. Update ticket: move to new batch and new agent
  UPDATE tickets
  SET 
    batch_id = p_target_batch_id,
    assigned_agent = p_target_agent_id,
    updated_at = NOW()
  WHERE id = p_ticket_id;

  -- 2. Delete the old batch_customer entry
  IF v_batch_customer_id IS NOT NULL THEN
    DELETE FROM batch_customers WHERE id = v_batch_customer_id;
    
    -- Update old batch totals
    UPDATE batches
    SET 
      customer_count = GREATEST(customer_count - 1, 0),
      total_amount = GREATEST(total_amount - COALESCE(v_old_batch_amount, 0), 0)
    WHERE id = v_old_batch_id;
  END IF;

  -- 3. Create new batch_customer entry in target batch
  INSERT INTO batch_customers (
    batch_id, master_customer_id, nrc_number, name, mobile_number, 
    amount_owed, assigned_agent_id
  )
  SELECT 
    p_target_batch_id,
    mc.id,
    mc.nrc_number,
    mc.name,
    mc.mobile_number,
    v_new_amount_owed,
    p_target_agent_id
  FROM master_customers mc
  WHERE mc.id = v_master_customer_id
  ON CONFLICT DO NOTHING;

  -- 4. Update target batch totals
  UPDATE batches
  SET 
    customer_count = customer_count + 1,
    total_amount = total_amount + v_new_amount_owed
  WHERE id = p_target_batch_id;

  -- 5. Update master_customer assigned_agent
  UPDATE master_customers
  SET 
    assigned_agent = p_target_agent_id,
    updated_at = NOW()
  WHERE id = v_master_customer_id;

  -- 6. Update payments to reflect new agent (optional: keep original recorded_by)
  -- Payments stay linked to ticket_id, so they automatically follow

  v_result := json_build_object(
    'success', true,
    'message', 'Client transferred successfully',
    'ticket_id', p_ticket_id,
    'from_batch_id', v_old_batch_id,
    'to_batch_id', p_target_batch_id,
    'new_agent_id', p_target_agent_id
  );

  RETURN v_result;
END;
$$;