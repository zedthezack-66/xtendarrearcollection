-- Drop ALL existing versions of get_admin_full_export to eliminate ambiguity
DROP FUNCTION IF EXISTS public.get_admin_full_export(text, text, uuid, uuid, text, text, boolean);
DROP FUNCTION IF EXISTS public.get_admin_full_export(text, text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.get_admin_full_export();

-- Create ONE unified function with TEXT parameters and internal UUID conversion
CREATE OR REPLACE FUNCTION public.get_admin_full_export(
  p_export_type text DEFAULT 'tickets',
  p_filter text DEFAULT 'all',
  p_batch_id text DEFAULT NULL,
  p_agent_id text DEFAULT NULL,
  p_start_date text DEFAULT NULL,
  p_end_date text DEFAULT NULL,
  p_worked_only boolean DEFAULT false,
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result json;
  v_row_count integer;
  v_exported_count integer;
  v_user_role text;
  v_start_time timestamptz := clock_timestamp();
  v_execution_time_ms integer;
  v_batch_uuid uuid;
  v_agent_uuid uuid;
  v_error_message text;
BEGIN
  -- Check if user is admin
  SELECT role INTO v_user_role FROM user_roles WHERE user_id = auth.uid();
  IF v_user_role != 'admin' THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Unauthorized: Admin access required',
      'rows_expected', 0,
      'rows_exported', 0,
      'execution_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer
    );
  END IF;

  -- Validate and convert batch_id to UUID
  IF p_batch_id IS NOT NULL AND p_batch_id != '' THEN
    BEGIN
      v_batch_uuid := p_batch_id::uuid;
      -- Verify batch exists
      IF NOT EXISTS (SELECT 1 FROM batches WHERE id = v_batch_uuid) THEN
        RETURN json_build_object(
          'success', false,
          'error', 'Batch not found: ' || p_batch_id,
          'rows_expected', 0,
          'rows_exported', 0,
          'execution_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Invalid batch_id format: ' || p_batch_id,
        'rows_expected', 0,
        'rows_exported', 0,
        'execution_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer
      );
    END;
  END IF;

  -- Validate and convert agent_id to UUID
  IF p_agent_id IS NOT NULL AND p_agent_id != '' THEN
    BEGIN
      v_agent_uuid := p_agent_id::uuid;
      -- Verify agent exists
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_agent_uuid) THEN
        RETURN json_build_object(
          'success', false,
          'error', 'Agent not found: ' || p_agent_id,
          'rows_expected', 0,
          'rows_exported', 0,
          'execution_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Invalid agent_id format: ' || p_agent_id,
        'rows_expected', 0,
        'rows_exported', 0,
        'execution_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer
      );
    END;
  END IF;

  -- Validate export_type
  IF p_export_type NOT IN ('tickets', 'master_customers', 'batch_customers') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Invalid export_type. Must be: tickets, master_customers, or batch_customers',
      'rows_expected', 0,
      'rows_exported', 0,
      'execution_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer
    );
  END IF;

  -- Validate date range
  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN
    BEGIN
      IF p_start_date::date > p_end_date::date THEN
        RETURN json_build_object(
          'success', false,
          'error', 'Start date cannot be after end date',
          'rows_expected', 0,
          'rows_exported', 0,
          'execution_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Invalid date format. Use YYYY-MM-DD',
        'rows_expected', 0,
        'rows_exported', 0,
        'execution_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer
      );
    END;
  END IF;

  -- Export based on type
  IF p_export_type = 'tickets' THEN
    -- Count total matching tickets first (before pagination)
    SELECT COUNT(*) INTO v_row_count
    FROM tickets t
    WHERE (v_batch_uuid IS NULL OR t.batch_id = v_batch_uuid)
      AND (v_agent_uuid IS NULL OR t.assigned_agent = v_agent_uuid)
      AND (p_filter = 'all' 
           OR (p_filter = 'outstanding' AND LOWER(t.status) != 'resolved')
           OR (p_filter = 'resolved' AND LOWER(t.status) = 'resolved')
           OR (p_filter = 'open' AND LOWER(t.status) = 'open')
           OR (p_filter = 'in_progress' AND LOWER(t.status) = 'in progress'))
      AND (p_start_date IS NULL OR t.created_at >= p_start_date::timestamptz)
      AND (p_end_date IS NULL OR t.created_at <= (p_end_date::date + interval '1 day'))
      AND (NOT p_worked_only OR (
        t.call_notes IS NOT NULL AND t.call_notes != ''
        OR LOWER(t.status) != 'open'
        OR EXISTS (SELECT 1 FROM payments p WHERE p.ticket_id = t.id)
      ));

    -- Get all matching tickets with agent names
    SELECT json_agg(row_to_json(ticket_data) ORDER BY created_at DESC), COUNT(*) INTO v_result, v_exported_count
    FROM (
      SELECT 
        t.id,
        t.nrc_number,
        t.customer_name,
        t.mobile_number,
        t.amount_owed,
        t.status,
        t.priority,
        t.call_notes,
        t.ticket_arrear_status,
        t.ticket_payment_status,
        t.employer_reason_for_arrears,
        t.created_at,
        t.updated_at,
        t.resolved_date,
        t.batch_id,
        b.name as batch_name,
        COALESCE(pr.display_name, pr.full_name, 'Unassigned') as agent_name,
        t.assigned_agent as agent_id,
        mc.employer_name,
        mc.branch_name,
        mc.loan_consultant,
        mc.tenure,
        COALESCE((SELECT SUM(pay.amount) FROM payments pay WHERE pay.ticket_id = t.id), 0) as total_paid
      FROM tickets t
      LEFT JOIN profiles pr ON t.assigned_agent = pr.id
      LEFT JOIN batches b ON t.batch_id = b.id
      LEFT JOIN master_customers mc ON t.master_customer_id = mc.id
      WHERE (v_batch_uuid IS NULL OR t.batch_id = v_batch_uuid)
        AND (v_agent_uuid IS NULL OR t.assigned_agent = v_agent_uuid)
        AND (p_filter = 'all' 
             OR (p_filter = 'outstanding' AND LOWER(t.status) != 'resolved')
             OR (p_filter = 'resolved' AND LOWER(t.status) = 'resolved')
             OR (p_filter = 'open' AND LOWER(t.status) = 'open')
             OR (p_filter = 'in_progress' AND LOWER(t.status) = 'in progress'))
        AND (p_start_date IS NULL OR t.created_at >= p_start_date::timestamptz)
        AND (p_end_date IS NULL OR t.created_at <= (p_end_date::date + interval '1 day'))
        AND (NOT p_worked_only OR (
          t.call_notes IS NOT NULL AND t.call_notes != ''
          OR LOWER(t.status) != 'open'
          OR EXISTS (SELECT 1 FROM payments p WHERE p.ticket_id = t.id)
        ))
      ORDER BY t.created_at DESC
      LIMIT p_limit OFFSET p_offset
    ) ticket_data;

  ELSIF p_export_type = 'master_customers' THEN
    -- Count master customers
    SELECT COUNT(*) INTO v_row_count 
    FROM master_customers mc
    WHERE (v_agent_uuid IS NULL OR mc.assigned_agent = v_agent_uuid);
    
    -- Get all master customers with agent names
    SELECT json_agg(row_to_json(customer_data) ORDER BY name), COUNT(*) INTO v_result, v_exported_count
    FROM (
      SELECT 
        mc.id,
        mc.nrc_number,
        mc.name,
        mc.mobile_number,
        mc.employer_name,
        mc.employer_subdivision,
        mc.branch_name,
        mc.loan_consultant,
        mc.tenure,
        mc.total_owed,
        mc.total_paid,
        mc.outstanding_balance,
        mc.payment_status,
        mc.arrear_status,
        mc.call_notes,
        mc.loan_book_arrears,
        mc.loan_book_last_payment_date,
        mc.next_of_kin_name,
        mc.next_of_kin_contact,
        mc.workplace_contact,
        mc.workplace_destination,
        mc.created_at,
        mc.updated_at,
        COALESCE(pr.display_name, pr.full_name, 'Unassigned') as agent_name
      FROM master_customers mc
      LEFT JOIN profiles pr ON mc.assigned_agent = pr.id
      WHERE (v_agent_uuid IS NULL OR mc.assigned_agent = v_agent_uuid)
      ORDER BY mc.name
      LIMIT p_limit OFFSET p_offset
    ) customer_data;

  ELSIF p_export_type = 'batch_customers' THEN
    -- Count batch customers with filters
    SELECT COUNT(*) INTO v_row_count
    FROM batch_customers bc
    WHERE (v_batch_uuid IS NULL OR bc.batch_id = v_batch_uuid)
      AND (v_agent_uuid IS NULL OR bc.assigned_agent_id = v_agent_uuid);
    
    -- Get batch customers with agent and batch names
    SELECT json_agg(row_to_json(bc_data) ORDER BY name), COUNT(*) INTO v_result, v_exported_count
    FROM (
      SELECT 
        bc.id,
        bc.nrc_number,
        bc.name,
        bc.mobile_number,
        bc.amount_owed,
        bc.employer_name,
        bc.employer_subdivision,
        bc.branch_name,
        bc.loan_consultant,
        bc.tenure,
        bc.arrear_status,
        bc.reason_for_arrears,
        bc.last_payment_date,
        bc.created_at,
        b.name as batch_name,
        COALESCE(pr.display_name, pr.full_name, 'Unassigned') as agent_name,
        bc.assigned_agent_id as agent_id
      FROM batch_customers bc
      LEFT JOIN profiles pr ON bc.assigned_agent_id = pr.id
      LEFT JOIN batches b ON bc.batch_id = b.id
      WHERE (v_batch_uuid IS NULL OR bc.batch_id = v_batch_uuid)
        AND (v_agent_uuid IS NULL OR bc.assigned_agent_id = v_agent_uuid)
      ORDER BY bc.name
      LIMIT p_limit OFFSET p_offset
    ) bc_data;
  END IF;

  -- Calculate execution time
  v_execution_time_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer;

  -- Return result with validation
  RETURN json_build_object(
    'success', true,
    'export_type', p_export_type,
    'filter', p_filter,
    'rows_expected', COALESCE(v_row_count, 0),
    'rows_exported', COALESCE(v_exported_count, 0),
    'exported_at', now(),
    'exported_by', auth.uid(),
    'execution_time_ms', v_execution_time_ms,
    'data', COALESCE(v_result, '[]'::json)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', false,
    'error', SQLERRM,
    'rows_expected', 0,
    'rows_exported', 0,
    'execution_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer
  );
END;
$function$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_admin_full_export(text, text, text, text, text, text, boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_full_export(text, text, text, text, text, text, boolean, integer, integer) TO anon;

-- Add comment for documentation
COMMENT ON FUNCTION public.get_admin_full_export IS 'Unified admin export function. Supports: tickets, master_customers, batch_customers. All parameters are optional with defaults. Example: SELECT get_admin_full_export(''tickets'', ''all'', NULL, NULL, ''2024-01-01'', ''2024-12-31'', false);';