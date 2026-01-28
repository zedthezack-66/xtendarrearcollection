-- Drop existing function first, then recreate with updated logic
DROP FUNCTION IF EXISTS public.process_loan_book_sync(text);

-- Create updated function with full movement detection and notifications
CREATE OR REPLACE FUNCTION public.process_loan_book_sync(p_sync_data text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sync_batch_id uuid := gen_random_uuid();
  v_admin_id uuid := auth.uid();
  v_record jsonb;
  v_records jsonb;
  v_nrc text;
  v_new_arrears numeric;
  v_days_in_arrears integer;
  v_payment_date timestamp with time zone;
  v_customer record;
  v_ticket record;
  v_old_arrears numeric;
  v_movement_type text;
  v_processed integer := 0;
  v_updated integer := 0;
  v_maintained integer := 0;
  v_not_found integer := 0;
  v_resolved integer := 0;
  v_reopened integer := 0;
  v_errors text[] := ARRAY[]::text[];
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
      
      -- Extract NRC (required)
      v_nrc := TRIM(v_record->>'nrc_number');
      IF v_nrc IS NULL OR v_nrc = '' THEN
        v_errors := array_append(v_errors, format('Row %s: Missing NRC Number', v_processed));
        CONTINUE;
      END IF;
      
      -- Extract new arrears amount (required, 0 is valid)
      BEGIN
        v_new_arrears := (v_record->>'arrears_amount')::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_new_arrears := NULL;
      END;
      
      -- If arrears is NULL, skip (no change intended)
      IF v_new_arrears IS NULL THEN
        v_maintained := v_maintained + 1;
        CONTINUE;
      END IF;
      
      -- Extract optional days in arrears
      BEGIN
        v_days_in_arrears := (v_record->>'days_in_arrears')::integer;
      EXCEPTION WHEN OTHERS THEN
        v_days_in_arrears := NULL;
      END;
      
      -- Extract optional payment date with validation (1900-2100)
      BEGIN
        v_payment_date := (v_record->>'last_payment_date')::timestamp with time zone;
        IF v_payment_date IS NOT NULL THEN
          IF EXTRACT(YEAR FROM v_payment_date) < 1900 OR EXTRACT(YEAR FROM v_payment_date) > 2100 THEN
            v_payment_date := NULL;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_payment_date := NULL;
      END;
      
      -- Find existing customer by NRC (MUST exist - no new customers)
      SELECT * INTO v_customer
      FROM master_customers
      WHERE nrc_number = v_nrc;
      
      IF v_customer.id IS NULL THEN
        v_not_found := v_not_found + 1;
        v_errors := array_append(v_errors, format('NRC %s: Customer not found', v_nrc));
        CONTINUE;
      END IF;
      
      -- Get old arrears from loan_book_arrears (or outstanding_balance as fallback)
      v_old_arrears := COALESCE(v_customer.loan_book_arrears, v_customer.outstanding_balance, 0);
      
      -- Determine movement type
      IF v_old_arrears = v_new_arrears THEN
        -- MAINTAINED: No change
        v_movement_type := 'Maintained';
        v_maintained := v_maintained + 1;
        
        -- Log but don't notify
        INSERT INTO arrears_sync_logs (
          sync_batch_id, admin_user_id, nrc_number, master_customer_id,
          old_arrears, new_arrears, movement_type, loan_book_payment_date, source
        ) VALUES (
          v_sync_batch_id, v_admin_id, v_nrc, v_customer.id,
          v_old_arrears, v_new_arrears, v_movement_type, v_payment_date, 'daily_loan_book_update'
        );
        
        CONTINUE; -- Skip to next record
        
      ELSIF v_old_arrears > 0 AND v_new_arrears = 0 THEN
        -- CLEARED: Arrears went to zero
        v_movement_type := 'Cleared';
        v_resolved := v_resolved + 1;
        
      ELSIF v_old_arrears > v_new_arrears AND v_new_arrears > 0 THEN
        -- REDUCED: Partial reduction
        v_movement_type := 'Reduced';
        v_updated := v_updated + 1;
        
      ELSIF v_new_arrears > v_old_arrears THEN
        -- INCREASED: Arrears went up
        v_movement_type := 'Increased';
        v_updated := v_updated + 1;
        
      ELSIF v_old_arrears = 0 AND v_new_arrears > 0 THEN
        -- REOPENED: Was cleared, now has arrears again
        v_movement_type := 'Reopened';
        v_reopened := v_reopened + 1;
        
      ELSE
        v_movement_type := 'Updated';
        v_updated := v_updated + 1;
      END IF;
      
      -- Update master_customers with new loan book data
      UPDATE master_customers
      SET 
        loan_book_arrears = v_new_arrears,
        loan_book_last_payment_date = COALESCE(v_payment_date, loan_book_last_payment_date),
        outstanding_balance = v_new_arrears,
        updated_at = now()
      WHERE id = v_customer.id;
      
      -- Find and update active ticket(s) for this customer
      FOR v_ticket IN 
        SELECT t.* FROM tickets t
        WHERE t.master_customer_id = v_customer.id
        AND t.status NOT IN ('Resolved', 'Closed')
        ORDER BY t.created_at DESC
        LIMIT 1
      LOOP
        -- Update ticket based on movement type
        IF v_movement_type = 'Cleared' THEN
          UPDATE tickets
          SET 
            amount_owed = 0,
            status = 'Resolved',
            resolved_date = now(),
            updated_at = now()
          WHERE id = v_ticket.id;
          
        ELSIF v_movement_type = 'Reopened' THEN
          UPDATE tickets
          SET 
            amount_owed = v_new_arrears,
            status = 'In Progress',
            resolved_date = NULL,
            updated_at = now()
          WHERE id = v_ticket.id;
          
        ELSE
          -- Reduced, Increased, Updated
          UPDATE tickets
          SET 
            amount_owed = v_new_arrears,
            status = 'In Progress',
            updated_at = now()
          WHERE id = v_ticket.id;
        END IF;
        
        -- Create agent notification (if ticket has assigned agent)
        IF v_ticket.assigned_agent IS NOT NULL AND v_movement_type != 'Maintained' THEN
          INSERT INTO agent_notifications (
            agent_id,
            title,
            message,
            type,
            related_ticket_id,
            related_customer_id
          ) VALUES (
            v_ticket.assigned_agent,
            CASE v_movement_type
              WHEN 'Cleared' THEN 'Arrears Cleared'
              WHEN 'Reduced' THEN 'Arrears Reduced'
              WHEN 'Increased' THEN 'Arrears Increased'
              WHEN 'Reopened' THEN 'Ticket Reopened'
              ELSE 'Arrears Updated'
            END,
            format('%s: %s → %s (via Loan Book)', 
              v_customer.name,
              'K' || TRIM(TO_CHAR(v_old_arrears, '999,999,990.00')),
              'K' || TRIM(TO_CHAR(v_new_arrears, '999,999,990.00'))
            ),
            CASE v_movement_type
              WHEN 'Cleared' THEN 'arrears_cleared'
              WHEN 'Reduced' THEN 'arrears_reduced'
              WHEN 'Increased' THEN 'arrears_increased'
              WHEN 'Reopened' THEN 'ticket_reopened'
              ELSE 'arrears_updated'
            END,
            v_ticket.id,
            v_customer.id
          );
        END IF;
      END LOOP;
      
      -- Log to arrears_sync_logs
      INSERT INTO arrears_sync_logs (
        sync_batch_id, admin_user_id, nrc_number, master_customer_id,
        old_arrears, new_arrears, movement_type, loan_book_payment_date,
        ticket_resolved, source
      ) VALUES (
        v_sync_batch_id, v_admin_id, v_nrc, v_customer.id,
        v_old_arrears, v_new_arrears, v_movement_type, v_payment_date,
        (v_movement_type = 'Cleared'), 'daily_loan_book_update'
      );
      
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, format('NRC %s: %s', COALESCE(v_nrc, 'unknown'), SQLERRM));
    END;
  END LOOP;
  
  -- Create arrears snapshot for this sync
  INSERT INTO arrears_snapshots (
    sync_batch_id, source, 
    system_total_arrears, system_total_tickets
  )
  SELECT 
    v_sync_batch_id,
    'daily_loan_book_update',
    COALESCE(SUM(amount_owed), 0),
    COUNT(*)
  FROM tickets
  WHERE status NOT IN ('Resolved', 'Closed');
  
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
$$;