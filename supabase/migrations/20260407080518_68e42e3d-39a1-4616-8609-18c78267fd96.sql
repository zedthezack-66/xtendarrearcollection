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
  v_payment_amount numeric;
BEGIN
  BEGIN
    v_records := p_sync_data::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Invalid JSON input',
      'sync_batch_id', v_sync_batch_id
    );
  END;

  FOR v_record IN SELECT * FROM jsonb_array_elements(v_records) LOOP
  BEGIN
    v_processed := v_processed + 1;

    v_nrc := NULLIF(TRIM(v_record->>'nrc_number'), '');
    IF v_nrc IS NULL THEN
      v_errors := array_append(v_errors, 'Row ' || v_processed || ': Missing NRC');
      CONTINUE;
    END IF;

    BEGIN
      v_new_arrears := NULLIF(TRIM(v_record->>'arrears_amount'), '')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_new_arrears := NULL;
    END;

    BEGIN
      v_days_in_arrears := NULLIF(TRIM(v_record->>'days_in_arrears'), '')::int;
    EXCEPTION WHEN OTHERS THEN
      v_days_in_arrears := NULL;
    END;

    BEGIN
      v_last_payment_date := NULLIF(TRIM(v_record->>'last_payment_date'), '')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_last_payment_date := NULL;
    END;

    SELECT * INTO v_customer_record FROM master_customers WHERE nrc_number = v_nrc LIMIT 1;

    IF v_customer_record.id IS NULL THEN
      v_not_found := v_not_found + 1;
      INSERT INTO arrears_sync_logs (
        sync_batch_id, admin_user_id, nrc_number,
        old_arrears, new_arrears, movement_type, source
      ) VALUES (
        v_sync_batch_id, v_admin_id, v_nrc,
        0, COALESCE(v_new_arrears, 0), 'not_found', 'daily_sync'
      );
      CONTINUE;
    END IF;

    SELECT * INTO v_ticket_record FROM tickets
    WHERE master_customer_id = v_customer_record.id
      AND status != 'Resolved'
    ORDER BY created_at DESC
    LIMIT 1;

    v_old_arrears := COALESCE(v_ticket_record.amount_owed, v_customer_record.outstanding_balance, 0);

    IF v_new_arrears IS NULL THEN
      -- Still update days_in_arrears if provided even when no arrears change
      IF v_days_in_arrears IS NOT NULL AND v_ticket_record.id IS NOT NULL THEN
        UPDATE tickets SET days_in_arrears = v_days_in_arrears, updated_at = now()
        WHERE id = v_ticket_record.id;
      END IF;
      v_maintained := v_maintained + 1;
      CONTINUE;
    END IF;

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

    UPDATE master_customers SET
      outstanding_balance = v_new_arrears,
      loan_book_arrears = v_new_arrears,
      loan_book_last_payment_date = COALESCE(v_last_payment_date, loan_book_last_payment_date),
      updated_at = now()
    WHERE id = v_customer_record.id;

    IF v_ticket_record.id IS NOT NULL THEN
      UPDATE tickets SET
        amount_owed = v_new_arrears,
        days_in_arrears = COALESCE(v_days_in_arrears, days_in_arrears),
        status = CASE WHEN v_new_arrears = 0 THEN 'Resolved' ELSE status END,
        resolved_date = CASE WHEN v_new_arrears = 0 THEN now() ELSE resolved_date END,
        updated_at = now()
      WHERE id = v_ticket_record.id;

      IF v_movement_type IN ('cleared', 'reduced') THEN
        v_payment_amount := v_old_arrears - v_new_arrears;
        
        INSERT INTO payments (
          ticket_id, master_customer_id, customer_name, amount,
          payment_method, payment_date, notes, recorded_by, source
        ) VALUES (
          v_ticket_record.id, v_customer_record.id, v_customer_record.name,
          v_payment_amount, 'Bank', COALESCE(v_last_payment_date, now()),
          'Daily loan book sync - ' || v_movement_type || ' from K' || v_old_arrears || ' to K' || v_new_arrears,
          v_admin_id, 'loanbook_daily'
        );
      END IF;

      IF v_movement_type != 'maintained' AND v_ticket_record.assigned_agent IS NOT NULL THEN
        INSERT INTO agent_notifications (
          agent_id, title, message, type, related_ticket_id, related_customer_id
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

    INSERT INTO arrears_sync_logs (
      sync_batch_id, admin_user_id, nrc_number, master_customer_id,
      old_arrears, new_arrears, movement_type, loan_book_payment_date,
      ticket_resolved, source
    ) VALUES (
      v_sync_batch_id, v_admin_id, v_nrc, v_customer_record.id,
      v_old_arrears, v_new_arrears, v_movement_type, v_last_payment_date,
      (v_new_arrears = 0), 'daily_sync'
    );

  EXCEPTION WHEN OTHERS THEN
    v_errors := array_append(v_errors, 'Row ' || v_processed || ': ' || SQLERRM);
  END;
  END LOOP;

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