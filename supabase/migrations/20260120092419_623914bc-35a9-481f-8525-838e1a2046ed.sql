-- =====================================================
-- ENHANCED LOAN BOOK SYNC WITH AUTO PAYMENT CREATION
-- Creates payment records when arrears decrease
-- Notifies agents of changes via notifications table
-- =====================================================

-- Create notifications table for agent alerts
CREATE TABLE IF NOT EXISTS public.agent_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info', -- 'info', 'payment', 'resolved', 'warning'
  is_read BOOLEAN NOT NULL DEFAULT false,
  related_ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  related_customer_id UUID REFERENCES public.master_customers(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agent_notifications ENABLE ROW LEVEL SECURITY;

-- Agents can only see their own notifications
CREATE POLICY "Agents see own notifications" ON public.agent_notifications
FOR SELECT USING (agent_id = auth.uid());

CREATE POLICY "Admin full access to notifications" ON public.agent_notifications
FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents can update own notifications" ON public.agent_notifications
FOR UPDATE USING (agent_id = auth.uid());

-- Index for fast lookups
CREATE INDEX idx_agent_notifications_agent_id ON public.agent_notifications(agent_id);
CREATE INDEX idx_agent_notifications_created_at ON public.agent_notifications(created_at DESC);
CREATE INDEX idx_agent_notifications_is_read ON public.agent_notifications(agent_id, is_read);

-- =====================================================
-- ENHANCED process_loan_book_sync RPC
-- Now creates payment records and notifications
-- =====================================================
CREATE OR REPLACE FUNCTION public.process_loan_book_sync(p_sync_data TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sync_batch_id UUID := gen_random_uuid();
  v_admin_id UUID := auth.uid();
  v_result JSON;
  v_processed INT := 0;
  v_updated INT := 0;
  v_not_found INT := 0;
  v_resolved INT := 0;
  v_payments_created INT := 0;
  v_errors TEXT[] := '{}';
  v_data JSON;
  v_record JSON;
  v_nrc TEXT;
  v_arrears NUMERIC;
  v_payment_date TEXT;
  v_customer_id UUID;
  v_old_arrears NUMERIC;
  v_movement_type TEXT;
  v_arrears_change NUMERIC;
  v_ticket_id UUID;
  v_agent_id UUID;
BEGIN
  -- Admin check
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can perform loan book sync';
  END IF;

  -- Parse JSON - handle string input
  BEGIN
    v_data := p_sync_data::JSON;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'sync_batch_id', v_sync_batch_id,
      'processed', 0,
      'updated', 0,
      'not_found', 0,
      'resolved', 0,
      'payments_created', 0,
      'errors', ARRAY['Invalid JSON data: ' || SQLERRM]
    );
  END;

  -- Process each record
  FOR v_record IN SELECT * FROM json_array_elements(v_data)
  LOOP
    v_processed := v_processed + 1;
    
    BEGIN
      -- Extract NRC (critical - must exist)
      v_nrc := v_record->>'nrc_number';
      IF v_nrc IS NULL OR TRIM(v_nrc) = '' THEN
        v_errors := array_append(v_errors, 'Row ' || v_processed || ': Missing NRC');
        CONTINUE;
      END IF;
      v_nrc := TRIM(v_nrc);

      -- Extract arrears (null = no change, 0 = cleared)
      v_arrears := NULL;
      BEGIN
        IF v_record->>'arrears_amount' IS NOT NULL AND 
           TRIM(v_record->>'arrears_amount') != '' AND
           UPPER(TRIM(v_record->>'arrears_amount')) NOT IN ('#N/A', 'N/A', 'NULL') THEN
          v_arrears := (v_record->>'arrears_amount')::NUMERIC;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_arrears := NULL;
      END;

      -- Extract payment date (validated)
      v_payment_date := NULL;
      BEGIN
        IF v_record->>'last_payment_date' IS NOT NULL AND 
           TRIM(v_record->>'last_payment_date') != '' AND
           UPPER(TRIM(v_record->>'last_payment_date')) NOT IN ('#N/A', 'N/A', 'NULL') THEN
          DECLARE
            v_parsed_date TIMESTAMP;
            v_year INT;
          BEGIN
            v_parsed_date := (v_record->>'last_payment_date')::TIMESTAMP;
            v_year := EXTRACT(YEAR FROM v_parsed_date);
            IF v_year >= 1900 AND v_year <= 2100 THEN
              v_payment_date := v_parsed_date::TEXT;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            v_payment_date := NULL;
          END;
        END IF;
      END;

      -- Find customer by NRC
      SELECT id, loan_book_arrears, assigned_agent INTO v_customer_id, v_old_arrears, v_agent_id
      FROM master_customers
      WHERE nrc_number = v_nrc
      LIMIT 1;

      IF v_customer_id IS NULL THEN
        v_not_found := v_not_found + 1;
        CONTINUE;
      END IF;

      -- Default old arrears to 0 if null
      v_old_arrears := COALESCE(v_old_arrears, 0);

      -- Skip if no arrears value provided (no change)
      IF v_arrears IS NULL THEN
        -- Still update payment date if provided
        IF v_payment_date IS NOT NULL THEN
          UPDATE master_customers
          SET loan_book_last_payment_date = v_payment_date::TIMESTAMP
          WHERE id = v_customer_id;
        END IF;
        CONTINUE;
      END IF;

      -- Determine movement type
      IF v_arrears = 0 AND v_old_arrears > 0 THEN
        v_movement_type := 'Cleared';
        v_arrears_change := -v_old_arrears;
      ELSIF v_arrears < v_old_arrears THEN
        v_movement_type := 'Reduced';
        v_arrears_change := v_arrears - v_old_arrears;
      ELSIF v_arrears > v_old_arrears THEN
        v_movement_type := 'Increased';
        v_arrears_change := v_arrears - v_old_arrears;
      ELSE
        v_movement_type := 'Maintained';
        v_arrears_change := 0;
      END IF;

      -- Find the ticket for this customer
      SELECT id, assigned_agent INTO v_ticket_id, v_agent_id
      FROM tickets
      WHERE master_customer_id = v_customer_id
        AND status != 'Resolved'
      ORDER BY created_at DESC
      LIMIT 1;

      -- If no open ticket, get agent from master customer
      IF v_agent_id IS NULL THEN
        SELECT assigned_agent INTO v_agent_id FROM master_customers WHERE id = v_customer_id;
      END IF;

      -- =====================================================
      -- CREATE PAYMENT RECORD IF ARREARS DECREASED
      -- =====================================================
      IF v_arrears < v_old_arrears THEN
        DECLARE
          v_payment_amount NUMERIC := v_old_arrears - v_arrears;
          v_customer_name TEXT;
        BEGIN
          SELECT name INTO v_customer_name FROM master_customers WHERE id = v_customer_id;
          
          -- Create payment record
          INSERT INTO payments (
            master_customer_id,
            ticket_id,
            amount,
            payment_method,
            customer_name,
            notes,
            recorded_by,
            payment_date
          ) VALUES (
            v_customer_id,
            v_ticket_id,
            v_payment_amount,
            'Loan Book Sync',
            COALESCE(v_customer_name, 'Unknown'),
            'Auto-recorded from Daily Loan Book Sync. Movement: ' || v_movement_type,
            v_admin_id,
            COALESCE(v_payment_date::TIMESTAMP, now())
          );
          
          v_payments_created := v_payments_created + 1;

          -- Update master_customers payment totals
          UPDATE master_customers
          SET 
            total_paid = total_paid + v_payment_amount,
            outstanding_balance = GREATEST(0, total_owed - (total_paid + v_payment_amount)),
            last_payment_date = COALESCE(v_payment_date::TIMESTAMP, now())
          WHERE id = v_customer_id;

          -- Create notification for assigned agent
          IF v_agent_id IS NOT NULL THEN
            INSERT INTO agent_notifications (
              agent_id,
              title,
              message,
              type,
              related_ticket_id,
              related_customer_id
            ) VALUES (
              v_agent_id,
              CASE WHEN v_movement_type = 'Cleared' THEN 'Account Cleared!' 
                   ELSE 'Payment Received' END,
              CASE WHEN v_movement_type = 'Cleared' 
                   THEN v_customer_name || '''s arrears have been fully cleared (K' || v_payment_amount || '). Review and close ticket.'
                   ELSE v_customer_name || ' made a payment of K' || v_payment_amount || '. Arrears reduced from K' || v_old_arrears || ' to K' || v_arrears || '.'
              END,
              CASE WHEN v_movement_type = 'Cleared' THEN 'resolved' ELSE 'payment' END,
              v_ticket_id,
              v_customer_id
            );
          END IF;
        END;
      END IF;

      -- Update master_customers
      UPDATE master_customers
      SET 
        loan_book_arrears = v_arrears,
        loan_book_last_payment_date = COALESCE(v_payment_date::TIMESTAMP, loan_book_last_payment_date),
        updated_at = now()
      WHERE id = v_customer_id;

      -- Update ticket if exists
      IF v_ticket_id IS NOT NULL THEN
        IF v_arrears = 0 THEN
          -- Resolve ticket when arrears cleared
          UPDATE tickets
          SET 
            amount_owed = 0,
            status = 'Resolved',
            resolved_date = now(),
            updated_at = now()
          WHERE id = v_ticket_id;
          v_resolved := v_resolved + 1;
        ELSE
          -- Update amount on ticket
          UPDATE tickets
          SET 
            amount_owed = v_arrears,
            status = CASE WHEN status = 'Open' THEN 'In Progress' ELSE status END,
            updated_at = now()
          WHERE id = v_ticket_id;
        END IF;
      END IF;

      -- Log the sync movement
      INSERT INTO arrears_sync_logs (
        sync_batch_id,
        admin_user_id,
        nrc_number,
        master_customer_id,
        old_arrears,
        new_arrears,
        movement_type,
        loan_book_payment_date,
        ticket_resolved
      ) VALUES (
        v_sync_batch_id,
        v_admin_id,
        v_nrc,
        v_customer_id,
        v_old_arrears,
        v_arrears,
        v_movement_type,
        v_payment_date::TIMESTAMP,
        v_arrears = 0
      );

      v_updated := v_updated + 1;

    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 'Row ' || v_processed || ': ' || SQLERRM);
    END;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'sync_batch_id', v_sync_batch_id,
    'processed', v_processed,
    'updated', v_updated,
    'not_found', v_not_found,
    'resolved', v_resolved,
    'payments_created', v_payments_created,
    'errors', v_errors
  );
END;
$$;