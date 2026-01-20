-- Step 1: Drop ALL existing get_admin_full_export functions to remove duplicates
DROP FUNCTION IF EXISTS public.get_admin_full_export(text, text, uuid, uuid, date, date, boolean);
DROP FUNCTION IF EXISTS public.get_admin_full_export(text, text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.get_admin_full_export();

-- Step 2: Create single, unambiguous export function
CREATE OR REPLACE FUNCTION public.get_admin_full_export(
  p_export_type text DEFAULT 'tickets',
  p_filter text DEFAULT 'all',
  p_batch_id text DEFAULT NULL,
  p_agent_id text DEFAULT NULL,
  p_start_date text DEFAULT NULL,
  p_end_date text DEFAULT NULL,
  p_worked_only boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
  v_data json;
  v_count_expected integer;
  v_count_exported integer;
  v_user_id uuid;
  v_is_admin boolean;
  v_batch_uuid uuid;
  v_agent_uuid uuid;
  v_start timestamp with time zone;
  v_end timestamp with time zone;
BEGIN
  -- Get current user and verify admin
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated', 'rows_expected', 0, 'rows_exported', 0);
  END IF;
  
  SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id = v_user_id AND role = 'admin') INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN json_build_object('success', false, 'error', 'Admin access required', 'rows_expected', 0, 'rows_exported', 0);
  END IF;

  -- Parse UUIDs safely
  IF p_batch_id IS NOT NULL AND p_batch_id != '' THEN
    BEGIN
      v_batch_uuid := p_batch_id::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_batch_uuid := NULL;
    END;
  END IF;
  
  IF p_agent_id IS NOT NULL AND p_agent_id != '' THEN
    BEGIN
      v_agent_uuid := p_agent_id::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_agent_uuid := NULL;
    END;
  END IF;

  -- Parse dates safely
  IF p_start_date IS NOT NULL AND p_start_date != '' THEN
    BEGIN
      v_start := p_start_date::timestamp with time zone;
    EXCEPTION WHEN OTHERS THEN
      v_start := NULL;
    END;
  END IF;
  
  IF p_end_date IS NOT NULL AND p_end_date != '' THEN
    BEGIN
      v_end := (p_end_date::date + interval '1 day')::timestamp with time zone;
    EXCEPTION WHEN OTHERS THEN
      v_end := NULL;
    END;
  END IF;

  -- Export based on type
  IF p_export_type = 'tickets' THEN
    -- Count expected rows
    SELECT COUNT(*) INTO v_count_expected
    FROM tickets t
    WHERE (v_batch_uuid IS NULL OR t.batch_id = v_batch_uuid)
      AND (v_agent_uuid IS NULL OR t.assigned_agent = v_agent_uuid::text)
      AND (p_filter = 'all' 
           OR (p_filter = 'outstanding' AND t.status != 'resolved')
           OR (p_filter = 'resolved' AND t.status = 'resolved')
           OR (p_filter = 'open' AND t.status = 'open')
           OR (p_filter = 'in_progress' AND t.status = 'in_progress'))
      AND (v_start IS NULL OR t.created_at >= v_start)
      AND (v_end IS NULL OR t.created_at < v_end)
      AND (NOT p_worked_only OR t.call_notes IS NOT NULL OR t.status != 'open');

    -- Get data
    SELECT json_agg(row_to_json(x)) INTO v_data
    FROM (
      SELECT 
        t.id,
        t.customer_name,
        t.nrc_number,
        t.mobile_number,
        t.amount_owed,
        t.status,
        t.priority,
        t.call_notes,
        t.ticket_arrear_status,
        t.ticket_payment_status,
        t.created_at,
        t.updated_at,
        t.resolved_date,
        t.batch_id,
        b.name as batch_name,
        COALESCE(p.display_name, p.full_name, 'Unassigned') as agent_name,
        COALESCE((SELECT SUM(py.amount) FROM payments py WHERE py.ticket_id = t.id), 0) as total_paid,
        t.amount_owed - COALESCE((SELECT SUM(py.amount) FROM payments py WHERE py.ticket_id = t.id), 0) as outstanding_balance
      FROM tickets t
      LEFT JOIN batches b ON b.id = t.batch_id
      LEFT JOIN profiles p ON p.id::text = t.assigned_agent
      WHERE (v_batch_uuid IS NULL OR t.batch_id = v_batch_uuid)
        AND (v_agent_uuid IS NULL OR t.assigned_agent = v_agent_uuid::text)
        AND (p_filter = 'all' 
             OR (p_filter = 'outstanding' AND t.status != 'resolved')
             OR (p_filter = 'resolved' AND t.status = 'resolved')
             OR (p_filter = 'open' AND t.status = 'open')
             OR (p_filter = 'in_progress' AND t.status = 'in_progress'))
        AND (v_start IS NULL OR t.created_at >= v_start)
        AND (v_end IS NULL OR t.created_at < v_end)
        AND (NOT p_worked_only OR t.call_notes IS NOT NULL OR t.status != 'open')
      ORDER BY t.created_at DESC
    ) x;

  ELSIF p_export_type = 'master_customers' THEN
    SELECT COUNT(*) INTO v_count_expected FROM master_customers;
    
    SELECT json_agg(row_to_json(x)) INTO v_data
    FROM (
      SELECT 
        mc.id,
        mc.name,
        mc.nrc_number,
        mc.mobile_number,
        mc.total_owed,
        mc.total_paid,
        mc.outstanding_balance,
        mc.payment_status,
        mc.employer_name,
        mc.branch_name,
        mc.loan_consultant,
        mc.created_at,
        mc.updated_at
      FROM master_customers mc
      ORDER BY mc.outstanding_balance DESC
    ) x;

  ELSIF p_export_type = 'batch_customers' THEN
    SELECT COUNT(*) INTO v_count_expected
    FROM batch_customers bc
    WHERE (v_batch_uuid IS NULL OR bc.batch_id = v_batch_uuid);
    
    SELECT json_agg(row_to_json(x)) INTO v_data
    FROM (
      SELECT 
        bc.id,
        bc.name,
        bc.nrc_number,
        bc.mobile_number,
        bc.amount_owed,
        bc.batch_id,
        b.name as batch_name,
        bc.employer_name,
        bc.branch_name,
        bc.created_at,
        COALESCE(p.display_name, p.full_name, 'Unassigned') as agent_name
      FROM batch_customers bc
      LEFT JOIN batches b ON b.id = bc.batch_id
      LEFT JOIN profiles p ON p.id = bc.assigned_agent_id
      WHERE (v_batch_uuid IS NULL OR bc.batch_id = v_batch_uuid)
      ORDER BY bc.amount_owed DESC
    ) x;

  ELSE
    RETURN json_build_object('success', false, 'error', 'Invalid export type', 'rows_expected', 0, 'rows_exported', 0);
  END IF;

  -- Count exported rows
  SELECT COALESCE(json_array_length(v_data), 0) INTO v_count_exported;

  RETURN json_build_object(
    'success', true,
    'export_type', p_export_type,
    'filter', p_filter,
    'rows_expected', v_count_expected,
    'rows_exported', v_count_exported,
    'exported_at', now(),
    'exported_by', v_user_id,
    'data', COALESCE(v_data, '[]'::json)
  );
END;
$$;

-- Step 3: Drop and recreate arrears movement analytics with proper Date A vs Date B comparison
DROP FUNCTION IF EXISTS public.get_arrears_movement_analytics(text, text, uuid);
DROP FUNCTION IF EXISTS public.get_arrears_movement_analytics(date, date, uuid);

CREATE OR REPLACE FUNCTION public.get_arrears_movement_analytics(
  p_start_date text DEFAULT NULL,
  p_end_date text DEFAULT NULL,
  p_agent_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date date;
  v_end_date date;
  v_agent_uuid uuid;
  v_summary json;
  v_by_agent json;
  v_recent_syncs json;
  v_agent_snapshots json;
BEGIN
  -- Parse dates
  v_start_date := COALESCE(p_start_date::date, CURRENT_DATE - INTERVAL '7 days');
  v_end_date := COALESCE(p_end_date::date, CURRENT_DATE);
  
  -- Parse agent ID
  IF p_agent_id IS NOT NULL AND p_agent_id != '' THEN
    BEGIN
      v_agent_uuid := p_agent_id::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_agent_uuid := NULL;
    END;
  END IF;

  -- Get summary from sync logs (movement counts)
  SELECT json_build_object(
    'cleared', COALESCE(SUM(CASE WHEN movement_type = 'cleared' THEN 1 ELSE 0 END), 0),
    'reduced', COALESCE(SUM(CASE WHEN movement_type = 'reduced' THEN 1 ELSE 0 END), 0),
    'increased', COALESCE(SUM(CASE WHEN movement_type = 'increased' THEN 1 ELSE 0 END), 0),
    'maintained', COALESCE(SUM(CASE WHEN movement_type = 'maintained' THEN 1 ELSE 0 END), 0),
    'total_tickets_resolved', COALESCE(SUM(CASE WHEN ticket_resolved = true THEN 1 ELSE 0 END), 0),
    'total_change_amount', COALESCE(SUM(old_arrears - new_arrears), 0),
    'total_previous_arrears', COALESCE(SUM(old_arrears), 0),
    'total_current_arrears', COALESCE(SUM(new_arrears), 0)
  ) INTO v_summary
  FROM arrears_sync_logs asl
  LEFT JOIN master_customers mc ON mc.nrc_number = asl.nrc_number
  WHERE asl.created_at::date BETWEEN v_start_date AND v_end_date
    AND (v_agent_uuid IS NULL OR mc.assigned_agent = v_agent_uuid::text);

  -- Get breakdown by agent with Date A vs Date B totals from snapshots
  SELECT json_agg(agent_data) INTO v_by_agent
  FROM (
    SELECT 
      COALESCE(p.id::text, 'unassigned') as agent_id,
      COALESCE(p.display_name, p.full_name, 'Unassigned') as agent_name,
      COALESCE(SUM(CASE WHEN asl.movement_type = 'cleared' THEN 1 ELSE 0 END), 0) as cleared,
      COALESCE(SUM(CASE WHEN asl.movement_type = 'reduced' THEN 1 ELSE 0 END), 0) as reduced,
      COALESCE(SUM(CASE WHEN asl.movement_type = 'increased' THEN 1 ELSE 0 END), 0) as increased,
      COALESCE(SUM(CASE WHEN asl.movement_type = 'maintained' THEN 1 ELSE 0 END), 0) as maintained,
      COALESCE(SUM(CASE WHEN asl.ticket_resolved = true THEN 1 ELSE 0 END), 0) as tickets_resolved,
      COALESCE(SUM(asl.old_arrears - asl.new_arrears), 0) as total_recovered,
      COALESCE(SUM(asl.old_arrears), 0) as previous_arrears_total,
      COALESCE(SUM(asl.new_arrears), 0) as current_arrears_total,
      -- Date A vs Date B comparison from snapshots
      COALESCE((
        SELECT SUM(agent_total_arrears) 
        FROM arrears_snapshots 
        WHERE agent_id = p.id 
          AND snapshot_date = v_start_date
      ), 0) as arrears_at_date_a,
      COALESCE((
        SELECT SUM(agent_total_arrears) 
        FROM arrears_snapshots 
        WHERE agent_id = p.id 
          AND snapshot_date = v_end_date
      ), 0) as arrears_at_date_b
    FROM arrears_sync_logs asl
    LEFT JOIN master_customers mc ON mc.nrc_number = asl.nrc_number
    LEFT JOIN profiles p ON p.id::text = mc.assigned_agent
    WHERE asl.created_at::date BETWEEN v_start_date AND v_end_date
      AND (v_agent_uuid IS NULL OR mc.assigned_agent = v_agent_uuid::text)
    GROUP BY p.id, p.display_name, p.full_name
    ORDER BY total_recovered DESC
  ) agent_data;

  -- Get agent-level arrears snapshots for Date A vs Date B comparison
  SELECT json_agg(snapshot_data) INTO v_agent_snapshots
  FROM (
    SELECT 
      agent_id,
      COALESCE(p.display_name, p.full_name, 'Unknown') as agent_name,
      SUM(CASE WHEN snapshot_date = v_start_date THEN agent_total_arrears ELSE 0 END) as arrears_date_a,
      SUM(CASE WHEN snapshot_date = v_end_date THEN agent_total_arrears ELSE 0 END) as arrears_date_b,
      SUM(CASE WHEN snapshot_date = v_end_date THEN agent_total_arrears ELSE 0 END) - 
      SUM(CASE WHEN snapshot_date = v_start_date THEN agent_total_arrears ELSE 0 END) as net_movement,
      CASE 
        WHEN SUM(CASE WHEN snapshot_date = v_end_date THEN agent_total_arrears ELSE 0 END) = 0 
             AND SUM(CASE WHEN snapshot_date = v_start_date THEN agent_total_arrears ELSE 0 END) > 0 
        THEN 'Cleared'
        WHEN SUM(CASE WHEN snapshot_date = v_end_date THEN agent_total_arrears ELSE 0 END) < 
             SUM(CASE WHEN snapshot_date = v_start_date THEN agent_total_arrears ELSE 0 END) 
        THEN 'Reduced'
        WHEN SUM(CASE WHEN snapshot_date = v_end_date THEN agent_total_arrears ELSE 0 END) > 
             SUM(CASE WHEN snapshot_date = v_start_date THEN agent_total_arrears ELSE 0 END) 
        THEN 'Increased'
        ELSE 'Maintained'
      END as movement_classification
    FROM arrears_snapshots a
    LEFT JOIN profiles p ON p.id = a.agent_id
    WHERE snapshot_date IN (v_start_date, v_end_date)
      AND agent_id IS NOT NULL
      AND (v_agent_uuid IS NULL OR agent_id = v_agent_uuid)
    GROUP BY agent_id, p.display_name, p.full_name
    HAVING SUM(CASE WHEN snapshot_date = v_start_date THEN agent_total_arrears ELSE 0 END) > 0
        OR SUM(CASE WHEN snapshot_date = v_end_date THEN agent_total_arrears ELSE 0 END) > 0
    ORDER BY net_movement ASC
  ) snapshot_data;

  -- Get recent syncs
  SELECT json_agg(sync_data) INTO v_recent_syncs
  FROM (
    SELECT 
      sync_batch_id,
      MIN(created_at) as sync_date,
      admin_user_id,
      COUNT(*) as records_processed,
      SUM(CASE WHEN movement_type = 'cleared' THEN 1 ELSE 0 END) as cleared_count,
      SUM(CASE WHEN movement_type = 'reduced' THEN 1 ELSE 0 END) as reduced_count,
      SUM(CASE WHEN movement_type = 'increased' THEN 1 ELSE 0 END) as increased_count,
      SUM(CASE WHEN movement_type = 'maintained' THEN 1 ELSE 0 END) as maintained_count
    FROM arrears_sync_logs
    WHERE created_at::date BETWEEN v_start_date AND v_end_date
    GROUP BY sync_batch_id, admin_user_id
    ORDER BY sync_date DESC
    LIMIT 10
  ) sync_data;

  RETURN json_build_object(
    'summary', COALESCE(v_summary, '{}'::json),
    'by_agent', COALESCE(v_by_agent, '[]'::json),
    'agent_snapshots', COALESCE(v_agent_snapshots, '[]'::json),
    'recent_syncs', COALESCE(v_recent_syncs, '[]'::json),
    'date_range', json_build_object(
      'start_date', v_start_date,
      'end_date', v_end_date
    )
  );
END;
$$;