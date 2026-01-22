-- Drop existing function first to change signature
DROP FUNCTION IF EXISTS public.process_loan_book_sync(text);
DROP FUNCTION IF EXISTS public.process_loan_book_sync(jsonb);

-- ============================================================
-- Daily Loan Book Sync - Full NRC Coverage & Update-Batch Grade Reliability
-- ============================================================

-- 1. Create RPC to generate template with ALL NRCs (bypasses 1000 limit)
CREATE OR REPLACE FUNCTION public.get_loan_book_sync_template()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result JSONB;
  v_count INTEGER;
BEGIN
  -- Check if caller is admin
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can generate loan book sync templates';
  END IF;
  
  -- Get count first
  SELECT COUNT(*) INTO v_count FROM master_customers;
  
  -- Return ALL NRCs with current arrears data (no limit)
  SELECT jsonb_build_object(
    'success', true,
    'total_count', v_count,
    'customers', COALESCE(jsonb_agg(
      jsonb_build_object(
        'nrc_number', mc.nrc_number,
        'name', mc.name,
        'current_arrears', COALESCE(mc.loan_book_arrears, mc.outstanding_balance, 0),
        'current_last_payment_date', mc.loan_book_last_payment_date
      ) ORDER BY mc.nrc_number
    ), '[]'::jsonb)
  ) INTO v_result
  FROM master_customers mc;
  
  RETURN v_result;
END;
$$;

-- 2. Upgraded process_loan_book_sync with update-batch grade reliability
CREATE OR REPLACE FUNCTION public.process_loan_book_sync(
  p_sync_data TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sync_batch_id UUID;
  v_admin_id UUID;
  v_sync_array JSONB;
  v_customer RECORD;
  v_upload_row RECORD;
  v_old_arrears NUMERIC;
  v_new_arrears NUMERIC;
  v_new_arrears_raw TEXT;
  v_movement_type TEXT;
  v_payment_date TIMESTAMP WITH TIME ZONE;
  v_payment_date_raw TEXT;
  v_processed INTEGER := 0;
  v_updated INTEGER := 0;
  v_skipped INTEGER := 0;
  v_not_found INTEGER := 0;
  v_pending_confirmation INTEGER := 0;
  v_errors TEXT[] := '{}';
  v_has_upload_data BOOLEAN;
  v_ticket RECORD;
  v_arrears_changed BOOLEAN;
BEGIN
  -- Check if caller is admin
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can perform loan book sync';
  END IF;
  
  v_admin_id := auth.uid();
  v_sync_batch_id := gen_random_uuid();
  
  -- Parse input - handle string vs JSONB
  BEGIN
    IF p_sync_data IS NULL OR p_sync_data = '' THEN
      v_sync_array := '[]'::jsonb;
    ELSE
      v_sync_array := p_sync_data::jsonb;
    END IF;
    
    IF jsonb_typeof(v_sync_array) != 'array' THEN
      v_sync_array := jsonb_build_array(v_sync_array);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid JSON format: ' || SQLERRM,
      'sync_batch_id', v_sync_batch_id
    );
  END;
  
  -- Create temp table for uploaded data with parsed values
  CREATE TEMP TABLE IF NOT EXISTS temp_sync_upload (
    nrc_number TEXT PRIMARY KEY,
    arrears_amount NUMERIC,
    last_payment_date TIMESTAMP WITH TIME ZONE,
    is_empty_arrears BOOLEAN DEFAULT TRUE
  ) ON COMMIT DROP;
  
  TRUNCATE temp_sync_upload;
  
  -- Parse and insert uploaded data into temp table
  FOR v_upload_row IN SELECT * FROM jsonb_array_elements(v_sync_array)
  LOOP
    DECLARE
      v_nrc TEXT;
      v_arrears NUMERIC := NULL;
      v_date TIMESTAMP WITH TIME ZONE := NULL;
      v_is_empty BOOLEAN := TRUE;
    BEGIN
      v_nrc := NULLIF(TRIM(v_upload_row.value->>'nrc_number'), '');
      
      IF v_nrc IS NULL THEN
        CONTINUE;
      END IF;
      
      -- Parse arrears amount with fault tolerance
      v_new_arrears_raw := NULLIF(TRIM(UPPER(v_upload_row.value->>'arrears_amount')), '');
      IF v_new_arrears_raw IS NOT NULL 
         AND v_new_arrears_raw NOT IN ('#N/A', 'N/A', 'NULL', '') THEN
        BEGIN
          v_arrears := v_new_arrears_raw::NUMERIC;
          v_is_empty := FALSE;
        EXCEPTION WHEN OTHERS THEN
          v_arrears := NULL;
          v_is_empty := TRUE;
        END;
      END IF;
      
      -- Parse date with fault tolerance (1900-2100 range)
      v_payment_date_raw := NULLIF(TRIM(v_upload_row.value->>'last_payment_date'), '');
      IF v_payment_date_raw IS NOT NULL 
         AND UPPER(v_payment_date_raw) NOT IN ('#N/A', 'N/A', 'NULL', '') THEN
        BEGIN
          v_date := v_payment_date_raw::TIMESTAMP WITH TIME ZONE;
          IF EXTRACT(YEAR FROM v_date) < 1900 OR EXTRACT(YEAR FROM v_date) > 2100 THEN
            v_date := NULL;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_date := NULL;
        END;
      END IF;
      
      INSERT INTO temp_sync_upload (nrc_number, arrears_amount, last_payment_date, is_empty_arrears)
      VALUES (v_nrc, v_arrears, v_date, v_is_empty)
      ON CONFLICT (nrc_number) DO UPDATE SET
        arrears_amount = EXCLUDED.arrears_amount,
        last_payment_date = EXCLUDED.last_payment_date,
        is_empty_arrears = EXCLUDED.is_empty_arrears;
    END;
  END LOOP;
  
  -- Process ALL system NRCs with LEFT JOIN to uploaded data
  FOR v_customer IN 
    SELECT 
      mc.id,
      mc.nrc_number,
      mc.name,
      COALESCE(mc.loan_book_arrears, mc.outstanding_balance, 0) AS current_arrears,
      mc.loan_book_last_payment_date,
      ts.arrears_amount AS upload_arrears,
      ts.last_payment_date AS upload_date,
      ts.is_empty_arrears,
      (ts.nrc_number IS NOT NULL) AS has_upload_data
    FROM master_customers mc
    LEFT JOIN temp_sync_upload ts ON mc.nrc_number = ts.nrc_number
  LOOP
    v_processed := v_processed + 1;
    v_old_arrears := v_customer.current_arrears;
    v_arrears_changed := FALSE;
    
    -- Determine new arrears: uploaded value takes precedence, else keep current
    IF v_customer.has_upload_data AND NOT v_customer.is_empty_arrears THEN
      v_new_arrears := v_customer.upload_arrears;
      v_payment_date := COALESCE(v_customer.upload_date, v_customer.loan_book_last_payment_date);
      v_arrears_changed := (v_new_arrears IS DISTINCT FROM v_old_arrears);
    ELSIF v_customer.has_upload_data AND v_customer.is_empty_arrears THEN
      v_new_arrears := v_old_arrears;
      v_payment_date := COALESCE(v_customer.upload_date, v_customer.loan_book_last_payment_date);
      v_arrears_changed := FALSE;
    ELSE
      v_new_arrears := v_old_arrears;
      v_payment_date := v_customer.loan_book_last_payment_date;
      v_arrears_changed := FALSE;
    END IF;
    
    -- Determine movement type
    IF v_old_arrears > 0 AND v_new_arrears = 0 THEN
      v_movement_type := 'Cleared';
    ELSIF v_new_arrears > v_old_arrears THEN
      v_movement_type := 'Increased';
    ELSIF v_new_arrears < v_old_arrears AND v_new_arrears > 0 THEN
      v_movement_type := 'Reduced';
    ELSE
      v_movement_type := 'Maintained';
    END IF;
    
    -- Only update if there's actual change
    IF v_arrears_changed THEN
      UPDATE master_customers
      SET 
        loan_book_arrears = v_new_arrears,
        outstanding_balance = v_new_arrears,
        loan_book_last_payment_date = COALESCE(v_payment_date, loan_book_last_payment_date),
        updated_at = NOW()
      WHERE id = v_customer.id;
      
      UPDATE tickets
      SET 
        amount_owed = v_new_arrears,
        updated_at = NOW()
      WHERE master_customer_id = v_customer.id;
      
      -- Handle cleared arrears (AGENT CONFIRMATION REQUIRED)
      IF v_movement_type = 'Cleared' THEN
        UPDATE tickets
        SET 
          status = 'Pending Confirmation',
          updated_at = NOW()
        WHERE master_customer_id = v_customer.id
          AND status NOT IN ('Resolved', 'Pending Confirmation');
        
        v_pending_confirmation := v_pending_confirmation + 1;
        
        FOR v_ticket IN 
          SELECT t.id, t.assigned_agent, t.customer_name
          FROM tickets t
          WHERE t.master_customer_id = v_customer.id
            AND t.assigned_agent IS NOT NULL
        LOOP
          INSERT INTO agent_notifications (
            agent_id, type, title, message,
            related_customer_id, related_ticket_id
          ) VALUES (
            v_ticket.assigned_agent::uuid,
            'arrears_cleared',
            'Arrears Cleared - Confirmation Required',
            format('Arrears for %s have been cleared (K%s → K0). Please confirm resolution.', 
              v_ticket.customer_name, ROUND(v_old_arrears, 2)),
            v_customer.id,
            v_ticket.id
          );
        END LOOP;
        
      ELSIF v_movement_type IN ('Increased', 'Reduced') THEN
        FOR v_ticket IN 
          SELECT t.id, t.assigned_agent, t.customer_name
          FROM tickets t
          WHERE t.master_customer_id = v_customer.id
            AND t.assigned_agent IS NOT NULL
        LOOP
          INSERT INTO agent_notifications (
            agent_id, type, title, message,
            related_customer_id, related_ticket_id
          ) VALUES (
            v_ticket.assigned_agent::uuid,
            CASE WHEN v_movement_type = 'Increased' THEN 'arrears_increased' ELSE 'arrears_reduced' END,
            format('Arrears %s', v_movement_type),
            format('%s arrears changed: K%s → K%s', 
              v_ticket.customer_name, ROUND(v_old_arrears, 2), ROUND(v_new_arrears, 2)),
            v_customer.id,
            v_ticket.id
          );
        END LOOP;
      END IF;
      
      v_updated := v_updated + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
    
    -- Log ALL movements for audit
    INSERT INTO arrears_sync_logs (
      sync_batch_id, admin_user_id, nrc_number, master_customer_id,
      old_arrears, new_arrears, movement_type, loan_book_payment_date, 
      ticket_resolved, source
    ) VALUES (
      v_sync_batch_id, v_admin_id, v_customer.nrc_number, v_customer.id,
      v_old_arrears, v_new_arrears, v_movement_type, v_payment_date,
      FALSE, 'daily_sync'
    );
  END LOOP;
  
  -- Create arrears snapshots for analytics
  PERFORM create_arrears_snapshots('daily_sync', v_sync_batch_id::text);
  
  RETURN jsonb_build_object(
    'success', true,
    'sync_batch_id', v_sync_batch_id,
    'processed', v_processed,
    'updated', v_updated,
    'skipped', v_skipped,
    'not_found', v_not_found,
    'pending_confirmation', v_pending_confirmation,
    'errors', v_errors
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_loan_book_sync_template() TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_loan_book_sync(TEXT) TO authenticated;