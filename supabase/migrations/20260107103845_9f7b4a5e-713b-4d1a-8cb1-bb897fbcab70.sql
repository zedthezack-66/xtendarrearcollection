-- RPC: Get weekly report data with real outstanding calculations
CREATE OR REPLACE FUNCTION get_weekly_report_stats(
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
  WITH ticket_payments AS (
    SELECT 
      t.id AS ticket_id,
      t.assigned_agent,
      t.amount_owed,
      t.status,
      COALESCE(SUM(p.amount), 0) AS total_paid
    FROM tickets t
    LEFT JOIN payments p ON p.ticket_id = t.id
    WHERE (p_agent_id IS NULL OR t.assigned_agent = p_agent_id)
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

-- RPC: Get interaction analytics (call notes + status changes)
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
  
  WITH call_interactions AS (
    SELECT 
      agent_id,
      COUNT(*) AS call_count
    FROM call_logs
    WHERE created_at >= v_start_date 
      AND created_at <= v_end_date
      AND (p_agent_id IS NULL OR agent_id = p_agent_id)
    GROUP BY agent_id
  ),
  agent_stats AS (
    SELECT 
      pr.id AS agent_id,
      pr.display_name,
      pr.full_name,
      COALESCE(ci.call_count, 0) AS total_calls,
      (SELECT COUNT(*) FROM tickets t WHERE t.assigned_agent = pr.id 
        AND t.created_at >= v_start_date AND t.created_at <= v_end_date) AS tickets_created,
      (SELECT COUNT(*) FROM tickets t WHERE t.assigned_agent = pr.id 
        AND t.status = 'Resolved' AND t.resolved_date >= v_start_date 
        AND t.resolved_date <= v_end_date) AS tickets_resolved,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p 
        WHERE p.recorded_by = pr.id 
        AND p.created_at >= v_start_date AND p.created_at <= v_end_date) AS collected_amount
    FROM profiles pr
    LEFT JOIN call_interactions ci ON ci.agent_id = pr.id
    WHERE (p_agent_id IS NULL OR pr.id = p_agent_id)
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

-- RPC: Get admin analytics with agent selection
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
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.ticket_id = t.id), 0) AS paid
    FROM tickets t
    WHERE (p_agent_id IS NULL OR t.assigned_agent = p_agent_id)
  ),
  call_data AS (
    SELECT 
      agent_id,
      COUNT(*) AS call_count
    FROM call_logs
    WHERE (p_agent_id IS NULL OR agent_id = p_agent_id)
    GROUP BY agent_id
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
      COALESCE((SELECT call_count FROM call_data cd WHERE cd.agent_id = pr.id), 0) AS interaction_count
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
        'outstanding_balance', total_owed - total_collected,
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
        'outstanding_balance', COALESCE(SUM(total_owed - total_collected), 0),
        'total_interactions', COALESCE(SUM(interaction_count), 0)
      )
      FROM agent_stats
    )
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;