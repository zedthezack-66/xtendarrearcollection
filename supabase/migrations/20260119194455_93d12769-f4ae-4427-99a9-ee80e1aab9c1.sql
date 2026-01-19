-- Fix process_loan_book_sync to handle scalar/string input and add robust validation
CREATE OR REPLACE FUNCTION public.process_loan_book_sync(
  p_sync_data JSONB -- Array of {nrc_number, arrears_amount, last_payment_date}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sync_batch_id UUID;
  v_admin_id UUID;
  v_record JSONB;
  v_customer RECORD;
  v_old_arrears NUMERIC;
  v_new_arrears NUMERIC;
  v_movement_type TEXT;
  v_ticket_resolved BOOLEAN;
  v_payment_date TIMESTAMP WITH TIME ZONE;
  v_processed INTEGER := 0;
  v_updated INTEGER := 0;
  v_not_found INTEGER := 0;
  v_resolved INTEGER := 0;
  v_errors TEXT[] := '{}';
  v_parsed_data JSONB;
  v_nrc TEXT;
  v_arrears_str TEXT;
  v_date_str TEXT;
BEGIN
  -- Check if caller is admin
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can perform loan book sync';
  END IF;
  
  v_admin_id := auth.uid();
  v_sync_batch_id := gen_random_uuid();
  
  -- CRITICAL FIX: Handle string input (double-encoded JSON from frontend)
  -- If p_sync_data is a string (scalar), parse it to get the actual array
  IF jsonb_typeof(p_sync_data) = 'string' THEN
    BEGIN
      v_parsed_data := p_sync_data #>> '{}'; -- Extract string value
      v_parsed_data := v_parsed_data::jsonb; -- Parse as JSONB
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'success', false,
        'sync_batch_id', v_sync_batch_id,
        'processed', 0,
        'updated', 0,
        'not_found', 0,
        'resolved', 0,
        'errors', ARRAY['Invalid JSON data: could not parse input']
      );
    END;
  ELSIF jsonb_typeof(p_sync_data) = 'array' THEN
    v_parsed_data := p_sync_data;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'sync_batch_id', v_sync_batch_id,
      'processed', 0,
      'updated', 0,
      'not_found', 0,
      'resolved', 0,
      'errors', ARRAY['Invalid input: expected JSON array']
    );
  END IF;
  
  -- Validate it's actually an array
  IF jsonb_typeof(v_parsed_data) != 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'sync_batch_id', v_sync_batch_id,
      'processed', 0,
      'updated', 0,
      'not_found', 0,
      'resolved', 0,
      'errors', ARRAY['Invalid data format: expected array of records']
    );
  END IF;
  
  -- Process each record
  FOR v_record IN SELECT * FROM jsonb_array_elements(v_parsed_data)
  LOOP
    v_processed := v_processed + 1;
    v_ticket_resolved := FALSE;
    
    -- Extract and validate NRC (required)
    v_nrc := NULLIF(TRIM(v_record->>'nrc_number'), '');
    IF v_nrc IS NULL THEN
      v_errors := array_append(v_errors, 'Row ' || v_processed || ': Missing NRC Number');
      CONTINUE;
    END IF;
    
    -- Extract arrears with fault tolerance
    v_arrears_str := UPPER(TRIM(COALESCE(v_record->>'arrears_amount', '')));
    -- Treat empty, #N/A, N/A, NULL as no-change indicator (NULL)
    IF v_arrears_str = '' OR v_arrears_str = '#N/A' OR v_arrears_str = 'N/A' OR v_arrears_str = 'NULL' THEN
      v_new_arrears := NULL; -- Will use existing value
    ELSE
      BEGIN
        v_new_arrears := v_arrears_str::NUMERIC;
      EXCEPTION WHEN OTHERS THEN
        v_errors := array_append(v_errors, 'Row ' || v_processed || ': Invalid arrears amount');
        CONTINUE;
      END;
    END IF;
    
    -- Extract and validate date with fault tolerance
    v_date_str := UPPER(TRIM(COALESCE(v_record->>'last_payment_date', '')));
    v_payment_date := NULL;
    
    IF v_date_str != '' AND v_date_str != '#N/A' AND v_date_str != 'N/A' AND v_date_str != 'NULL' THEN
      BEGIN
        v_payment_date := v_date_str::TIMESTAMP WITH TIME ZONE;
        -- Validate date is in reasonable range (1900-2100)
        IF v_payment_date < '1900-01-01'::TIMESTAMP WITH TIME ZONE OR 
           v_payment_date > '2100-12-31'::TIMESTAMP WITH TIME ZONE THEN
          v_payment_date := NULL; -- Out of range, set to NULL
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_payment_date := NULL; -- Invalid date, set to NULL (don't fail)
      END;
    END IF;
    
    -- Find customer by NRC
    SELECT id, COALESCE(loan_book_arrears, outstanding_balance, 0) AS current_arrears
    INTO v_customer
    FROM master_customers
    WHERE nrc_number = v_nrc
    LIMIT 1;
    
    IF v_customer IS NULL THEN
      -- Customer not found - log and continue
      v_not_found := v_not_found + 1;
      v_movement_type := 'Not Found';
      
      INSERT INTO arrears_sync_logs (
        sync_batch_id, admin_user_id, nrc_number, master_customer_id,
        old_arrears, new_arrears, movement_type, loan_book_payment_date
      ) VALUES (
        v_sync_batch_id, v_admin_id, v_nrc, NULL,
        0, COALESCE(v_new_arrears, 0), v_movement_type, v_payment_date
      );
      
      CONTINUE;
    END IF;
    
    v_old_arrears := v_customer.current_arrears;
    
    -- If arrears is NULL (empty/N/A in CSV), keep existing value
    IF v_new_arrears IS NULL THEN
      v_new_arrears := v_old_arrears;
    END IF;
    
    -- Determine movement type
    IF v_new_arrears = 0 THEN
      v_movement_type := 'Cleared';
    ELSIF v_new_arrears > v_old_arrears THEN
      v_movement_type := 'Increased';
    ELSIF v_new_arrears < v_old_arrears THEN
      v_movement_type := 'Reduced';
    ELSE
      v_movement_type := 'Maintained';
    END IF;
    
    -- Update master_customer (ONLY arrears and loan book payment date)
    UPDATE master_customers
    SET 
      loan_book_arrears = v_new_arrears,
      outstanding_balance = v_new_arrears,
      loan_book_last_payment_date = COALESCE(v_payment_date, loan_book_last_payment_date),
      updated_at = NOW()
    WHERE id = v_customer.id;
    
    -- Update tickets amount_owed for this customer
    UPDATE tickets
    SET 
      amount_owed = v_new_arrears,
      updated_at = NOW()
    WHERE master_customer_id = v_customer.id;
    
    -- If arrears = 0, resolve ticket
    IF v_new_arrears = 0 THEN
      UPDATE tickets
      SET 
        status = 'Resolved',
        resolved_date = NOW(),
        updated_at = NOW()
      WHERE master_customer_id = v_customer.id
        AND status != 'Resolved';
      
      v_ticket_resolved := TRUE;
      v_resolved := v_resolved + 1;
    END IF;
    
    v_updated := v_updated + 1;
    
    -- Log the sync
    INSERT INTO arrears_sync_logs (
      sync_batch_id, admin_user_id, nrc_number, master_customer_id,
      old_arrears, new_arrears, movement_type, loan_book_payment_date, ticket_resolved
    ) VALUES (
      v_sync_batch_id, v_admin_id, v_nrc, v_customer.id,
      v_old_arrears, v_new_arrears, v_movement_type, v_payment_date, v_ticket_resolved
    );
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'sync_batch_id', v_sync_batch_id,
    'processed', v_processed,
    'updated', v_updated,
    'not_found', v_not_found,
    'resolved', v_resolved,
    'errors', v_errors
  );
END;
$$;