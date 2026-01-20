-- Drop and recreate the admin export function with correct table references
DROP FUNCTION IF EXISTS public.get_admin_full_export(text, text, uuid, uuid, text, text, boolean);

CREATE OR REPLACE FUNCTION public.get_admin_full_export(
  p_export_type text DEFAULT 'tickets',
  p_filter text DEFAULT 'all',
  p_batch_id uuid DEFAULT NULL,
  p_agent_id uuid DEFAULT NULL,
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
  v_row_count integer;
  v_exported_count integer;
  v_user_role text;
BEGIN
  -- Check if user is admin
  SELECT role INTO v_user_role FROM user_roles WHERE user_id = auth.uid();
  IF v_user_role != 'admin' THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized: Admin access required');
  END IF;

  -- Export based on type
  IF p_export_type = 'tickets' THEN
    -- Count total matching tickets first
    SELECT COUNT(*) INTO v_row_count
    FROM tickets t
    WHERE (p_batch_id IS NULL OR t.batch_id = p_batch_id)
      AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id)
      AND (p_filter = 'all' 
           OR (p_filter = 'outstanding' AND t.status != 'resolved')
           OR (p_filter = 'resolved' AND t.status = 'resolved')
           OR (p_filter = 'open' AND t.status = 'open')
           OR (p_filter = 'in_progress' AND t.status = 'in_progress'))
      AND (p_start_date IS NULL OR t.created_at >= p_start_date::timestamptz)
      AND (p_end_date IS NULL OR t.created_at <= (p_end_date::date + interval '1 day'))
      AND (NOT p_worked_only OR (
        t.call_notes IS NOT NULL 
        OR t.status != 'open'
        OR EXISTS (SELECT 1 FROM payments p WHERE p.ticket_id = t.id)
      ));

    -- Get all matching tickets with agent names
    SELECT json_agg(row_to_json(ticket_data)), COUNT(*) INTO v_result, v_exported_count
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
      WHERE (p_batch_id IS NULL OR t.batch_id = p_batch_id)
        AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id)
        AND (p_filter = 'all' 
             OR (p_filter = 'outstanding' AND t.status != 'resolved')
             OR (p_filter = 'resolved' AND t.status = 'resolved')
             OR (p_filter = 'open' AND t.status = 'open')
             OR (p_filter = 'in_progress' AND t.status = 'in_progress'))
        AND (p_start_date IS NULL OR t.created_at >= p_start_date::timestamptz)
        AND (p_end_date IS NULL OR t.created_at <= (p_end_date::date + interval '1 day'))
        AND (NOT p_worked_only OR (
          t.call_notes IS NOT NULL 
          OR t.status != 'open'
          OR EXISTS (SELECT 1 FROM payments p WHERE p.ticket_id = t.id)
        ))
      ORDER BY t.created_at DESC
    ) ticket_data;

  ELSIF p_export_type = 'master_customers' THEN
    -- Count master customers
    SELECT COUNT(*) INTO v_row_count FROM master_customers;
    
    -- Get all master customers with agent names
    SELECT json_agg(row_to_json(customer_data)), COUNT(*) INTO v_result, v_exported_count
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
      ORDER BY mc.name
    ) customer_data;

  ELSIF p_export_type = 'batch_customers' THEN
    -- Count batch customers with filters
    SELECT COUNT(*) INTO v_row_count
    FROM batch_customers bc
    WHERE (p_batch_id IS NULL OR bc.batch_id = p_batch_id)
      AND (p_agent_id IS NULL OR bc.assigned_agent_id = p_agent_id);
    
    -- Get batch customers with agent and batch names
    SELECT json_agg(row_to_json(bc_data)), COUNT(*) INTO v_result, v_exported_count
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
      WHERE (p_batch_id IS NULL OR bc.batch_id = p_batch_id)
        AND (p_agent_id IS NULL OR bc.assigned_agent_id = p_agent_id)
      ORDER BY bc.name
    ) bc_data;

  ELSE
    RETURN json_build_object('success', false, 'error', 'Invalid export type');
  END IF;

  -- Return result with validation
  RETURN json_build_object(
    'success', true,
    'export_type', p_export_type,
    'filter', p_filter,
    'rows_expected', v_row_count,
    'rows_exported', COALESCE(v_exported_count, 0),
    'exported_at', now(),
    'exported_by', auth.uid(),
    'data', COALESCE(v_result, '[]'::json)
  );
END;
$$;