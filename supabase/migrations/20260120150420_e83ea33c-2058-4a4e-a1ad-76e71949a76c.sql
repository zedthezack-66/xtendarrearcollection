
-- Fix get_admin_full_export - CTEs must be used within single statement
CREATE OR REPLACE FUNCTION public.get_admin_full_export(
  p_export_type TEXT DEFAULT 'tickets',
  p_filter TEXT DEFAULT 'all',
  p_batch_id TEXT DEFAULT '',
  p_agent_id TEXT DEFAULT '',
  p_start_date TEXT DEFAULT '',
  p_end_date TEXT DEFAULT '',
  p_worked_only BOOLEAN DEFAULT FALSE,
  p_limit INTEGER DEFAULT NULL,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_data JSON;
  v_rows_expected INTEGER := 0;
  v_rows_exported INTEGER := 0;
  v_start TIMESTAMPTZ;
  v_batch_uuid UUID := NULL;
  v_agent_uuid UUID := NULL;
  v_start_ts TIMESTAMPTZ := NULL;
  v_end_ts TIMESTAMPTZ := NULL;
  v_user_id UUID;
BEGIN
  v_start := clock_timestamp();
  v_user_id := auth.uid();
  
  -- Parse optional UUIDs safely
  IF p_batch_id IS NOT NULL AND p_batch_id <> '' THEN
    BEGIN
      v_batch_uuid := p_batch_id::UUID;
    EXCEPTION WHEN OTHERS THEN
      v_batch_uuid := NULL;
    END;
  END IF;
  
  IF p_agent_id IS NOT NULL AND p_agent_id <> '' THEN
    BEGIN
      v_agent_uuid := p_agent_id::UUID;
    EXCEPTION WHEN OTHERS THEN
      v_agent_uuid := NULL;
    END;
  END IF;
  
  -- Parse date range safely
  IF p_start_date IS NOT NULL AND p_start_date <> '' THEN
    BEGIN
      v_start_ts := p_start_date::DATE;
    EXCEPTION WHEN OTHERS THEN
      v_start_ts := NULL;
    END;
  END IF;
  
  IF p_end_date IS NOT NULL AND p_end_date <> '' THEN
    BEGIN
      v_end_ts := (p_end_date::DATE + INTERVAL '1 day' - INTERVAL '1 second');
    EXCEPTION WHEN OTHERS THEN
      v_end_ts := NULL;
    END;
  END IF;

  -- TICKETS EXPORT
  IF p_export_type = 'tickets' THEN
    -- Count first
    SELECT COUNT(*) INTO v_rows_expected
    FROM tickets t
    WHERE 1=1
      AND (v_batch_uuid IS NULL OR t.batch_id = v_batch_uuid)
      AND (v_agent_uuid IS NULL OR t.assigned_agent = v_agent_uuid)
      AND (p_filter = 'all' 
           OR (p_filter = 'open' AND LOWER(t.status) = 'open')
           OR (p_filter = 'in_progress' AND LOWER(t.status) = 'in_progress')
           OR (p_filter = 'resolved' AND LOWER(t.status) = 'resolved')
           OR (p_filter = 'outstanding' AND LOWER(t.status) IN ('open', 'in_progress'))
      )
      AND (v_start_ts IS NULL OR t.created_at >= v_start_ts)
      AND (v_end_ts IS NULL OR t.created_at <= v_end_ts)
      AND (NOT p_worked_only OR (t.call_notes IS NOT NULL AND t.call_notes <> ''));
    
    -- Build export data
    SELECT json_agg(row_to_json(export_row))
    INTO v_data
    FROM (
      SELECT 
        COALESCE(t.nrc_number, '') AS nrc_number,
        COALESCE(t.customer_name, '') AS customer_name,
        COALESCE(t.mobile_number, '') AS mobile_number,
        COALESCE(t.amount_owed, 0) AS amount_owed,
        COALESCE(payment_totals.total_paid, 0) AS total_paid,
        GREATEST(COALESCE(t.amount_owed, 0) - COALESCE(payment_totals.total_paid, 0), 0) AS outstanding_balance,
        COALESCE(t.status, 'open') AS status,
        COALESCE(t.priority, 'medium') AS priority,
        COALESCE(t.call_notes, '') AS call_notes,
        COALESCE(t.ticket_arrear_status, '') AS ticket_arrear_status,
        COALESCE(t.ticket_payment_status, '') AS ticket_payment_status,
        COALESCE(t.employer_reason_for_arrears, '') AS employer_reason_for_arrears,
        COALESCE(p.display_name, p.full_name, 'Unassigned') AS agent_name,
        COALESCE(b.name, 'No Batch') AS batch_name,
        COALESCE(mc.employer_name, '') AS employer_name,
        COALESCE(mc.branch_name, '') AS branch_name,
        COALESCE(mc.loan_consultant, '') AS loan_consultant,
        COALESCE(mc.loan_account_number, '') AS loan_account_number,
        COALESCE(mc.next_of_kin_name, '') AS next_of_kin_name,
        COALESCE(mc.next_of_kin_contact, '') AS next_of_kin_contact,
        COALESCE(mc.workplace_contact, '') AS workplace_contact,
        COALESCE(mc.loan_book_arrears, 0) AS loan_book_arrears,
        TO_CHAR(t.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
        TO_CHAR(t.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at,
        CASE WHEN t.resolved_date IS NOT NULL 
          THEN TO_CHAR(t.resolved_date, 'YYYY-MM-DD HH24:MI') 
          ELSE '' 
        END AS resolved_date
      FROM tickets t
      LEFT JOIN profiles p ON t.assigned_agent = p.id
      LEFT JOIN batches b ON t.batch_id = b.id
      LEFT JOIN master_customers mc ON t.master_customer_id = mc.id
      LEFT JOIN (
        SELECT ticket_id, COALESCE(SUM(amount), 0) AS total_paid
        FROM payments WHERE ticket_id IS NOT NULL
        GROUP BY ticket_id
      ) payment_totals ON t.id = payment_totals.ticket_id
      WHERE 1=1
        AND (v_batch_uuid IS NULL OR t.batch_id = v_batch_uuid)
        AND (v_agent_uuid IS NULL OR t.assigned_agent = v_agent_uuid)
        AND (p_filter = 'all' 
             OR (p_filter = 'open' AND LOWER(t.status) = 'open')
             OR (p_filter = 'in_progress' AND LOWER(t.status) = 'in_progress')
             OR (p_filter = 'resolved' AND LOWER(t.status) = 'resolved')
             OR (p_filter = 'outstanding' AND LOWER(t.status) IN ('open', 'in_progress'))
        )
        AND (v_start_ts IS NULL OR t.created_at >= v_start_ts)
        AND (v_end_ts IS NULL OR t.created_at <= v_end_ts)
        AND (NOT p_worked_only OR (t.call_notes IS NOT NULL AND t.call_notes <> ''))
      ORDER BY t.amount_owed DESC
      LIMIT COALESCE(p_limit, 10000)
      OFFSET p_offset
    ) export_row;
    
    v_rows_exported := COALESCE(json_array_length(v_data), 0);

  -- MASTER_CUSTOMERS EXPORT
  ELSIF p_export_type = 'master_customers' THEN
    SELECT COUNT(*) INTO v_rows_expected
    FROM master_customers mc
    WHERE 1=1
      AND (p_filter = 'all' 
           OR (p_filter = 'outstanding' AND mc.outstanding_balance > 0)
           OR (p_filter = 'resolved' AND mc.outstanding_balance <= 0)
      )
      AND (v_start_ts IS NULL OR mc.created_at >= v_start_ts)
      AND (v_end_ts IS NULL OR mc.created_at <= v_end_ts);
    
    SELECT json_agg(row_to_json(export_row))
    INTO v_data
    FROM (
      SELECT 
        COALESCE(mc.nrc_number, '') AS nrc_number,
        COALESCE(mc.name, '') AS customer_name,
        COALESCE(mc.mobile_number, '') AS mobile_number,
        COALESCE(mc.employer_name, '') AS employer_name,
        COALESCE(mc.employer_subdivision, '') AS employer_subdivision,
        COALESCE(mc.branch_name, '') AS branch_name,
        COALESCE(mc.loan_consultant, '') AS loan_consultant,
        COALESCE(mc.loan_account_number, '') AS loan_account_number,
        COALESCE(mc.tenure, '') AS tenure,
        COALESCE(mc.arrear_status, '') AS arrear_status,
        COALESCE(mc.reason_for_arrears, '') AS reason_for_arrears,
        COALESCE(mc.payment_status, 'pending') AS payment_status,
        COALESCE(mc.total_owed, 0) AS total_owed,
        COALESCE(mc.total_paid, 0) AS total_paid,
        COALESCE(mc.outstanding_balance, 0) AS outstanding_balance,
        COALESCE(mc.loan_book_arrears, 0) AS loan_book_arrears,
        COALESCE(mc.call_notes, '') AS call_notes,
        COALESCE(mc.next_of_kin_name, '') AS next_of_kin_name,
        COALESCE(mc.next_of_kin_contact, '') AS next_of_kin_contact,
        COALESCE(mc.workplace_contact, '') AS workplace_contact,
        COALESCE(mc.workplace_destination, '') AS workplace_destination,
        CASE WHEN mc.last_payment_date IS NOT NULL 
          THEN TO_CHAR(mc.last_payment_date, 'YYYY-MM-DD') 
          ELSE '' 
        END AS last_payment_date,
        CASE WHEN mc.loan_book_last_payment_date IS NOT NULL 
          THEN TO_CHAR(mc.loan_book_last_payment_date, 'YYYY-MM-DD') 
          ELSE '' 
        END AS loan_book_last_payment_date,
        TO_CHAR(mc.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
        TO_CHAR(mc.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at
      FROM master_customers mc
      WHERE 1=1
        AND (p_filter = 'all' 
             OR (p_filter = 'outstanding' AND mc.outstanding_balance > 0)
             OR (p_filter = 'resolved' AND mc.outstanding_balance <= 0)
        )
        AND (v_start_ts IS NULL OR mc.created_at >= v_start_ts)
        AND (v_end_ts IS NULL OR mc.created_at <= v_end_ts)
      ORDER BY mc.outstanding_balance DESC
      LIMIT COALESCE(p_limit, 10000)
      OFFSET p_offset
    ) export_row;
    
    v_rows_exported := COALESCE(json_array_length(v_data), 0);

  -- BATCH_CUSTOMERS EXPORT
  ELSIF p_export_type = 'batch_customers' THEN
    SELECT COUNT(*) INTO v_rows_expected
    FROM batch_customers bc
    WHERE 1=1
      AND (v_batch_uuid IS NULL OR bc.batch_id = v_batch_uuid)
      AND (v_agent_uuid IS NULL OR bc.assigned_agent_id = v_agent_uuid)
      AND (v_start_ts IS NULL OR bc.created_at >= v_start_ts)
      AND (v_end_ts IS NULL OR bc.created_at <= v_end_ts);
    
    SELECT json_agg(row_to_json(export_row))
    INTO v_data
    FROM (
      SELECT 
        COALESCE(bc.nrc_number, '') AS nrc_number,
        COALESCE(bc.name, '') AS customer_name,
        COALESCE(bc.mobile_number, '') AS mobile_number,
        COALESCE(bc.amount_owed, 0) AS amount_owed,
        COALESCE(bc.arrear_status, '') AS arrear_status,
        COALESCE(bc.reason_for_arrears, '') AS reason_for_arrears,
        COALESCE(bc.employer_name, '') AS employer_name,
        COALESCE(bc.employer_subdivision, '') AS employer_subdivision,
        COALESCE(bc.branch_name, '') AS branch_name,
        COALESCE(bc.loan_consultant, '') AS loan_consultant,
        COALESCE(bc.tenure, '') AS tenure,
        CASE WHEN bc.last_payment_date IS NOT NULL 
          THEN TO_CHAR(bc.last_payment_date, 'YYYY-MM-DD') 
          ELSE '' 
        END AS last_payment_date,
        COALESCE(p.display_name, p.full_name, 'Unassigned') AS agent_name,
        COALESCE(b.name, 'No Batch') AS batch_name,
        TO_CHAR(bc.created_at, 'YYYY-MM-DD HH24:MI') AS created_at
      FROM batch_customers bc
      LEFT JOIN profiles p ON bc.assigned_agent_id = p.id
      LEFT JOIN batches b ON bc.batch_id = b.id
      WHERE 1=1
        AND (v_batch_uuid IS NULL OR bc.batch_id = v_batch_uuid)
        AND (v_agent_uuid IS NULL OR bc.assigned_agent_id = v_agent_uuid)
        AND (v_start_ts IS NULL OR bc.created_at >= v_start_ts)
        AND (v_end_ts IS NULL OR bc.created_at <= v_end_ts)
      ORDER BY bc.amount_owed DESC
      LIMIT COALESCE(p_limit, 10000)
      OFFSET p_offset
    ) export_row;
    
    v_rows_exported := COALESCE(json_array_length(v_data), 0);

  ELSE
    RETURN json_build_object(
      'success', FALSE,
      'error', 'Invalid export type: ' || p_export_type,
      'rows_expected', 0,
      'rows_exported', 0
    );
  END IF;

  RETURN json_build_object(
    'success', TRUE,
    'export_type', p_export_type,
    'filter', p_filter,
    'rows_expected', v_rows_expected,
    'rows_exported', v_rows_exported,
    'exported_at', TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    'exported_by', v_user_id,
    'execution_time_ms', EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start)),
    'data', COALESCE(v_data, '[]'::JSON)
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', FALSE,
    'error', SQLERRM,
    'rows_expected', v_rows_expected,
    'rows_exported', 0
  );
END;
$$;
