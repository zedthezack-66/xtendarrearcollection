-- Create RPC for dashboard stats (agent-scoped or admin full access)
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
  v_total_outstanding numeric;
  v_total_collected numeric;
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

  -- Get customer stats
  IF p_batch_id IS NOT NULL THEN
    -- Batch-specific stats
    SELECT 
      COUNT(DISTINCT bc.master_customer_id),
      COALESCE(SUM(bc.amount_owed), 0)
    INTO v_total_customers, v_total_outstanding
    FROM batch_customers bc
    WHERE bc.batch_id = p_batch_id
      AND (p_agent_id IS NULL OR bc.assigned_agent_id = p_agent_id);
      
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_total_collected
    FROM payments p
    JOIN tickets t ON p.ticket_id = t.id
    WHERE t.batch_id = p_batch_id
      AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id);
  ELSE
    -- Global stats
    IF p_agent_id IS NOT NULL THEN
      SELECT 
        COUNT(*),
        COALESCE(SUM(outstanding_balance), 0),
        COALESCE(SUM(total_paid), 0)
      INTO v_total_customers, v_total_outstanding, v_total_collected
      FROM master_customers
      WHERE assigned_agent = p_agent_id;
    ELSE
      SELECT 
        COUNT(*),
        COALESCE(SUM(outstanding_balance), 0),
        COALESCE(SUM(total_paid), 0)
      INTO v_total_customers, v_total_outstanding, v_total_collected
      FROM master_customers;
    END IF;
  END IF;

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
    'collection_rate', CASE WHEN (v_total_outstanding + v_total_collected) > 0 
      THEN ROUND((v_total_collected / (v_total_outstanding + v_total_collected)) * 100, 1) 
      ELSE 0 END,
    'open_tickets', v_open_tickets,
    'in_progress_tickets', v_in_progress_tickets,
    'resolved_tickets', v_resolved_tickets
  );

  RETURN v_result;
END;
$$;

-- Create RPC for collections by agent (admin only or self)
CREATE OR REPLACE FUNCTION get_collections_by_agent(p_batch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_result jsonb;
BEGIN
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);

  IF v_is_admin THEN
    SELECT jsonb_agg(agent_data)
    INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'agent_id', p.id,
        'name', COALESCE(p.display_name, p.full_name),
        'collected', COALESCE(SUM(pay.amount), 0),
        'tickets', COUNT(DISTINCT t.id)
      ) as agent_data
      FROM profiles p
      LEFT JOIN tickets t ON t.assigned_agent = p.id 
        AND (p_batch_id IS NULL OR t.batch_id = p_batch_id)
      LEFT JOIN payments pay ON pay.ticket_id = t.id
      GROUP BY p.id, p.display_name, p.full_name
      HAVING COUNT(DISTINCT t.id) > 0 OR COALESCE(SUM(pay.amount), 0) > 0
      ORDER BY COALESCE(SUM(pay.amount), 0) DESC
      LIMIT 10
    ) sub;
  ELSE
    -- Agent sees only their own stats
    SELECT jsonb_agg(agent_data)
    INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'agent_id', p.id,
        'name', COALESCE(p.display_name, p.full_name),
        'collected', COALESCE(SUM(pay.amount), 0),
        'tickets', COUNT(DISTINCT t.id)
      ) as agent_data
      FROM profiles p
      LEFT JOIN tickets t ON t.assigned_agent = p.id 
        AND (p_batch_id IS NULL OR t.batch_id = p_batch_id)
      LEFT JOIN payments pay ON pay.ticket_id = t.id
      WHERE p.id = auth.uid()
      GROUP BY p.id, p.display_name, p.full_name
    ) sub;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- Create RPC for recent tickets (paginated, agent-scoped)
CREATE OR REPLACE FUNCTION get_recent_tickets(
  p_batch_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 5,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_agent_id uuid;
  v_result jsonb;
BEGIN
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);
  v_agent_id := CASE WHEN v_is_admin THEN NULL ELSE auth.uid() END;
  
  -- Enforce max limit of 500
  IF p_limit > 500 THEN
    p_limit := 500;
  END IF;

  SELECT jsonb_agg(ticket_data)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', t.id,
      'customer_name', t.customer_name,
      'amount_owed', t.amount_owed,
      'status', t.status,
      'priority', t.priority,
      'created_at', t.created_at
    ) as ticket_data
    FROM tickets t
    WHERE (p_batch_id IS NULL OR t.batch_id = p_batch_id)
      AND (v_agent_id IS NULL OR t.assigned_agent = v_agent_id)
      AND (p_status IS NULL OR t.status = p_status)
    ORDER BY t.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- Create RPC for top defaulters (paginated, agent-scoped)
CREATE OR REPLACE FUNCTION get_top_defaulters(
  p_batch_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 5,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_agent_id uuid;
  v_result jsonb;
BEGIN
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);
  v_agent_id := CASE WHEN v_is_admin THEN NULL ELSE auth.uid() END;
  
  -- Enforce max limit of 500
  IF p_limit > 500 THEN
    p_limit := 500;
  END IF;

  IF p_batch_id IS NOT NULL THEN
    SELECT jsonb_agg(customer_data)
    INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'id', mc.id,
        'name', mc.name,
        'nrc_number', mc.nrc_number,
        'outstanding_balance', bc.amount_owed
      ) as customer_data
      FROM batch_customers bc
      JOIN master_customers mc ON mc.id = bc.master_customer_id
      WHERE bc.batch_id = p_batch_id
        AND (v_agent_id IS NULL OR bc.assigned_agent_id = v_agent_id)
        AND bc.amount_owed > 0
      ORDER BY bc.amount_owed DESC
      LIMIT p_limit OFFSET p_offset
    ) sub;
  ELSE
    SELECT jsonb_agg(customer_data)
    INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'id', mc.id,
        'name', mc.name,
        'nrc_number', mc.nrc_number,
        'outstanding_balance', mc.outstanding_balance
      ) as customer_data
      FROM master_customers mc
      WHERE (v_agent_id IS NULL OR mc.assigned_agent = v_agent_id)
        AND mc.outstanding_balance > 0
        AND mc.payment_status != 'Fully Paid'
      ORDER BY mc.outstanding_balance DESC
      LIMIT p_limit OFFSET p_offset
    ) sub;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- Add indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_tickets_status_batch ON tickets(status, batch_id);
CREATE INDEX IF NOT EXISTS idx_tickets_agent_status ON tickets(assigned_agent, status);
CREATE INDEX IF NOT EXISTS idx_batch_customers_agent ON batch_customers(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_payments_ticket ON payments(ticket_id);