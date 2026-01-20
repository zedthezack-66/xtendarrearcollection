-- Create get_admin_full_export RPC for admin-only system-wide exports
-- This function bypasses RLS to get ALL data regardless of who uploaded it

CREATE OR REPLACE FUNCTION public.get_admin_full_export(
  p_export_type TEXT DEFAULT 'tickets',
  p_filter TEXT DEFAULT 'all',
  p_batch_id UUID DEFAULT NULL,
  p_agent_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_worked_only BOOLEAN DEFAULT FALSE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_rows_expected INT;
  v_rows_exported INT;
  v_user_id UUID;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();
  
  -- Only admins can use this function
  IF NOT has_role(v_user_id, 'admin') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Access denied. Admin privileges required.',
      'rows_expected', 0,
      'rows_exported', 0,
      'data', '[]'::json
    );
  END IF;

  -- Export tickets
  IF p_export_type = 'tickets' THEN
    WITH filtered_tickets AS (
      SELECT 
        t.id,
        t.customer_name,
        t.nrc_number,
        t.mobile_number,
        t.amount_owed,
        t.status,
        t.priority,
        t.batch_id,
        b.name AS batch_name,
        t.assigned_agent,
        p.display_name AS agent_name,
        t.call_notes,
        mc.total_owed,
        mc.total_paid,
        mc.outstanding_balance,
        mc.payment_status,
        mc.branch_name,
        mc.employer_name,
        mc.employer_subdivision,
        mc.loan_consultant,
        mc.tenure,
        mc.arrear_status AS master_arrear_status,
        mc.last_payment_date,
        mc.loan_book_last_payment_date,
        mc.next_of_kin_name,
        mc.next_of_kin_contact,
        mc.workplace_contact,
        mc.workplace_destination,
        t.ticket_arrear_status,
        t.ticket_payment_status,
        t.employer_reason_for_arrears,
        COALESCE((SELECT SUM(pay.amount) FROM payments pay WHERE pay.master_customer_id = t.master_customer_id), 0) AS total_collected,
        t.created_at,
        t.resolved_date
      FROM tickets t
      LEFT JOIN batches b ON t.batch_id = b.id
      LEFT JOIN master_customers mc ON t.master_customer_id = mc.id
      LEFT JOIN profiles p ON t.assigned_agent = p.id
      WHERE 1=1
        -- Batch filter: ALL tickets in that batch
        AND (p_batch_id IS NULL OR t.batch_id = p_batch_id)
        -- Agent filter: ALL tickets for that agent
        AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id)
        -- Date range filter
        AND (p_start_date IS NULL OR t.created_at::date >= p_start_date)
        AND (p_end_date IS NULL OR t.created_at::date <= p_end_date)
        -- Status filter
        AND (
          p_filter = 'all' 
          OR (p_filter = 'outstanding' AND t.status != 'Resolved')
          OR (p_filter = 'resolved' AND t.status = 'Resolved')
          OR (p_filter = 'open' AND t.status = 'Open')
          OR (p_filter = 'in_progress' AND t.status = 'In Progress')
        )
        -- Worked-only filter: has notes, payments, or status changed
        AND (
          NOT p_worked_only 
          OR t.status != 'Open' 
          OR (t.call_notes IS NOT NULL AND t.call_notes != '')
          OR EXISTS (SELECT 1 FROM payments pay WHERE pay.master_customer_id = t.master_customer_id)
        )
      ORDER BY t.created_at DESC
    )
    SELECT 
      COUNT(*)::INT INTO v_rows_expected
    FROM filtered_tickets;

    SELECT json_agg(row_to_json(ft))
    INTO v_result
    FROM (SELECT * FROM filtered_tickets) ft;

    v_rows_exported := COALESCE(json_array_length(v_result), 0);

  -- Export master customers
  ELSIF p_export_type = 'master_customers' THEN
    WITH filtered_customers AS (
      SELECT 
        mc.id,
        mc.name,
        mc.nrc_number,
        mc.mobile_number,
        mc.total_owed,
        mc.total_paid,
        mc.outstanding_balance,
        mc.payment_status,
        mc.assigned_agent,
        p.display_name AS agent_name,
        mc.call_notes,
        t.status AS ticket_status,
        COALESCE((SELECT SUM(pay.amount) FROM payments pay WHERE pay.master_customer_id = mc.id), 0) AS total_collected,
        mc.branch_name,
        mc.arrear_status,
        mc.employer_name,
        mc.employer_subdivision,
        mc.loan_consultant,
        mc.tenure,
        mc.last_payment_date,
        mc.loan_book_last_payment_date,
        mc.next_of_kin_name,
        mc.next_of_kin_contact,
        mc.workplace_contact,
        mc.workplace_destination,
        t.ticket_arrear_status,
        t.ticket_payment_status,
        t.employer_reason_for_arrears
      FROM master_customers mc
      LEFT JOIN profiles p ON mc.assigned_agent = p.id
      LEFT JOIN tickets t ON t.master_customer_id = mc.id
      WHERE 1=1
        AND (p_agent_id IS NULL OR mc.assigned_agent = p_agent_id)
        AND (p_start_date IS NULL OR mc.created_at::date >= p_start_date)
        AND (p_end_date IS NULL OR mc.created_at::date <= p_end_date)
        AND (
          p_filter = 'all' 
          OR (p_filter = 'outstanding' AND mc.payment_status != 'Fully Paid')
          OR (p_filter = 'resolved' AND mc.payment_status = 'Fully Paid')
        )
        AND (
          NOT p_worked_only 
          OR t.status != 'Open' 
          OR (mc.call_notes IS NOT NULL AND mc.call_notes != '')
          OR EXISTS (SELECT 1 FROM payments pay WHERE pay.master_customer_id = mc.id)
        )
      ORDER BY mc.created_at DESC
    )
    SELECT COUNT(*)::INT INTO v_rows_expected FROM filtered_customers;

    SELECT json_agg(row_to_json(fc))
    INTO v_result
    FROM (SELECT * FROM filtered_customers) fc;

    v_rows_exported := COALESCE(json_array_length(v_result), 0);

  -- Export batch customers
  ELSIF p_export_type = 'batch_customers' THEN
    WITH filtered_batch_customers AS (
      SELECT 
        bc.id,
        bc.batch_id,
        b.name AS batch_name,
        bc.name,
        bc.nrc_number,
        bc.mobile_number,
        bc.amount_owed,
        bc.assigned_agent_id,
        p.display_name AS agent_name,
        mc.total_paid,
        mc.outstanding_balance,
        mc.payment_status,
        mc.call_notes AS master_call_notes,
        t.status AS ticket_status,
        COALESCE((SELECT SUM(pay.amount) FROM payments pay WHERE pay.master_customer_id = bc.master_customer_id), 0) AS total_collected,
        mc.branch_name,
        bc.arrear_status,
        mc.employer_name,
        mc.employer_subdivision,
        mc.loan_consultant,
        mc.tenure,
        mc.last_payment_date,
        mc.loan_book_last_payment_date,
        mc.next_of_kin_name,
        mc.next_of_kin_contact,
        mc.workplace_contact,
        mc.workplace_destination,
        t.ticket_arrear_status,
        t.ticket_payment_status,
        t.employer_reason_for_arrears
      FROM batch_customers bc
      LEFT JOIN batches b ON bc.batch_id = b.id
      LEFT JOIN master_customers mc ON bc.master_customer_id = mc.id
      LEFT JOIN profiles p ON bc.assigned_agent_id = p.id
      LEFT JOIN tickets t ON t.master_customer_id = bc.master_customer_id AND t.batch_id = bc.batch_id
      WHERE 1=1
        -- Batch filter: ALL customers in that batch
        AND (p_batch_id IS NULL OR bc.batch_id = p_batch_id)
        -- Agent filter: ALL customers for that agent
        AND (p_agent_id IS NULL OR bc.assigned_agent_id = p_agent_id)
        AND (p_start_date IS NULL OR bc.created_at::date >= p_start_date)
        AND (p_end_date IS NULL OR bc.created_at::date <= p_end_date)
        AND (
          p_filter = 'all' 
          OR (p_filter = 'outstanding' AND (mc.payment_status IS NULL OR mc.payment_status != 'Fully Paid'))
          OR (p_filter = 'resolved' AND mc.payment_status = 'Fully Paid')
        )
        AND (
          NOT p_worked_only 
          OR (t.status IS NOT NULL AND t.status != 'Open')
          OR (mc.call_notes IS NOT NULL AND mc.call_notes != '')
          OR EXISTS (SELECT 1 FROM payments pay WHERE pay.master_customer_id = bc.master_customer_id)
        )
      ORDER BY bc.created_at DESC
    )
    SELECT COUNT(*)::INT INTO v_rows_expected FROM filtered_batch_customers;

    SELECT json_agg(row_to_json(fbc))
    INTO v_result
    FROM (SELECT * FROM filtered_batch_customers) fbc;

    v_rows_exported := COALESCE(json_array_length(v_result), 0);

  ELSE
    RETURN json_build_object(
      'success', false,
      'error', 'Invalid export type',
      'rows_expected', 0,
      'rows_exported', 0,
      'data', '[]'::json
    );
  END IF;

  -- Return result with validation
  RETURN json_build_object(
    'success', true,
    'export_type', p_export_type,
    'filter', p_filter,
    'rows_expected', v_rows_expected,
    'rows_exported', v_rows_exported,
    'exported_at', NOW(),
    'exported_by', v_user_id,
    'data', COALESCE(v_result, '[]'::json)
  );
END;
$$;