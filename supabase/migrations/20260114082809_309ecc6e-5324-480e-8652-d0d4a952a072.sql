-- ============================================
-- 1. Create RPC for hard ticket delete (includes master_customer)
-- ============================================
CREATE OR REPLACE FUNCTION public.hard_delete_ticket(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_admin boolean;
  v_ticket_agent uuid;
  v_master_customer_id uuid;
  v_batch_id uuid;
  v_deleted_payments integer := 0;
  v_deleted_call_logs integer := 0;
  v_has_other_tickets boolean;
BEGIN
  -- Check if user is admin
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);
  
  -- Get ticket details
  SELECT assigned_agent, master_customer_id, batch_id 
  INTO v_ticket_agent, v_master_customer_id, v_batch_id
  FROM tickets 
  WHERE id = p_ticket_id;
  
  IF v_master_customer_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;
  
  -- Authorization: must be admin OR assigned agent
  IF NOT v_is_admin AND v_ticket_agent != auth.uid() THEN
    RAISE EXCEPTION 'You can only delete tickets assigned to you';
  END IF;
  
  -- Delete call_logs for this ticket
  DELETE FROM call_logs WHERE ticket_id = p_ticket_id;
  GET DIAGNOSTICS v_deleted_call_logs = ROW_COUNT;
  
  -- Delete payments for this ticket
  DELETE FROM payments WHERE ticket_id = p_ticket_id;
  GET DIAGNOSTICS v_deleted_payments = ROW_COUNT;
  
  -- Delete the ticket
  DELETE FROM tickets WHERE id = p_ticket_id;
  
  -- Delete batch_customer record
  IF v_batch_id IS NOT NULL THEN
    DELETE FROM batch_customers 
    WHERE batch_id = v_batch_id AND master_customer_id = v_master_customer_id;
  END IF;
  
  -- Check if master_customer has other tickets
  SELECT EXISTS(SELECT 1 FROM tickets WHERE master_customer_id = v_master_customer_id)
  INTO v_has_other_tickets;
  
  -- If no other tickets exist, delete the master_customer
  IF NOT v_has_other_tickets THEN
    DELETE FROM master_customers WHERE id = v_master_customer_id;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'deleted_call_logs', v_deleted_call_logs,
    'deleted_payments', v_deleted_payments,
    'master_customer_deleted', NOT v_has_other_tickets
  );
END;
$$;

-- ============================================
-- 2. Add agent permissions to update/delete payments
-- ============================================
-- Drop existing policies that might conflict
DROP POLICY IF EXISTS "Agents can update own payments" ON payments;
DROP POLICY IF EXISTS "Agents can delete own payments" ON payments;

-- Agents can update payments they recorded
CREATE POLICY "Agents can update own payments" 
ON payments 
FOR UPDATE 
USING (recorded_by = auth.uid());

-- Agents can delete payments they recorded
CREATE POLICY "Agents can delete own payments" 
ON payments 
FOR DELETE 
USING (recorded_by = auth.uid());

-- ============================================
-- 3. Update weekly report RPC to auto-scope for agents
-- ============================================
CREATE OR REPLACE FUNCTION public.get_weekly_report_stats(p_agent_id uuid DEFAULT NULL::uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result JSON;
  v_is_admin boolean;
  v_effective_agent_id uuid;
BEGIN
  -- Check if current user is admin
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);
  
  -- If not admin, FORCE agent_id to current user (no cross-agent visibility)
  IF NOT v_is_admin THEN
    v_effective_agent_id := auth.uid();
  ELSE
    v_effective_agent_id := p_agent_id;
  END IF;

  WITH ticket_payments AS (
    SELECT 
      t.id AS ticket_id,
      t.assigned_agent,
      t.amount_owed,
      t.status,
      COALESCE(SUM(p.amount), 0) AS total_paid
    FROM tickets t
    LEFT JOIN payments p ON p.ticket_id = t.id
    WHERE (v_effective_agent_id IS NULL OR t.assigned_agent = v_effective_agent_id)
    GROUP BY t.id, t.assigned_agent, t.amount_owed, t.status
  ),
  stats AS (
    SELECT
      COUNT(DISTINCT ticket_id) AS total_tickets,
      SUM(amount_owed) AS total_owed,
      SUM(total_paid) AS total_collected,
      SUM(GREATEST(amount_owed - total_paid, 0)) AS outstanding_balance,
      COUNT(DISTINCT CASE WHEN status = 'Open' THEN ticket_id END) AS open_tickets,
      COUNT(DISTINCT CASE WHEN status = 'In Progress' THEN ticket_id END) AS in_progress_tickets,
      COUNT(DISTINCT CASE WHEN status = 'Resolved' THEN ticket_id END) AS resolved_tickets
    FROM ticket_payments
  )
  SELECT json_build_object(
    'total_tickets', COALESCE(total_tickets, 0),
    'total_owed', COALESCE(total_owed, 0),
    'total_collected', COALESCE(total_collected, 0),
    'outstanding_balance', COALESCE(outstanding_balance, 0),
    'collection_rate', CASE WHEN COALESCE(total_owed, 0) > 0 
      THEN ROUND((COALESCE(total_collected, 0)::NUMERIC / total_owed::NUMERIC) * 100, 2) 
      ELSE 0 
    END,
    'open_tickets', COALESCE(open_tickets, 0),
    'in_progress_tickets', COALESCE(in_progress_tickets, 0),
    'resolved_tickets', COALESCE(resolved_tickets, 0)
  ) INTO v_result FROM stats;
  
  RETURN v_result;
END;
$$;

-- ============================================
-- 4. Update interaction analytics RPC to auto-scope for agents
-- ============================================
CREATE OR REPLACE FUNCTION public.get_interaction_analytics(p_agent_id uuid DEFAULT NULL::uuid, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result JSON;
  v_start_date TIMESTAMP WITH TIME ZONE;
  v_end_date TIMESTAMP WITH TIME ZONE;
  v_is_admin boolean;
  v_effective_agent_id uuid;
BEGIN
  v_start_date := COALESCE(p_start_date::TIMESTAMP WITH TIME ZONE, NOW() - INTERVAL '7 days');
  v_end_date := COALESCE(p_end_date::TIMESTAMP WITH TIME ZONE, NOW());
  
  -- Check if current user is admin
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);
  
  -- If not admin, FORCE agent_id to current user
  IF NOT v_is_admin THEN
    v_effective_agent_id := auth.uid();
  ELSE
    v_effective_agent_id := p_agent_id;
  END IF;
  
  WITH call_interactions AS (
    SELECT 
      agent_id,
      COUNT(*) AS call_count
    FROM call_logs
    WHERE created_at >= v_start_date 
      AND created_at <= v_end_date
      AND (v_effective_agent_id IS NULL OR agent_id = v_effective_agent_id)
    GROUP BY agent_id
  ),
  agent_stats AS (
    SELECT 
      pr.id AS agent_id,
      pr.display_name,
      pr.full_name,
      COALESCE(ci.call_count, 0) AS total_calls,
      (SELECT COUNT(*) FROM tickets t WHERE t.assigned_agent = pr.id 
        AND t.created_at >= v_start_date AND t.created_at <= v_end_date
        AND (v_effective_agent_id IS NULL OR pr.id = v_effective_agent_id)) AS tickets_created,
      (SELECT COUNT(*) FROM tickets t WHERE t.assigned_agent = pr.id 
        AND t.status = 'Resolved' AND t.resolved_date >= v_start_date 
        AND t.resolved_date <= v_end_date
        AND (v_effective_agent_id IS NULL OR pr.id = v_effective_agent_id)) AS tickets_resolved,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p 
        WHERE p.recorded_by = pr.id 
        AND p.created_at >= v_start_date AND p.created_at <= v_end_date
        AND (v_effective_agent_id IS NULL OR pr.id = v_effective_agent_id)) AS collected_amount
    FROM profiles pr
    LEFT JOIN call_interactions ci ON ci.agent_id = pr.id
    WHERE (v_effective_agent_id IS NULL OR pr.id = v_effective_agent_id)
  )
  SELECT json_build_object(
    'total_interactions', (SELECT COALESCE(SUM(total_calls), 0) FROM agent_stats),
    'total_tickets_resolved', (SELECT COALESCE(SUM(tickets_resolved), 0) FROM agent_stats),
    'total_collected', (SELECT COALESCE(SUM(collected_amount), 0) FROM agent_stats),
    'by_agent', (
      SELECT json_agg(json_build_object(
        'agent_id', agent_id,
        'agent_name', COALESCE(display_name, full_name),
        'total_calls', total_calls,
        'tickets_created', tickets_created,
        'tickets_resolved', tickets_resolved,
        'collected_amount', collected_amount,
        'total_interactions', total_calls + tickets_resolved
      ))
      FROM agent_stats
    )
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;