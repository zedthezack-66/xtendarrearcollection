-- Create RPC for agent to confirm ticket resolution
CREATE OR REPLACE FUNCTION public.confirm_ticket_resolution(
  p_ticket_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket RECORD;
  v_agent_id UUID;
  v_is_admin BOOLEAN;
  v_sync_log_id UUID;
BEGIN
  v_agent_id := auth.uid();
  v_is_admin := has_role(v_agent_id, 'admin'::app_role);
  
  -- Get ticket info
  SELECT id, status, assigned_agent, customer_name, amount_owed, master_customer_id
  INTO v_ticket
  FROM tickets
  WHERE id = p_ticket_id;
  
  IF v_ticket.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ticket not found');
  END IF;
  
  -- Verify authorization: must be assigned agent or admin
  IF NOT v_is_admin AND v_ticket.assigned_agent != v_agent_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to confirm this ticket');
  END IF;
  
  -- Verify ticket is in pending confirmation status
  IF v_ticket.status != 'Pending Confirmation' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ticket is not pending confirmation. Current status: ' || v_ticket.status);
  END IF;
  
  -- Resolve the ticket
  UPDATE tickets
  SET 
    status = 'Resolved',
    resolved_date = NOW(),
    updated_at = NOW()
  WHERE id = p_ticket_id;
  
  -- Find the most recent sync log ID for this customer
  SELECT id INTO v_sync_log_id
  FROM arrears_sync_logs
  WHERE master_customer_id = v_ticket.master_customer_id
    AND ticket_resolved = FALSE
    AND movement_type = 'Cleared'
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- Update sync log to mark as resolved
  IF v_sync_log_id IS NOT NULL THEN
    UPDATE arrears_sync_logs
    SET ticket_resolved = TRUE
    WHERE id = v_sync_log_id;
  END IF;
  
  -- Mark related notifications as read
  UPDATE agent_notifications
  SET is_read = TRUE
  WHERE related_ticket_id = p_ticket_id
    AND type = 'arrears_cleared';
  
  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'customer_name', v_ticket.customer_name,
    'confirmed_by', v_agent_id,
    'confirmed_at', NOW()
  );
END;
$$;

-- Create RPC to reopen a resolved ticket (agent can edit any ticket)
CREATE OR REPLACE FUNCTION public.reopen_ticket(
  p_ticket_id UUID,
  p_new_amount_owed NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket RECORD;
  v_agent_id UUID;
  v_is_admin BOOLEAN;
BEGIN
  v_agent_id := auth.uid();
  v_is_admin := has_role(v_agent_id, 'admin'::app_role);
  
  -- Get ticket info
  SELECT id, status, assigned_agent, customer_name, amount_owed, master_customer_id
  INTO v_ticket
  FROM tickets
  WHERE id = p_ticket_id;
  
  IF v_ticket.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ticket not found');
  END IF;
  
  -- Verify authorization: must be assigned agent or admin
  IF NOT v_is_admin AND v_ticket.assigned_agent != v_agent_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to reopen this ticket');
  END IF;
  
  -- Reopen the ticket
  UPDATE tickets
  SET 
    status = 'Open',
    amount_owed = COALESCE(p_new_amount_owed, amount_owed),
    resolved_date = NULL,
    updated_at = NOW()
  WHERE id = p_ticket_id;
  
  -- Update master customer if amount changed
  IF p_new_amount_owed IS NOT NULL THEN
    UPDATE master_customers
    SET 
      outstanding_balance = p_new_amount_owed,
      loan_book_arrears = p_new_amount_owed,
      updated_at = NOW()
    WHERE id = v_ticket.master_customer_id;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'customer_name', v_ticket.customer_name,
    'new_status', 'Open',
    'new_amount_owed', COALESCE(p_new_amount_owed, v_ticket.amount_owed),
    'reopened_by', v_agent_id,
    'reopened_at', NOW()
  );
END;
$$;

-- Create RPC to get pending confirmation tickets for dashboard
CREATE OR REPLACE FUNCTION public.get_pending_confirmation_tickets(
  p_agent_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_effective_agent_id UUID;
  v_result JSONB;
BEGIN
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);
  
  -- If not admin, force agent_id to current user
  IF NOT v_is_admin THEN
    v_effective_agent_id := auth.uid();
  ELSE
    v_effective_agent_id := p_agent_id;
  END IF;
  
  SELECT jsonb_agg(ticket_data)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', t.id,
      'customer_name', t.customer_name,
      'nrc_number', t.nrc_number,
      'amount_owed', t.amount_owed,
      'old_amount', asl.old_arrears,
      'new_amount', asl.new_arrears,
      'sync_date', asl.created_at,
      'assigned_agent', t.assigned_agent,
      'agent_name', COALESCE(p.display_name, p.full_name)
    ) as ticket_data
    FROM tickets t
    LEFT JOIN arrears_sync_logs asl ON asl.master_customer_id = t.master_customer_id
      AND asl.movement_type = 'Cleared'
      AND asl.ticket_resolved = FALSE
    LEFT JOIN profiles p ON p.id = t.assigned_agent
    WHERE t.status = 'Pending Confirmation'
      AND (v_effective_agent_id IS NULL OR t.assigned_agent = v_effective_agent_id)
    ORDER BY t.updated_at DESC
    LIMIT 100
  ) sub;
  
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- Update get_dashboard_stats to include pending confirmation count
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_agent_id uuid DEFAULT NULL::uuid, p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  v_pending_confirmation_tickets integer;
BEGIN
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);
  
  IF NOT v_is_admin THEN
    p_agent_id := auth.uid();
  END IF;

  IF p_batch_id IS NOT NULL THEN
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

  v_total_outstanding := GREATEST(v_total_owed - v_total_collected, 0);

  IF p_batch_id IS NOT NULL THEN
    SELECT 
      COUNT(*) FILTER (WHERE status = 'Open'),
      COUNT(*) FILTER (WHERE status = 'In Progress'),
      COUNT(*) FILTER (WHERE status = 'Resolved'),
      COUNT(*) FILTER (WHERE status = 'Pending Confirmation')
    INTO v_open_tickets, v_in_progress_tickets, v_resolved_tickets, v_pending_confirmation_tickets
    FROM tickets
    WHERE batch_id = p_batch_id
      AND (p_agent_id IS NULL OR assigned_agent = p_agent_id);
  ELSE
    SELECT 
      COUNT(*) FILTER (WHERE status = 'Open'),
      COUNT(*) FILTER (WHERE status = 'In Progress'),
      COUNT(*) FILTER (WHERE status = 'Resolved'),
      COUNT(*) FILTER (WHERE status = 'Pending Confirmation')
    INTO v_open_tickets, v_in_progress_tickets, v_resolved_tickets, v_pending_confirmation_tickets
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
    'resolved_tickets', v_resolved_tickets,
    'pending_confirmation_tickets', v_pending_confirmation_tickets
  );

  RETURN v_result;
END;
$$;

-- Update get_arrears_movement_analytics to include confirmation tracking
CREATE OR REPLACE FUNCTION public.get_arrears_movement_analytics(
  p_start_date TEXT DEFAULT NULL,
  p_end_date TEXT DEFAULT NULL,
  p_agent_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_start_ts TIMESTAMP WITH TIME ZONE;
  v_end_ts TIMESTAMP WITH TIME ZONE;
  v_result JSONB;
BEGIN
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);
  
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object(
      'error', 'Admin access required',
      'summary', NULL,
      'by_agent', NULL,
      'recent_syncs', NULL
    );
  END IF;
  
  v_start_ts := COALESCE(p_start_date::TIMESTAMP WITH TIME ZONE, NOW() - INTERVAL '7 days');
  v_end_ts := COALESCE(p_end_date::TIMESTAMP WITH TIME ZONE, NOW()) + INTERVAL '1 day';
  
  WITH summary_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE movement_type = 'Cleared') AS cleared,
      COUNT(*) FILTER (WHERE movement_type = 'Reduced') AS reduced,
      COUNT(*) FILTER (WHERE movement_type = 'Increased') AS increased,
      COUNT(*) FILTER (WHERE movement_type = 'Maintained') AS maintained,
      COUNT(*) FILTER (WHERE ticket_resolved = TRUE) AS total_tickets_resolved,
      COUNT(*) FILTER (WHERE movement_type = 'Cleared' AND ticket_resolved = FALSE) AS pending_confirmation,
      COALESCE(SUM(CASE WHEN movement_type IN ('Cleared', 'Reduced') THEN old_arrears - new_arrears ELSE 0 END), 0) AS total_change_amount
    FROM arrears_sync_logs
    WHERE created_at >= v_start_ts
      AND created_at < v_end_ts
      AND movement_type != 'Not Found'
  ),
  agent_breakdown AS (
    SELECT
      t.assigned_agent AS agent_id,
      COALESCE(p.display_name, p.full_name, 'Unassigned') AS agent_name,
      COUNT(*) FILTER (WHERE asl.movement_type = 'Cleared') AS cleared,
      COUNT(*) FILTER (WHERE asl.movement_type = 'Reduced') AS reduced,
      COUNT(*) FILTER (WHERE asl.movement_type = 'Increased') AS increased,
      COUNT(*) FILTER (WHERE asl.movement_type = 'Maintained') AS maintained,
      COUNT(*) FILTER (WHERE asl.ticket_resolved = TRUE) AS tickets_resolved,
      COALESCE(SUM(CASE WHEN asl.movement_type IN ('Cleared', 'Reduced') THEN asl.old_arrears - asl.new_arrears ELSE 0 END), 0) AS total_recovered
    FROM arrears_sync_logs asl
    JOIN master_customers mc ON mc.id = asl.master_customer_id
    LEFT JOIN tickets t ON t.master_customer_id = mc.id
    LEFT JOIN profiles p ON p.id = t.assigned_agent
    WHERE asl.created_at >= v_start_ts
      AND asl.created_at < v_end_ts
      AND asl.movement_type != 'Not Found'
      AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id)
    GROUP BY t.assigned_agent, p.display_name, p.full_name
  ),
  recent_syncs AS (
    SELECT DISTINCT ON (sync_batch_id)
      sync_batch_id,
      created_at AS sync_date,
      admin_user_id,
      COUNT(*) OVER (PARTITION BY sync_batch_id) AS records_processed
    FROM arrears_sync_logs
    WHERE created_at >= v_start_ts
      AND created_at < v_end_ts
    ORDER BY sync_batch_id, created_at DESC
  )
  SELECT jsonb_build_object(
    'summary', (SELECT row_to_json(summary_stats.*) FROM summary_stats),
    'by_agent', COALESCE((SELECT jsonb_agg(row_to_json(agent_breakdown.*)) FROM agent_breakdown), '[]'::jsonb),
    'recent_syncs', COALESCE((SELECT jsonb_agg(row_to_json(recent_syncs.*) ORDER BY sync_date DESC) FROM recent_syncs LIMIT 10), '[]'::jsonb),
    'date_range', jsonb_build_object('start_date', v_start_ts, 'end_date', v_end_ts)
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;