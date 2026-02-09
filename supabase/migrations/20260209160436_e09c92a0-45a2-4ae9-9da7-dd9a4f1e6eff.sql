
-- Fix get_interaction_analytics: attribute collections to ticket's assigned agent, not recorded_by
-- Also scope agent view properly (agents only see their own data)
CREATE OR REPLACE FUNCTION public.get_interaction_analytics(
  p_start_date TEXT DEFAULT NULL,
  p_end_date TEXT DEFAULT NULL,
  p_agent_id TEXT DEFAULT NULL
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
  v_is_admin boolean;
  v_effective_agent_id uuid;
BEGIN
  v_start_date := COALESCE(p_start_date::TIMESTAMP WITH TIME ZONE, NOW() - INTERVAL '7 days');
  v_end_date := COALESCE(p_end_date::TIMESTAMP WITH TIME ZONE, NOW());
  
  -- Check if current user is admin
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);
  
  -- If not admin, FORCE agent_id to current user (no cross-agent visibility)
  IF NOT v_is_admin THEN
    v_effective_agent_id := auth.uid();
  ELSE
    v_effective_agent_id := p_agent_id::uuid;
  END IF;

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
      -- Collection amount: sum payments linked to tickets assigned to this agent (system_manual only)
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p 
        JOIN tickets t ON t.id = p.ticket_id
        WHERE t.assigned_agent = pr.id 
        AND (p.source IS NULL OR p.source = 'system_manual')
        AND p.created_at >= v_start_date AND p.created_at <= v_end_date) AS collected_amount
    FROM profiles pr
    WHERE (v_effective_agent_id IS NULL OR pr.id = v_effective_agent_id)
  )
  SELECT json_build_object(
    'total_interactions', (SELECT COALESCE(SUM(in_progress_tickets + tickets_resolved), 0) FROM agent_stats),
    'total_tickets_resolved', (SELECT COALESCE(SUM(tickets_resolved), 0) FROM agent_stats),
    'total_collected', (SELECT COALESCE(SUM(collected_amount), 0) FROM agent_stats),
    'by_agent', (
      SELECT COALESCE(json_agg(json_build_object(
        'agent_id', agent_id,
        'agent_name', COALESCE(display_name, full_name),
        'in_progress_tickets', in_progress_tickets,
        'tickets_resolved', tickets_resolved,
        'collected_amount', collected_amount,
        'total_interactions', in_progress_tickets + tickets_resolved
      )), '[]'::json)
      FROM agent_stats
    )
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;
