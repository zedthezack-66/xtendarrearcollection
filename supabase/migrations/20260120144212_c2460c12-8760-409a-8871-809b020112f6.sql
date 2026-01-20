-- Drop the existing check constraint and add a new one that includes system payment methods
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;

ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check 
CHECK (payment_method = ANY (ARRAY['Mobile Money'::text, 'Bank'::text, 'Loan Book Sync'::text]));

-- Now recreate process_loan_book_sync to use 'Loan Book Sync' as payment method
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
  v_error_count int := 0;
  v_payment_amount numeric;
  v_errors json[] := ARRAY[]::json[];
  v_loan_book_date timestamp with time zone;
  v_date_text text;
  v_date_year int;
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
      
      -- Extract and validate new arrears (must be a valid number)
      BEGIN
        v_new_arrears := COALESCE((v_record->>'new_arrears')::numeric, 0);
        IF v_new_arrears < 0 THEN
          v_new_arrears := 0;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_new_arrears := 0;
      END;
      
      -- Extract and validate loan book date with year range check
      v_date_text := v_record->>'loan_book_payment_date';
      v_loan_book_date := NULL;
      
      IF v_date_text IS NOT NULL AND v_date_text != '' THEN
        BEGIN
          v_loan_book_date := v_date_text::timestamp with time zone;
          -- Validate year is reasonable (1900-2100)
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
      WHERE nrc_number = (v_record->>'nrc_number');
      
      IF v_master_customer.id IS NULL THEN
        v_errors := array_append(v_errors, json_build_object(
          'nrc', v_record->>'nrc_number',
          'error', 'Customer not found'
        ));
        v_error_count := v_error_count + 1;
        CONTINUE;
      END IF;
      
      -- Get current arrears from loan_book_arrears
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
      
      -- Update master customer with new loan book data
      UPDATE master_customers
      SET 
        loan_book_arrears = v_new_arrears,
        loan_book_last_payment_date = COALESCE(v_loan_book_date, loan_book_last_payment_date),
        updated_at = now()
      WHERE id = v_master_customer.id;
      
      -- Log the sync
      INSERT INTO arrears_sync_logs (
        sync_batch_id,
        admin_user_id,
        nrc_number,
        master_customer_id,
        old_arrears,
        new_arrears,
        movement_type,
        loan_book_payment_date,
        source
      ) VALUES (
        v_sync_batch_id,
        v_admin_user_id,
        v_record->>'nrc_number',
        v_master_customer.id,
        v_old_arrears,
        v_new_arrears,
        v_movement_type,
        v_loan_book_date,
        'daily_sync'
      );
      
      -- Handle arrears reduction: Create payment and resolve ticket if needed
      IF v_movement_type IN ('cleared', 'reduced') THEN
        v_payment_amount := v_old_arrears - v_new_arrears;
        
        -- Find the active ticket for this customer
        SELECT * INTO v_ticket
        FROM tickets
        WHERE master_customer_id = v_master_customer.id
          AND status != 'Resolved'
        ORDER BY created_at DESC
        LIMIT 1;
        
        IF v_ticket.id IS NOT NULL THEN
          -- Create system payment with VALID payment_method
          INSERT INTO payments (
            ticket_id,
            master_customer_id,
            customer_name,
            amount,
            payment_method,
            payment_date,
            notes,
            recorded_by
          ) VALUES (
            v_ticket.id,
            v_master_customer.id,
            v_master_customer.name,
            v_payment_amount,
            'Loan Book Sync',
            COALESCE(v_loan_book_date, now()),
            'Auto-generated from loan book sync. Previous arrears: K' || v_old_arrears || ', New arrears: K' || v_new_arrears,
            v_admin_user_id
          );
          
          -- Update ticket status
          IF v_movement_type = 'cleared' THEN
            UPDATE tickets
            SET 
              status = 'Resolved',
              resolved_date = now(),
              updated_at = now()
            WHERE id = v_ticket.id;
            
            -- Update sync log to mark ticket resolved
            UPDATE arrears_sync_logs
            SET ticket_resolved = true
            WHERE sync_batch_id = v_sync_batch_id
              AND master_customer_id = v_master_customer.id;
          ELSE
            UPDATE tickets
            SET 
              status = 'In Progress',
              updated_at = now()
            WHERE id = v_ticket.id;
          END IF;
          
          -- Send notification to assigned agent
          IF v_ticket.assigned_agent IS NOT NULL THEN
            INSERT INTO agent_notifications (
              agent_id,
              type,
              title,
              message,
              related_ticket_id,
              related_customer_id
            ) VALUES (
              v_ticket.assigned_agent,
              CASE WHEN v_movement_type = 'cleared' THEN 'payment_cleared' ELSE 'payment_received' END,
              CASE WHEN v_movement_type = 'cleared' THEN 'Arrears Cleared' ELSE 'Partial Payment Received' END,
              'Customer ' || v_master_customer.name || ' arrears ' || 
                CASE WHEN v_movement_type = 'cleared' THEN 'fully cleared' ELSE 'reduced by K' || v_payment_amount END ||
                ' via loan book sync.',
              v_ticket.id,
              v_master_customer.id
            );
          END IF;
        END IF;
      END IF;
      
      v_updated_count := v_updated_count + 1;
      
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, json_build_object(
        'nrc', v_record->>'nrc_number',
        'error', SQLERRM
      ));
      v_error_count := v_error_count + 1;
    END;
  END LOOP;
  
  -- Create arrears snapshots after sync
  PERFORM create_arrears_snapshots('daily_sync', v_sync_batch_id);
  
  RETURN json_build_object(
    'success', true,
    'sync_batch_id', v_sync_batch_id,
    'processed_count', v_processed_count,
    'updated_count', v_updated_count,
    'error_count', v_error_count,
    'errors', v_errors
  );
END;
$$;

-- Recreate process_batch_arrears_update to use 'Loan Book Sync' as payment method
CREATE OR REPLACE FUNCTION public.process_batch_arrears_update(p_batch_id uuid, p_updates json)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sync_batch_id uuid := gen_random_uuid();
  v_user_id uuid := auth.uid();
  v_record json;
  v_batch_customer record;
  v_master_customer record;
  v_ticket record;
  v_old_arrears numeric;
  v_new_arrears numeric;
  v_movement_type text;
  v_payment_amount numeric;
  v_processed_count int := 0;
  v_updated_count int := 0;
  v_error_count int := 0;
  v_errors json[] := ARRAY[]::json[];
BEGIN
  -- Process each update record
  FOR v_record IN SELECT * FROM json_array_elements(p_updates)
  LOOP
    BEGIN
      v_processed_count := v_processed_count + 1;
      
      -- Extract new arrears
      v_new_arrears := COALESCE((v_record->>'new_amount_owed')::numeric, 0);
      IF v_new_arrears < 0 THEN
        v_new_arrears := 0;
      END IF;
      
      -- Find batch customer by NRC and batch
      SELECT bc.*, mc.id as mc_id, mc.name as mc_name, mc.loan_book_arrears
      INTO v_batch_customer
      FROM batch_customers bc
      JOIN master_customers mc ON mc.id = bc.master_customer_id
      WHERE bc.batch_id = p_batch_id
        AND bc.nrc_number = (v_record->>'nrc_number');
      
      IF v_batch_customer.id IS NULL THEN
        v_errors := array_append(v_errors, json_build_object(
          'nrc', v_record->>'nrc_number',
          'error', 'Customer not found in batch'
        ));
        v_error_count := v_error_count + 1;
        CONTINUE;
      END IF;
      
      -- Get old arrears from batch_customer
      v_old_arrears := COALESCE(v_batch_customer.amount_owed, 0);
      
      -- Skip if no change
      IF v_old_arrears = v_new_arrears THEN
        CONTINUE;
      END IF;
      
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
      
      -- Update batch_customer
      UPDATE batch_customers
      SET amount_owed = v_new_arrears
      WHERE id = v_batch_customer.id;
      
      -- Log the change
      INSERT INTO arrears_sync_logs (
        sync_batch_id,
        admin_user_id,
        nrc_number,
        master_customer_id,
        old_arrears,
        new_arrears,
        movement_type,
        source
      ) VALUES (
        v_sync_batch_id,
        v_user_id,
        v_record->>'nrc_number',
        v_batch_customer.mc_id,
        v_old_arrears,
        v_new_arrears,
        v_movement_type,
        'batch_update'
      );
      
      -- Handle arrears reduction: Create payment
      IF v_movement_type IN ('cleared', 'reduced') THEN
        v_payment_amount := v_old_arrears - v_new_arrears;
        
        -- Find the ticket for this customer in this batch
        SELECT * INTO v_ticket
        FROM tickets
        WHERE master_customer_id = v_batch_customer.mc_id
          AND batch_id = p_batch_id
        LIMIT 1;
        
        IF v_ticket.id IS NOT NULL THEN
          -- Create system payment with VALID payment_method
          INSERT INTO payments (
            ticket_id,
            master_customer_id,
            customer_name,
            amount,
            payment_method,
            payment_date,
            notes,
            recorded_by
          ) VALUES (
            v_ticket.id,
            v_batch_customer.mc_id,
            v_batch_customer.mc_name,
            v_payment_amount,
            'Loan Book Sync',
            now(),
            'Auto-generated from batch update. Previous arrears: K' || v_old_arrears || ', New arrears: K' || v_new_arrears,
            v_user_id
          );
          
          -- Update ticket status
          IF v_movement_type = 'cleared' THEN
            UPDATE tickets
            SET 
              status = 'Resolved',
              resolved_date = now(),
              amount_owed = v_new_arrears,
              updated_at = now()
            WHERE id = v_ticket.id;
            
            UPDATE arrears_sync_logs
            SET ticket_resolved = true
            WHERE sync_batch_id = v_sync_batch_id
              AND master_customer_id = v_batch_customer.mc_id;
          ELSE
            UPDATE tickets
            SET 
              status = 'In Progress',
              amount_owed = v_new_arrears,
              updated_at = now()
            WHERE id = v_ticket.id;
          END IF;
          
          -- Send notification to assigned agent
          IF v_ticket.assigned_agent IS NOT NULL THEN
            INSERT INTO agent_notifications (
              agent_id,
              type,
              title,
              message,
              related_ticket_id,
              related_customer_id
            ) VALUES (
              v_ticket.assigned_agent,
              CASE WHEN v_movement_type = 'cleared' THEN 'payment_cleared' ELSE 'payment_received' END,
              CASE WHEN v_movement_type = 'cleared' THEN 'Arrears Cleared' ELSE 'Partial Payment Received' END,
              'Customer ' || v_batch_customer.mc_name || ' arrears ' || 
                CASE WHEN v_movement_type = 'cleared' THEN 'fully cleared' ELSE 'reduced by K' || v_payment_amount END ||
                ' via batch update.',
              v_ticket.id,
              v_batch_customer.mc_id
            );
          END IF;
        END IF;
      ELSIF v_movement_type = 'increased' THEN
        -- Update ticket amount if increased
        UPDATE tickets
        SET 
          amount_owed = v_new_arrears,
          updated_at = now()
        WHERE master_customer_id = v_batch_customer.mc_id
          AND batch_id = p_batch_id;
      END IF;
      
      v_updated_count := v_updated_count + 1;
      
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, json_build_object(
        'nrc', v_record->>'nrc_number',
        'error', SQLERRM
      ));
      v_error_count := v_error_count + 1;
    END;
  END LOOP;
  
  -- Create arrears snapshots after batch update
  PERFORM create_arrears_snapshots('batch_update', v_sync_batch_id);
  
  -- Update batch totals
  UPDATE batches
  SET 
    total_amount = (
      SELECT COALESCE(SUM(amount_owed), 0) 
      FROM batch_customers 
      WHERE batch_id = p_batch_id
    )
  WHERE id = p_batch_id;
  
  RETURN json_build_object(
    'success', true,
    'sync_batch_id', v_sync_batch_id,
    'processed_count', v_processed_count,
    'updated_count', v_updated_count,
    'error_count', v_error_count,
    'errors', v_errors
  );
END;
$$;