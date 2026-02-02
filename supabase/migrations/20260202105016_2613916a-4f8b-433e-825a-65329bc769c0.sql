
-- Update process_daily_loan_book_update to create payment records for loan book clearances
-- This ensures Total Collected includes both manual and loan book payments

CREATE OR REPLACE FUNCTION public.process_daily_loan_book_update(p_batch_id uuid, p_sync_data text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sync_batch_id uuid := gen_random_uuid();
  v_admin_id uuid := auth.uid();
  v_record jsonb;
  v_records jsonb[];
  v_ticket record;
  v_old_amount numeric(10,2);
  v_new_amount numeric(10,2);
  v_difference numeric(10,2);
  v_movement_type text;
  v_days_in_arrears integer;
  v_last_payment_date timestamptz;
  v_processed_count integer := 0;
  v_cleared_count integer := 0;
  v_reduced_count integer := 0;
  v_increased_count integer := 0;
  v_maintained_count integer := 0;
  v_reopened_count integer := 0;
  v_not_found_count integer := 0;
  v_total_cleared numeric(10,2) := 0;
  v_total_reduced numeric(10,2) := 0;
  v_total_increased numeric(10,2) := 0;
  v_nrc text;
  v_amount_str text;
  v_days_str text;
  v_date_str text;
BEGIN
  -- Parse JSON array from sync data
  BEGIN
    v_records := ARRAY(SELECT jsonb_array_elements(p_sync_data::jsonb));
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Invalid JSON format: ' || SQLERRM
    );
  END;

  -- Process each record
  FOREACH v_record IN ARRAY v_records
  LOOP
    -- Extract and normalize NRC
    v_nrc := UPPER(TRIM(COALESCE(v_record->>'nrc_number', v_record->>'nrcNumber', v_record->>'NRC Number', '')));
    
    IF v_nrc = '' THEN
      CONTINUE;
    END IF;

    -- Extract amount with 2 decimal precision
    v_amount_str := COALESCE(v_record->>'amount_owed', v_record->>'amountOwed', v_record->>'Amount Owed', '0');
    v_new_amount := ROUND(COALESCE(NULLIF(REGEXP_REPLACE(v_amount_str, '[^0-9.-]', '', 'g'), '')::numeric, 0), 2);

    -- Extract days in arrears
    v_days_str := COALESCE(v_record->>'days_in_arrears', v_record->>'daysInArrears', v_record->>'Days in Arrears', '');
    v_days_in_arrears := NULLIF(REGEXP_REPLACE(v_days_str, '[^0-9]', '', 'g'), '')::integer;

    -- Extract last payment date
    v_date_str := COALESCE(v_record->>'last_payment_date', v_record->>'lastPaymentDate', v_record->>'Last Payment Date - Loan Book', '');
    BEGIN
      IF v_date_str != '' AND v_date_str NOT LIKE '%N/A%' AND v_date_str NOT LIKE '%#%' THEN
        v_last_payment_date := v_date_str::timestamptz;
        -- Validate date range
        IF v_last_payment_date < '1900-01-01'::timestamptz OR v_last_payment_date > '2100-01-01'::timestamptz THEN
          v_last_payment_date := NULL;
        END IF;
      ELSE
        v_last_payment_date := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_last_payment_date := NULL;
    END;

    -- Find matching ticket in batch
    SELECT t.* INTO v_ticket
    FROM tickets t
    WHERE UPPER(TRIM(t.nrc_number)) = v_nrc
      AND (p_batch_id IS NULL OR t.batch_id = p_batch_id)
    LIMIT 1;

    IF v_ticket IS NULL THEN
      -- Log not found
      INSERT INTO arrears_sync_logs (
        sync_batch_id, admin_user_id, nrc_number, old_arrears, new_arrears,
        movement_type, loan_book_payment_date, source
      ) VALUES (
        v_sync_batch_id, v_admin_id, v_nrc, 0, v_new_amount,
        'Not Found', v_last_payment_date, 'loanbook_daily'
      );
      v_not_found_count := v_not_found_count + 1;
      CONTINUE;
    END IF;

    -- Get old amount with precision
    v_old_amount := ROUND(COALESCE(v_ticket.amount_owed, 0), 2);
    v_difference := ROUND(v_old_amount - v_new_amount, 2);

    -- Determine movement type
    IF v_old_amount > 0 AND v_new_amount = 0 THEN
      v_movement_type := 'CLEARED';
      v_cleared_count := v_cleared_count + 1;
      v_total_cleared := v_total_cleared + v_old_amount;
    ELSIF v_new_amount < v_old_amount THEN
      v_movement_type := 'REDUCED';
      v_reduced_count := v_reduced_count + 1;
      v_total_reduced := v_total_reduced + v_difference;
    ELSIF v_new_amount > v_old_amount THEN
      IF v_old_amount = 0 AND v_ticket.status IN ('Resolved', 'Arrears Cleared – Pending Confirmation') THEN
        v_movement_type := 'REOPENED';
        v_reopened_count := v_reopened_count + 1;
      ELSE
        v_movement_type := 'INCREASED';
        v_increased_count := v_increased_count + 1;
      END IF;
      v_total_increased := v_total_increased + (v_new_amount - v_old_amount);
    ELSE
      v_movement_type := 'MAINTAINED';
      v_maintained_count := v_maintained_count + 1;
    END IF;

    -- Update ticket with new amount and metadata
    UPDATE tickets SET
      amount_owed = v_new_amount,
      ticket_arrear_status = CASE 
        WHEN v_new_amount = 0 THEN 'Cleared'
        WHEN v_days_in_arrears IS NOT NULL AND v_days_in_arrears <= 30 THEN '1-30 Days'
        WHEN v_days_in_arrears IS NOT NULL AND v_days_in_arrears <= 60 THEN '31-60 Days'
        WHEN v_days_in_arrears IS NOT NULL AND v_days_in_arrears <= 90 THEN '61-90 Days'
        WHEN v_days_in_arrears IS NOT NULL THEN '90+ Days'
        ELSE ticket_arrear_status
      END,
      status = CASE
        WHEN v_new_amount = 0 THEN 'Arrears Cleared – Pending Confirmation'
        WHEN v_movement_type = 'REOPENED' THEN 'In Progress'
        ELSE status
      END,
      resolved_date = CASE
        WHEN v_movement_type = 'REOPENED' THEN NULL
        ELSE resolved_date
      END,
      updated_at = now()
    WHERE id = v_ticket.id;

    -- Update master_customer with balance changes and metadata
    UPDATE master_customers SET
      -- For CLEARED/REDUCED: increment total_paid (collected) by reduction amount
      total_paid = CASE
        WHEN v_movement_type IN ('CLEARED', 'REDUCED') THEN ROUND(total_paid + v_difference, 2)
        ELSE total_paid
      END,
      -- For INCREASED/REOPENED: increment total_owed
      total_owed = CASE
        WHEN v_movement_type IN ('INCREASED', 'REOPENED') THEN ROUND(total_owed + (v_new_amount - v_old_amount), 2)
        ELSE total_owed
      END,
      -- Recalculate outstanding balance
      outstanding_balance = CASE
        WHEN v_movement_type IN ('CLEARED', 'REDUCED') THEN ROUND(outstanding_balance - v_difference, 2)
        WHEN v_movement_type IN ('INCREASED', 'REOPENED') THEN ROUND(outstanding_balance + (v_new_amount - v_old_amount), 2)
        ELSE outstanding_balance
      END,
      -- Update loan book metadata
      loan_book_arrears = v_new_amount,
      loan_book_last_payment_date = COALESCE(v_last_payment_date, loan_book_last_payment_date),
      -- Update payment status
      payment_status = CASE
        WHEN v_new_amount = 0 THEN 'Fully Paid'
        WHEN (total_paid + CASE WHEN v_movement_type IN ('CLEARED', 'REDUCED') THEN v_difference ELSE 0 END) > 0 THEN 'Partially Paid'
        ELSE 'Not Paid'
      END,
      -- Update last_payment_date if there was a reduction/clearing
      last_payment_date = CASE
        WHEN v_movement_type IN ('CLEARED', 'REDUCED') THEN COALESCE(v_last_payment_date, now())
        ELSE last_payment_date
      END,
      updated_at = now()
    WHERE id = v_ticket.master_customer_id;

    -- CREATE PAYMENT RECORD for loan book clearances/reductions (like manual payments)
    -- This ensures Total Collected includes loan book payments
    IF v_movement_type IN ('CLEARED', 'REDUCED') AND v_difference > 0 THEN
      INSERT INTO payments (
        ticket_id,
        master_customer_id,
        amount,
        payment_date,
        payment_method,
        customer_name,
        recorded_by,
        notes
      ) VALUES (
        v_ticket.id,
        v_ticket.master_customer_id,
        v_difference,
        COALESCE(v_last_payment_date, now()),
        'Loan Book Reconciliation',
        v_ticket.customer_name,
        v_admin_id,
        'Auto-recorded from Daily Loan Book Update. Movement: ' || v_movement_type || 
        '. Old arrears: K' || v_old_amount || ', New arrears: K' || v_new_amount
      );
    END IF;

    -- Log the sync activity
    INSERT INTO arrears_sync_logs (
      sync_batch_id, admin_user_id, nrc_number, master_customer_id,
      old_arrears, new_arrears, movement_type, loan_book_payment_date,
      ticket_resolved, source
    ) VALUES (
      v_sync_batch_id, v_admin_id, v_nrc, v_ticket.master_customer_id,
      v_old_amount, v_new_amount, v_movement_type, v_last_payment_date,
      (v_movement_type = 'CLEARED'), 'loanbook_daily'
    );

    v_processed_count := v_processed_count + 1;
  END LOOP;

  -- Create arrears snapshot for this sync
  PERFORM create_arrears_snapshots('loanbook_daily', v_sync_batch_id);

  RETURN json_build_object(
    'success', true,
    'sync_batch_id', v_sync_batch_id,
    'processed', v_processed_count,
    'cleared', v_cleared_count,
    'reduced', v_reduced_count,
    'increased', v_increased_count,
    'maintained', v_maintained_count,
    'reopened', v_reopened_count,
    'not_found', v_not_found_count,
    'total_cleared_amount', v_total_cleared,
    'total_reduced_amount', v_total_reduced,
    'total_increased_amount', v_total_increased
  );
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION process_daily_loan_book_update IS 
'Processes daily loan book updates. Creates payment records for cleared/reduced arrears to ensure Total Collected includes both manual and loan book payments. Updates all balances and KPIs in real-time.';
