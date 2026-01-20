
-- Fix process_loan_book_sync: Log ALL records including maintained, but only count updates for actual changes
CREATE OR REPLACE FUNCTION public.process_loan_book_sync(p_sync_data text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sync_batch_id uuid := gen_random_uuid();
  v_admin_user_id uuid := auth.uid();
  v_data json;
  v_record json;
  v_master_customer record;
  v_ticket record;
  v_old_arrears numeric;
  v_new_arrears numeric;
  v_movement_type text;
  v_processed_count int := 0;
  v_updated_count int := 0;
  v_not_found_count int := 0;
  v_resolved_count int := 0;
  v_payments_created int := 0;
  v_errors text[] := ARRAY[]::text[];
  v_loan_book_date timestamp with time zone;
  v_date_text text;
  v_date_year int;
  v_nrc text;
BEGIN
  -- Check admin permission
  IF NOT has_role(v_admin_user_id, 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized: Admin access required');
  END IF;
  
  -- Parse JSON data
  BEGIN
    v_data := p_sync_data::json;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', 'Invalid JSON data');
  END;
  
  -- Process each record
  FOR v_record IN SELECT * FROM json_array_elements(v_data)
  LOOP
    BEGIN
      v_processed_count := v_processed_count + 1;
      
      -- Extract NRC number
      v_nrc := COALESCE(v_record->>'nrc_number', '');
      IF v_nrc = '' THEN
        v_errors := array_append(v_errors, 'Row ' || v_processed_count || ': Missing NRC');
        CONTINUE;
      END IF;
      
      -- Extract and validate new arrears (handle both field names)
      BEGIN
        v_new_arrears := COALESCE(
          NULLIF(v_record->>'arrears_amount', '')::numeric,
          NULLIF(v_record->>'new_arrears', '')::numeric,
          NULL
        );
        -- If arrears is null, skip this record (no data provided)
        IF v_new_arrears IS NULL THEN
          CONTINUE;
        END IF;
        IF v_new_arrears < 0 THEN
          v_new_arrears := 0;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_errors := array_append(v_errors, 'Row ' || v_processed_count || ': Invalid arrears amount');
        CONTINUE;
      END;
      
      -- Extract and validate loan book date
      v_date_text := COALESCE(v_record->>'last_payment_date', v_record->>'loan_book_payment_date');
      v_loan_book_date := NULL;
      
      IF v_date_text IS NOT NULL AND v_date_text != '' THEN
        BEGIN
          v_loan_book_date := v_date_text::timestamp with time zone;
          v_date_year := EXTRACT(YEAR FROM v_loan_book_date);
          IF v_date_year < 1900 OR v_date_year > 2100 THEN
            v_loan_book_date := NULL;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_loan_book_date := NULL;
        END;
      END IF;
      
      -- Find master customer by NRC
      SELECT * INTO v_master_customer
      FROM master_customers
      WHERE nrc_number = v_nrc;
      
      IF v_master_customer.id IS NULL THEN
        v_not_found_count := v_not_found_count + 1;
        CONTINUE;
      END IF;
      
      -- Get current arrears
      v_old_arrears := COALESCE(v_master_customer.loan_book_arrears, 0);
      
      -- Determine movement type
      IF v_new_arrears = 0 AND v_old_arrears > 0 THEN
        v_movement_type := 'cleared';
      ELSIF v_new_arrears < v_old_arrears THEN
        v_movement_type := 'reduced';
      ELSIF v_new_arrears = v_old_arrears THEN
        v_movement_type := 'maintained';
      ELSE
        v_movement_type := 'increased';
      END IF;
      
      -- Only update if there's an actual change
      IF v_old_arrears != v_new_arrears THEN
        UPDATE master_customers
        SET 
          loan_book_arrears = v_new_arrears,
          loan_book_last_payment_date = COALESCE(v_loan_book_date, loan_book_last_payment_date),
          updated_at = now()
        WHERE id = v_master_customer.id;
        
        v_updated_count := v_updated_count + 1;
        
        -- Log the sync (only for actual changes)
        INSERT INTO arrears_sync_logs (
          sync_batch_id, admin_user_id, nrc_number, master_customer_id,
          old_arrears, new_arrears, movement_type, loan_book_payment_date, source
        ) VALUES (
          v_sync_batch_id, v_admin_user_id, v_nrc, v_master_customer.id,
          v_old_arrears, v_new_arrears, v_movement_type, v_loan_book_date, 'daily_sync'
        );
        
        -- Find active ticket for this customer
        SELECT * INTO v_ticket
        FROM tickets
        WHERE master_customer_id = v_master_customer.id
          AND LOWER(status) != 'resolved'
        ORDER BY created_at DESC
        LIMIT 1;
        
        -- Process cleared/reduced arrears
        IF v_movement_type IN ('cleared', 'reduced') THEN
          -- Create system payment record
          INSERT INTO payments (
            master_customer_id, ticket_id, amount, payment_method,
            customer_name, notes, recorded_by, payment_date
          ) VALUES (
            v_master_customer.id,
            v_ticket.id,
            v_old_arrears - v_new_arrears,
            'Loan Book Sync',
            v_master_customer.name,
            'Auto-generated from loan book sync. Previous arrears: K' || v_old_arrears || ', New arrears: K' || v_new_arrears,
            v_admin_user_id,
            COALESCE(v_loan_book_date, now())
          );
          v_payments_created := v_payments_created + 1;
          
          -- Send notification to agent
          IF v_ticket.assigned_agent IS NOT NULL THEN
            INSERT INTO agent_notifications (agent_id, title, message, type, related_ticket_id, related_customer_id)
            VALUES (
              v_ticket.assigned_agent,
              CASE WHEN v_movement_type = 'cleared' THEN 'Arrears Cleared' ELSE 'Arrears Reduced' END,
              v_master_customer.name || '''s arrears ' || 
                CASE WHEN v_movement_type = 'cleared' THEN 'cleared (was K' || v_old_arrears || ')' 
                     ELSE 'reduced from K' || v_old_arrears || ' to K' || v_new_arrears END,
              CASE WHEN v_movement_type = 'cleared' THEN 'success' ELSE 'info' END,
              v_ticket.id,
              v_master_customer.id
            );
          END IF;
          
          -- Auto-resolve ticket if cleared
          IF v_movement_type = 'cleared' AND v_ticket.id IS NOT NULL THEN
            UPDATE tickets
            SET status = 'Resolved', resolved_date = now(), updated_at = now()
            WHERE id = v_ticket.id;
            v_resolved_count := v_resolved_count + 1;
          END IF;
        END IF;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 'Row ' || v_processed_count || ': ' || SQLERRM);
    END;
  END LOOP;
  
  -- Create arrears snapshot
  PERFORM create_arrears_snapshots(v_sync_batch_id, 'daily_sync');
  
  RETURN json_build_object(
    'success', true,
    'sync_batch_id', v_sync_batch_id,
    'processed', v_processed_count,
    'updated', v_updated_count,
    'not_found', v_not_found_count,
    'resolved', v_resolved_count,
    'payments_created', v_payments_created,
    'errors', v_errors
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', false,
    'error', SQLERRM,
    'processed', v_processed_count,
    'updated', v_updated_count,
    'not_found', v_not_found_count,
    'resolved', 0,
    'payments_created', 0,
    'errors', v_errors
  );
END;
$$;
