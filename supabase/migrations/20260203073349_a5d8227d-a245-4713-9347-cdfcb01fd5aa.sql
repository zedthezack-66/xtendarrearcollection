-- ROLLBACK: Remove all movement type constraints and simplify arrears_sync_logs
-- This restores the table to accept any movement_type value without constraint violations

-- Drop the problematic movement_type check constraint if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'arrears_sync_logs_movement_type_check'
  ) THEN
    ALTER TABLE arrears_sync_logs DROP CONSTRAINT arrears_sync_logs_movement_type_check;
  END IF;
END $$;

-- Recreate process_loan_book_sync with simplified logic (no movement classification at constraint level)
CREATE OR REPLACE FUNCTION public.process_loan_book_sync(p_sync_data text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sync_batch_id uuid := gen_random_uuid();
  v_admin_id uuid := auth.uid();
  v_record jsonb;
  v_records jsonb;
  v_processed int := 0;
  v_updated int := 0;
  v_maintained int := 0;
  v_not_found int := 0;
  v_resolved int := 0;
  v_reopened int := 0;
  v_errors text[] := ARRAY[]::text[];
  v_nrc text;
  v_new_arrears numeric;
  v_days_in_arrears int;
  v_last_payment_date timestamptz;
  v_customer_record RECORD;
  v_ticket_record RECORD;
  v_old_arrears numeric;
  v_movement_type text;
BEGIN
  -- Parse JSON input
  BEGIN
    v_records := p_sync_data::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Invalid JSON input',
      'sync_batch_id', v_sync_batch_id
    );
  END;

  -- Process each record
  FOR v_record IN SELECT * FROM jsonb_array_elements(v_records)
  LOOP
    BEGIN
      v_processed := v_processed + 1;
      
      -- Extract fields with safe defaults
      v_nrc := NULLIF(TRIM(v_record->>'nrc_number'), '');
      
      IF v_nrc IS NULL THEN
        v_errors := array_append(v_errors, 'Row ' || v_processed || ': Missing NRC');
        CONTINUE;
      END IF;
      
      -- Parse arrears amount (NULL means skip update)
      BEGIN
        v_new_arrears := NULLIF(TRIM(v_record->>'arrears_amount'), '')::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_new_arrears := NULL;
      END;
      
      -- Parse days in arrears
      BEGIN
        v_days_in_arrears := NULLIF(TRIM(v_record->>'days_in_arrears'), '')::int;
      EXCEPTION WHEN OTHERS THEN
        v_days_in_arrears := NULL;
      END;
      
      -- Parse last payment date
      BEGIN
        v_last_payment_date := NULLIF(TRIM(v_record->>'last_payment_date'), '')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        v_last_payment_date := NULL;
      END;
      
      -- Find master customer by NRC
      SELECT * INTO v_customer_record
      FROM master_customers
      WHERE nrc_number = v_nrc
      LIMIT 1;
      
      IF v_customer_record.id IS NULL THEN
        v_not_found := v_not_found + 1;
        -- Log not found (simple text, no constraint)
        INSERT INTO arrears_sync_logs (
          sync_batch_id, admin_user_id, nrc_number, 
          old_arrears, new_arrears, movement_type, source
        ) VALUES (
          v_sync_batch_id, v_admin_id, v_nrc,
          0, COALESCE(v_new_arrears, 0), 'not_found', 'daily_sync'
        );
        CONTINUE;
      END IF;
      
      -- Find active ticket for this customer
      SELECT * INTO v_ticket_record
      FROM tickets
      WHERE master_customer_id = v_customer_record.id
        AND status != 'Resolved'
      ORDER BY created_at DESC
      LIMIT 1;
      
      -- Get old arrears value
      v_old_arrears := COALESCE(v_ticket_record.amount_owed, v_customer_record.outstanding_balance, 0);
      
      -- Skip if no new arrears value provided
      IF v_new_arrears IS NULL THEN
        v_maintained := v_maintained + 1;
        CONTINUE;
      END IF;
      
      -- Determine simple movement type (for logging only, no constraint enforcement)
      IF v_old_arrears = v_new_arrears THEN
        v_movement_type := 'maintained';
        v_maintained := v_maintained + 1;
      ELSIF v_new_arrears = 0 AND v_old_arrears > 0 THEN
        v_movement_type := 'cleared';
        v_resolved := v_resolved + 1;
        v_updated := v_updated + 1;
      ELSIF v_new_arrears < v_old_arrears THEN
        v_movement_type := 'reduced';
        v_updated := v_updated + 1;
      ELSIF v_new_arrears > v_old_arrears THEN
        v_movement_type := 'increased';
        v_updated := v_updated + 1;
      ELSE
        v_movement_type := 'updated';
        v_updated := v_updated + 1;
      END IF;
      
      -- Update master customer
      UPDATE master_customers
      SET 
        outstanding_balance = v_new_arrears,
        loan_book_arrears = v_new_arrears,
        loan_book_last_payment_date = COALESCE(v_last_payment_date, loan_book_last_payment_date),
        updated_at = now()
      WHERE id = v_customer_record.id;
      
      -- Update ticket if exists
      IF v_ticket_record.id IS NOT NULL THEN
        UPDATE tickets
        SET 
          amount_owed = v_new_arrears,
          status = CASE WHEN v_new_arrears = 0 THEN 'Resolved' ELSE status END,
          resolved_date = CASE WHEN v_new_arrears = 0 THEN now() ELSE resolved_date END,
          updated_at = now()
        WHERE id = v_ticket_record.id;
        
        -- Create notification for agent if there's a change
        IF v_movement_type != 'maintained' AND v_ticket_record.assigned_agent IS NOT NULL THEN
          INSERT INTO agent_notifications (
            agent_id, title, message, type,
            related_ticket_id, related_customer_id
          ) VALUES (
            v_ticket_record.assigned_agent,
            CASE v_movement_type
              WHEN 'cleared' THEN 'Arrears Cleared'
              WHEN 'reduced' THEN 'Arrears Reduced'
              WHEN 'increased' THEN 'Arrears Increased'
              ELSE 'Arrears Updated'
            END,
            v_customer_record.name || ': K' || v_old_arrears::text || ' → K' || v_new_arrears::text,
            'loan_book_update',
            v_ticket_record.id,
            v_customer_record.id
          );
        END IF;
      END IF;
      
      -- Log the sync (simple insert, no constraint validation)
      INSERT INTO arrears_sync_logs (
        sync_batch_id, admin_user_id, nrc_number, master_customer_id,
        old_arrears, new_arrears, movement_type, 
        loan_book_payment_date, ticket_resolved, source
      ) VALUES (
        v_sync_batch_id, v_admin_id, v_nrc, v_customer_record.id,
        v_old_arrears, v_new_arrears, v_movement_type,
        v_last_payment_date, (v_new_arrears = 0), 'daily_sync'
      );
      
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 'Row ' || v_processed || ': ' || SQLERRM);
    END;
  END LOOP;
  
  -- Create snapshot
  PERFORM create_arrears_snapshots('loan_book_sync', v_sync_batch_id);
  
  RETURN json_build_object(
    'success', true,
    'sync_batch_id', v_sync_batch_id,
    'processed', v_processed,
    'updated', v_updated,
    'maintained', v_maintained,
    'not_found', v_not_found,
    'resolved', v_resolved,
    'reopened', v_reopened,
    'errors', v_errors
  );
END;
$function$;

-- Recreate process_daily_loan_book_update with simplified logic
CREATE OR REPLACE FUNCTION public.process_daily_loan_book_update(p_batch_id uuid, p_sync_data text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sync_batch_id uuid := gen_random_uuid();
  v_admin_id uuid := auth.uid();
  v_record jsonb;
  v_records jsonb;
  v_processed int := 0;
  v_updated int := 0;
  v_maintained int := 0;
  v_not_found int := 0;
  v_resolved int := 0;
  v_errors text[] := ARRAY[]::text[];
  v_nrc text;
  v_new_arrears numeric;
  v_days_in_arrears int;
  v_last_payment_date timestamptz;
  v_ticket_record RECORD;
  v_old_arrears numeric;
  v_movement_type text;
BEGIN
  -- Parse JSON input
  BEGIN
    v_records := p_sync_data::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Invalid JSON input',
      'sync_batch_id', v_sync_batch_id
    );
  END;

  -- Process each record
  FOR v_record IN SELECT * FROM jsonb_array_elements(v_records)
  LOOP
    BEGIN
      v_processed := v_processed + 1;
      
      -- Extract NRC
      v_nrc := NULLIF(TRIM(v_record->>'nrc_number'), '');
      
      IF v_nrc IS NULL THEN
        v_errors := array_append(v_errors, 'Row ' || v_processed || ': Missing NRC');
        CONTINUE;
      END IF;
      
      -- Parse arrears amount
      BEGIN
        v_new_arrears := NULLIF(TRIM(v_record->>'arrears_amount'), '')::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_new_arrears := NULL;
      END;
      
      -- Parse days in arrears
      BEGIN
        v_days_in_arrears := NULLIF(TRIM(v_record->>'days_in_arrears'), '')::int;
      EXCEPTION WHEN OTHERS THEN
        v_days_in_arrears := NULL;
      END;
      
      -- Parse last payment date
      BEGIN
        v_last_payment_date := NULLIF(TRIM(v_record->>'last_payment_date'), '')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        v_last_payment_date := NULL;
      END;
      
      -- Find ticket in this batch by NRC
      SELECT t.*, mc.name as customer_name_full, mc.id as master_id
      INTO v_ticket_record
      FROM tickets t
      JOIN master_customers mc ON mc.id = t.master_customer_id
      WHERE t.batch_id = p_batch_id
        AND t.nrc_number = v_nrc
      LIMIT 1;
      
      IF v_ticket_record.id IS NULL THEN
        v_not_found := v_not_found + 1;
        CONTINUE;
      END IF;
      
      v_old_arrears := COALESCE(v_ticket_record.amount_owed, 0);
      
      -- Skip if no new arrears value provided
      IF v_new_arrears IS NULL THEN
        v_maintained := v_maintained + 1;
        CONTINUE;
      END IF;
      
      -- Simple movement detection for logging
      IF v_old_arrears = v_new_arrears THEN
        v_movement_type := 'maintained';
        v_maintained := v_maintained + 1;
        CONTINUE; -- No change needed
      ELSIF v_new_arrears = 0 AND v_old_arrears > 0 THEN
        v_movement_type := 'cleared';
        v_resolved := v_resolved + 1;
        v_updated := v_updated + 1;
      ELSIF v_new_arrears < v_old_arrears THEN
        v_movement_type := 'reduced';
        v_updated := v_updated + 1;
      ELSE
        v_movement_type := 'increased';
        v_updated := v_updated + 1;
      END IF;
      
      -- Update ticket
      UPDATE tickets
      SET 
        amount_owed = v_new_arrears,
        status = CASE WHEN v_new_arrears = 0 THEN 'Resolved' ELSE status END,
        resolved_date = CASE WHEN v_new_arrears = 0 THEN now() ELSE resolved_date END,
        updated_at = now()
      WHERE id = v_ticket_record.id;
      
      -- Update master customer
      UPDATE master_customers
      SET 
        outstanding_balance = v_new_arrears,
        loan_book_arrears = v_new_arrears,
        loan_book_last_payment_date = COALESCE(v_last_payment_date, loan_book_last_payment_date),
        updated_at = now()
      WHERE id = v_ticket_record.master_id;
      
      -- Create notification for agent
      IF v_ticket_record.assigned_agent IS NOT NULL THEN
        INSERT INTO agent_notifications (
          agent_id, title, message, type,
          related_ticket_id, related_customer_id
        ) VALUES (
          v_ticket_record.assigned_agent,
          CASE v_movement_type
            WHEN 'cleared' THEN 'Arrears Cleared'
            WHEN 'reduced' THEN 'Arrears Reduced'
            WHEN 'increased' THEN 'Arrears Increased'
            ELSE 'Arrears Updated'
          END,
          v_ticket_record.customer_name_full || ': K' || v_old_arrears::text || ' → K' || v_new_arrears::text,
          'loan_book_update',
          v_ticket_record.id,
          v_ticket_record.master_id
        );
      END IF;
      
      -- Log the sync (no constraint on movement_type)
      INSERT INTO arrears_sync_logs (
        sync_batch_id, admin_user_id, nrc_number, master_customer_id,
        old_arrears, new_arrears, movement_type,
        loan_book_payment_date, ticket_resolved, source
      ) VALUES (
        v_sync_batch_id, v_admin_id, v_nrc, v_ticket_record.master_id,
        v_old_arrears, v_new_arrears, v_movement_type,
        v_last_payment_date, (v_new_arrears = 0), 'loanbook_daily'
      );
      
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 'Row ' || v_processed || ': ' || SQLERRM);
    END;
  END LOOP;
  
  -- Create snapshot
  PERFORM create_arrears_snapshots('loan_book_batch_update', v_sync_batch_id);
  
  RETURN json_build_object(
    'success', true,
    'sync_batch_id', v_sync_batch_id,
    'processed', v_processed,
    'updated', v_updated,
    'maintained', v_maintained,
    'not_found', v_not_found,
    'resolved', v_resolved,
    'errors', v_errors
  );
END;
$function$;