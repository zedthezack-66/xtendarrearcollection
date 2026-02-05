-- Drop existing function first to change return type
DROP FUNCTION IF EXISTS get_collections_by_agent(uuid);

-- Recreate get_collections_by_agent to only count system_manual payments for agent KPIs
CREATE FUNCTION get_collections_by_agent(p_batch_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_agg(
    json_build_object(
      'agent_id', agent_id,
      'name', agent_name,
      'collected', collected,
      'tickets', ticket_count
    )
    ORDER BY collected DESC
  )
  INTO v_result
  FROM (
    SELECT 
      pr.id as agent_id,
      COALESCE(pr.display_name, pr.full_name) as agent_name,
      COALESCE(SUM(p.amount), 0) as collected,
      COUNT(DISTINCT t.id) as ticket_count
    FROM profiles pr
    LEFT JOIN tickets t ON t.assigned_agent = pr.id
      AND (p_batch_id IS NULL OR t.batch_id = p_batch_id)
    LEFT JOIN payments p ON p.ticket_id = t.id
      AND (p.source IS NULL OR p.source = 'system_manual')
    GROUP BY pr.id, pr.display_name, pr.full_name
    HAVING COUNT(t.id) > 0
  ) agents;
  
  RETURN COALESCE(v_result, '[]'::json);
END;
$$;