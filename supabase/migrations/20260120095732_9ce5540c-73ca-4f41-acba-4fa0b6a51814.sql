-- Drop existing function with old signature and recreate with enhanced output
DROP FUNCTION IF EXISTS public.get_arrears_movement_analytics(DATE, DATE, UUID);

-- Enhanced arrears movement analytics with customer drill-down and pivot data
CREATE OR REPLACE FUNCTION public.get_arrears_movement_analytics(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_agent_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start DATE;
  v_end DATE;
  v_result JSON;
BEGIN
  -- Default to last 7 days if not provided
  v_start := COALESCE(p_start_date, CURRENT_DATE - INTERVAL '7 days');
  v_end := COALESCE(p_end_date, CURRENT_DATE);
  
  SELECT json_build_object(
    'summary', (
      SELECT json_build_object(
        'cleared', COALESCE(SUM(CASE WHEN movement_type = 'CLEARED' THEN 1 ELSE 0 END), 0),
        'reduced', COALESCE(SUM(CASE WHEN movement_type = 'REDUCED' THEN 1 ELSE 0 END), 0),
        'increased', COALESCE(SUM(CASE WHEN movement_type = 'INCREASED' THEN 1 ELSE 0 END), 0),
        'maintained', COALESCE(SUM(CASE WHEN movement_type = 'MAINTAINED' THEN 1 ELSE 0 END), 0),
        'total_tickets_resolved', COALESCE(SUM(CASE WHEN ticket_resolved THEN 1 ELSE 0 END), 0),
        'total_change_amount', COALESCE(SUM(new_arrears - old_arrears), 0),
        'total_previous_arrears', COALESCE(SUM(old_arrears), 0),
        'total_current_arrears', COALESCE(SUM(new_arrears), 0)
      )
      FROM arrears_sync_logs
      WHERE created_at::date >= v_start AND created_at::date <= v_end
        AND (p_agent_id IS NULL OR EXISTS (
          SELECT 1 FROM tickets t 
          WHERE t.master_customer_id = arrears_sync_logs.master_customer_id 
          AND t.assigned_agent = p_agent_id
        ))
    ),
    'by_agent', COALESCE((
      SELECT json_agg(agent_data ORDER BY agent_name)
      FROM (
        SELECT 
          t.assigned_agent as agent_id,
          COALESCE(p.display_name, p.full_name, 'Unassigned') as agent_name,
          COUNT(CASE WHEN asl.movement_type = 'CLEARED' THEN 1 END) as cleared,
          COUNT(CASE WHEN asl.movement_type = 'REDUCED' THEN 1 END) as reduced,
          COUNT(CASE WHEN asl.movement_type = 'INCREASED' THEN 1 END) as increased,
          COUNT(CASE WHEN asl.movement_type = 'MAINTAINED' THEN 1 END) as maintained,
          COUNT(CASE WHEN asl.ticket_resolved THEN 1 END) as tickets_resolved,
          COALESCE(SUM(asl.old_arrears - asl.new_arrears), 0) as total_recovered,
          COALESCE(SUM(asl.old_arrears), 0) as previous_arrears_total,
          COALESCE(SUM(asl.new_arrears), 0) as current_arrears_total
        FROM arrears_sync_logs asl
        LEFT JOIN tickets t ON t.master_customer_id = asl.master_customer_id
        LEFT JOIN profiles p ON t.assigned_agent = p.id
        WHERE asl.created_at::date >= v_start AND asl.created_at::date <= v_end
          AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id)
        GROUP BY t.assigned_agent, p.display_name, p.full_name
      ) agent_data
    ), '[]'::json),
    'by_customer', COALESCE((
      SELECT json_agg(customer_data ORDER BY customer_name)
      FROM (
        SELECT 
          asl.nrc_number,
          mc.name as customer_name,
          t.assigned_agent as agent_id,
          COALESCE(p.display_name, p.full_name, 'Unassigned') as agent_name,
          asl.old_arrears as previous_arrears,
          asl.new_arrears as current_arrears,
          asl.old_arrears - asl.new_arrears as movement_amount,
          asl.movement_type,
          asl.ticket_resolved,
          asl.created_at as sync_date
        FROM arrears_sync_logs asl
        LEFT JOIN master_customers mc ON mc.id = asl.master_customer_id
        LEFT JOIN tickets t ON t.master_customer_id = asl.master_customer_id
        LEFT JOIN profiles p ON t.assigned_agent = p.id
        WHERE asl.created_at::date >= v_start AND asl.created_at::date <= v_end
          AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id)
        ORDER BY asl.created_at DESC
        LIMIT 500
      ) customer_data
    ), '[]'::json),
    'recent_syncs', COALESCE((
      SELECT json_agg(sync_data ORDER BY sync_date DESC)
      FROM (
        SELECT 
          sync_batch_id,
          MIN(created_at) as sync_date,
          admin_user_id,
          COUNT(*) as records_processed,
          COUNT(CASE WHEN movement_type = 'CLEARED' THEN 1 END) as cleared_count,
          COUNT(CASE WHEN movement_type = 'REDUCED' THEN 1 END) as reduced_count,
          COUNT(CASE WHEN movement_type = 'INCREASED' THEN 1 END) as increased_count,
          COUNT(CASE WHEN movement_type = 'MAINTAINED' THEN 1 END) as maintained_count
        FROM arrears_sync_logs
        WHERE created_at::date >= v_start AND created_at::date <= v_end
        GROUP BY sync_batch_id, admin_user_id
        ORDER BY MIN(created_at) DESC
        LIMIT 20
      ) sync_data
    ), '[]'::json),
    'date_range', json_build_object(
      'start_date', v_start,
      'end_date', v_end
    )
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;