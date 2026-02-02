-- Create process_daily_loan_book_update RPC 
-- Movement-aware logic with BLOCKED reopening (Old=0 → New>0 is forbidden)
CREATE OR REPLACE FUNCTION public.process_daily_loan_book_update(
  p_batch_id UUID,
  p_sync_data TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sync_batch_id UUID := gen_random_uuid();
  v_data JSONB;
  v_record JSONB;
  v_nrc TEXT;
  v_new_arrears NUMERIC;
  v_days_in_arrears INTEGER;
  v_last_payment_date TEXT;
  v_old_arrears NUMERIC;
  v_ticket_id UUID;
  v_ticket_status TEXT;
  v_master_customer_id UUID;
  v_agent_id UUID;
  v_movement_type TEXT;
  v_diff NUMERIC;
  v_processed INTEGER := 0;
  v_updated INTEGER := 0;
  v_maintained INTEGER := 0;
  v_cleared INTEGER := 0;
  v_reduced INTEGER := 0;
  v_increased INTEGER := 0;
  v_blocked INTEGER := 0;
  v_not_found INTEGER := 0;
  v_errors TEXT[] := ARRAY[]::TEXT[];
  v_admin_id UUID;
BEGIN
  -- Get current user for audit
  v_admin_id := auth.uid();
  
  -- Parse JSON data
  BEGIN
    v_data := p_sync_data::JSONB;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Invalid JSON data'
    );
  END;

  -- Process each record
  FOR v_record IN SELECT * FROM jsonb_array_elements(v_data)
  LOOP
    BEGIN
      v_processed := v_processed + 1;
      
      -- Extract NRC (required)
      v_nrc := NULLIF(TRIM(v_record->>'nrc_number'), '');
      IF v_nrc IS NULL THEN
        v_errors := array_append(v_errors, 'Row ' || v_processed || ': Missing NRC');
        CONTINUE;
      END IF;
      
      -- Extract new arrears amount (null means skip update)
      v_new_arrears := NULL;
      IF v_record->>'arrears_amount' IS NOT NULL AND TRIM(v_record->>'arrears_amount') != '' THEN
        BEGIN
          v_new_arrears := (v_record->>'arrears_amount')::NUMERIC;
        EXCEPTION WHEN OTHERS THEN
          v_new_arrears := NULL;
        END;
      END IF;
      
      -- If no arrears value provided, skip this record (no-op)
      IF v_new_arrears IS NULL THEN
        v_maintained := v_maintained + 1;
        CONTINUE;
      END IF;
      
      -- Extract optional fields
      v_days_in_arrears := NULL;
      IF v_record->>'days_in_arrears' IS NOT NULL THEN
        BEGIN
          v_days_in_arrears := (v_record->>'days_in_arrears')::INTEGER;
        EXCEPTION WHEN OTHERS THEN
          v_days_in_arrears := NULL;
        END;
      END IF;
      
      v_last_payment_date := NULLIF(TRIM(v_record->>'last_payment_date'), '');
      
      -- Find the ticket in this specific batch
      SELECT t.id, t.amount_owed, t.status, t.master_customer_id, t.assigned_agent
      INTO v_ticket_id, v_old_arrears, v_ticket_status, v_master_customer_id, v_agent_id
      FROM tickets t
      WHERE t.batch_id = p_batch_id
        AND t.nrc_number = v_nrc
      LIMIT 1;
      
      IF v_ticket_id IS NULL THEN
        v_not_found := v_not_found + 1;
        v_errors := array_append(v_errors, 'NRC ' || v_nrc || ': Not found in batch');
        CONTINUE;
      END IF;
      
      v_old_arrears := COALESCE(v_old_arrears, 0);
      
      -- Determine movement type
      IF v_old_arrears = v_new_arrears THEN
        -- MAINTAINED: No change
        v_maintained := v_maintained + 1;
        
        -- Silent log for audit only (no notification)
        INSERT INTO arrears_sync_logs (
          sync_batch_id, nrc_number, master_customer_id, old_arrears, new_arrears, 
          movement_type, source, admin_user_id, loan_book_payment_date, ticket_resolved
        ) VALUES (
          v_sync_batch_id, v_nrc, v_master_customer_id, v_old_arrears, v_new_arrears,
          'maintained', 'loanbook_daily', v_admin_id, 
          CASE WHEN v_last_payment_date IS NOT NULL THEN v_last_payment_date::TIMESTAMPTZ ELSE NULL END,
          false
        );
        
        CONTINUE;
        
      ELSIF v_old_arrears = 0 AND v_new_arrears > 0 THEN
        -- ⚠️ BLOCKED: Cannot reopen resolved tickets from loan book
        v_blocked := v_blocked + 1;
        v_movement_type := 'blocked_reopen';
        
        -- Log as warning but do NOT update
        INSERT INTO arrears_sync_logs (
          sync_batch_id, nrc_number, master_customer_id, old_arrears, new_arrears, 
          movement_type, source, admin_user_id, loan_book_payment_date, ticket_resolved
        ) VALUES (
          v_sync_batch_id, v_nrc, v_master_customer_id, v_old_arrears, v_new_arrears,
          'blocked_reopen', 'loanbook_daily', v_admin_id, 
          CASE WHEN v_last_payment_date IS NOT NULL THEN v_last_payment_date::TIMESTAMPTZ ELSE NULL END,
          false
        );
        
        v_errors := array_append(v_errors, 'NRC ' || v_nrc || ': Blocked reopen (0→' || v_new_arrears || ')');
        CONTINUE;
        
      ELSIF v_old_arrears > 0 AND v_new_arrears = 0 THEN
        -- CLEARED: Ticket resolved
        v_movement_type := 'cleared';
        v_cleared := v_cleared + 1;
        v_diff := v_old_arrears;
        
        -- Update ticket to Resolved
        UPDATE tickets SET
          amount_owed = 0,
          status = 'Resolved',
          resolved_date = NOW(),
          updated_at = NOW()
        WHERE id = v_ticket_id;
        
        -- Update master customer balance
        UPDATE master_customers SET
          outstanding_balance = GREATEST(0, outstanding_balance - v_diff),
          loan_book_arrears = 0,
          loan_book_last_payment_date = CASE 
            WHEN v_last_payment_date IS NOT NULL THEN v_last_payment_date::TIMESTAMPTZ 
            ELSE loan_book_last_payment_date 
          END,
          updated_at = NOW()
        WHERE id = v_master_customer_id;
        
        -- Update batch_customers
        UPDATE batch_customers SET
          amount_owed = 0,
          last_payment_date = CASE 
            WHEN v_last_payment_date IS NOT NULL THEN v_last_payment_date::TIMESTAMPTZ 
            ELSE last_payment_date 
          END
        WHERE batch_id = p_batch_id AND nrc_number = v_nrc;
        
      ELSIF v_new_arrears < v_old_arrears THEN
        -- REDUCED: Partial payment detected
        v_movement_type := 'reduced';
        v_reduced := v_reduced + 1;
        v_diff := v_old_arrears - v_new_arrears;
        
        -- Update ticket (keep In Progress)
        UPDATE tickets SET
          amount_owed = v_new_arrears,
          status = 'In Progress',
          updated_at = NOW()
        WHERE id = v_ticket_id;
        
        -- Update master customer balance
        UPDATE master_customers SET
          outstanding_balance = GREATEST(0, outstanding_balance - v_diff),
          loan_book_arrears = v_new_arrears,
          loan_book_last_payment_date = CASE 
            WHEN v_last_payment_date IS NOT NULL THEN v_last_payment_date::TIMESTAMPTZ 
            ELSE loan_book_last_payment_date 
          END,
          updated_at = NOW()
        WHERE id = v_master_customer_id;
        
        -- Update batch_customers
        UPDATE batch_customers SET
          amount_owed = v_new_arrears,
          last_payment_date = CASE 
            WHEN v_last_payment_date IS NOT NULL THEN v_last_payment_date::TIMESTAMPTZ 
            ELSE last_payment_date 
          END
        WHERE batch_id = p_batch_id AND nrc_number = v_nrc;
        
      ELSE
        -- INCREASED: Arrears went up
        v_movement_type := 'increased';
        v_increased := v_increased + 1;
        v_diff := v_new_arrears - v_old_arrears;
        
        -- Update ticket (keep In Progress)
        UPDATE tickets SET
          amount_owed = v_new_arrears,
          status = 'In Progress',
          updated_at = NOW()
        WHERE id = v_ticket_id;
        
        -- Update master customer balance
        UPDATE master_customers SET
          outstanding_balance = outstanding_balance + v_diff,
          loan_book_arrears = v_new_arrears,
          updated_at = NOW()
        WHERE id = v_master_customer_id;
        
        -- Update batch_customers
        UPDATE batch_customers SET
          amount_owed = v_new_arrears
        WHERE batch_id = p_batch_id AND nrc_number = v_nrc;
      END IF;
      
      v_updated := v_updated + 1;
      
      -- Log the movement
      INSERT INTO arrears_sync_logs (
        sync_batch_id, nrc_number, master_customer_id, old_arrears, new_arrears, 
        movement_type, source, admin_user_id, loan_book_payment_date, ticket_resolved
      ) VALUES (
        v_sync_batch_id, v_nrc, v_master_customer_id, v_old_arrears, v_new_arrears,
        v_movement_type, 'loanbook_daily', v_admin_id, 
        CASE WHEN v_last_payment_date IS NOT NULL THEN v_last_payment_date::TIMESTAMPTZ ELSE NULL END,
        v_movement_type = 'cleared'
      );
      
      -- Create agent notification (only for Cleared, Reduced, Increased)
      IF v_agent_id IS NOT NULL AND v_movement_type IN ('cleared', 'reduced', 'increased') THEN
        INSERT INTO agent_notifications (
          agent_id,
          type,
          title,
          message,
          related_customer_id,
          related_ticket_id
        ) VALUES (
          v_agent_id,
          'arrears_movement',
          CASE v_movement_type
            WHEN 'cleared' THEN 'Arrears Cleared (Loan Book)'
            WHEN 'reduced' THEN 'Arrears Reduced'
            WHEN 'increased' THEN 'Arrears Increased'
          END,
          'NRC ' || v_nrc || ': ' || 
          CASE v_movement_type
            WHEN 'cleared' THEN 'Cleared from ' || v_old_arrears || ' to 0'
            WHEN 'reduced' THEN 'Reduced from ' || v_old_arrears || ' to ' || v_new_arrears
            WHEN 'increased' THEN 'Increased from ' || v_old_arrears || ' to ' || v_new_arrears
          END,
          v_master_customer_id,
          v_ticket_id
        );
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 'NRC ' || COALESCE(v_nrc, 'unknown') || ': ' || SQLERRM);
    END;
  END LOOP;

  -- Create arrears snapshot for this sync
  INSERT INTO arrears_snapshots (
    sync_batch_id,
    batch_id,
    source,
    batch_total_arrears,
    batch_ticket_count
  )
  SELECT 
    v_sync_batch_id,
    p_batch_id,
    'loan_book_sync',
    COALESCE(SUM(t.amount_owed), 0),
    COUNT(t.id)
  FROM tickets t
  WHERE t.batch_id = p_batch_id
    AND t.status != 'Resolved';

  RETURN json_build_object(
    'success', true,
    'sync_batch_id', v_sync_batch_id,
    'processed', v_processed,
    'updated', v_updated,
    'maintained', v_maintained,
    'cleared', v_cleared,
    'reduced', v_reduced,
    'increased', v_increased,
    'blocked', v_blocked,
    'not_found', v_not_found,
    'errors', v_errors
  );
END;
$$;