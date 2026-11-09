-- Loan book is the source of truth (2026-11-04)
--
-- Rules agreed with the platform owner:
--   * Outstanding = the loan book arrears. Payments are never subtracted from it again.
--   * Collected = only loan book-verified amounts (the drop between the old and new arrears at each sync).
--   * Agent-recorded payments are 'reported' until the loan book shows a drop for that customer;
--     at that point they become 'overridden' and the loan book figure counts instead.
--   * A ticket stays open until the loan book shows zero arrears. Each sync reopens tickets that
--     were marked Resolved while the loan book still shows arrears.
--   * Agents are credited with verified collections on tickets assigned to them.
--
-- Runs as one transaction: if any statement fails, nothing changes.

BEGIN;

-- ============================================================
-- 1. Payment verification status
-- ============================================================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'reported';

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_verification_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_verification_status_check
  CHECK (verification_status IN ('reported', 'verified', 'overridden'));

CREATE INDEX IF NOT EXISTS idx_payments_ticket_status ON public.payments(ticket_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_payments_customer_status ON public.payments(master_customer_id, verification_status);

COMMENT ON COLUMN public.payments.verification_status IS
  'reported = recorded by a user, not yet confirmed; verified = created by the loan book sync; overridden = reported payment replaced by the loan book figure';

-- Agents can't change verification_status (guard trigger from phase 0, now with this column added).
DROP TRIGGER IF EXISTS guard_payment_columns ON public.payments;
CREATE TRIGGER guard_payment_columns
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_agent_column_changes(
    'recorded_by', 'source', 'master_customer_id', 'ticket_id', 'created_at', 'verification_status');

-- Agents record, edit and delete only their own payments that are still 'reported'.
DROP POLICY IF EXISTS "Agents record payments for own customers" ON public.payments;
DROP POLICY IF EXISTS "Agents edit own manual payments" ON public.payments;
DROP POLICY IF EXISTS "Agents delete own manual payments" ON public.payments;

CREATE POLICY "Agents record payments for own customers" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT is_staff(auth.uid()))
    AND recorded_by = (SELECT auth.uid())
    AND source = 'system_manual'
    AND verification_status = 'reported'
    AND payment_method IN ('Mobile Money', 'Bank')
    AND master_customer_id IN (SELECT id FROM master_customers WHERE assigned_agent = (SELECT auth.uid()))
  );
CREATE POLICY "Agents edit own reported payments" ON public.payments FOR UPDATE TO authenticated
  USING (
    (SELECT is_staff(auth.uid())) AND recorded_by = (SELECT auth.uid())
    AND source = 'system_manual' AND verification_status = 'reported'
  )
  WITH CHECK (
    recorded_by = (SELECT auth.uid())
    AND source = 'system_manual'
    AND verification_status = 'reported'
    AND payment_method IN ('Mobile Money', 'Bank')
  );
CREATE POLICY "Agents delete own reported payments" ON public.payments FOR DELETE TO authenticated
  USING (
    (SELECT is_staff(auth.uid())) AND recorded_by = (SELECT auth.uid())
    AND source = 'system_manual' AND verification_status = 'reported'
  );

-- ============================================================
-- 2. Customer balances come only from the loan book
-- ============================================================

-- The app used to recalculate outstanding_balance / total_paid / payment_status in the browser
-- from every payment. Direct API updates to those columns are now ignored; server functions set them.
CREATE OR REPLACE FUNCTION public.protect_loan_book_balances()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    NEW.outstanding_balance := OLD.outstanding_balance;
    NEW.total_paid := OLD.total_paid;
    NEW.payment_status := OLD.payment_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_loan_book_balances ON public.master_customers;
CREATE TRIGGER protect_loan_book_balances
  BEFORE UPDATE ON public.master_customers
  FOR EACH ROW EXECUTE FUNCTION public.protect_loan_book_balances();

-- Recalculates a customer's verified total and payment status.
CREATE OR REPLACE FUNCTION public.refresh_customer_payment_totals(p_master_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_paid numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM payments
  WHERE master_customer_id = p_master_customer_id AND verification_status = 'verified';

  UPDATE master_customers SET
    total_paid = v_paid,
    payment_status = CASE
      WHEN v_paid <= 0 THEN 'Not Paid'
      WHEN COALESCE(outstanding_balance, 0) <= 0 THEN 'Fully Paid'
      ELSE 'Partially Paid'
    END
  WHERE id = p_master_customer_id;
END;
$$;

-- ============================================================
-- 3. One-time cleanup of existing records (nothing is deleted)
-- ============================================================

-- Sync-created payments are verified.
UPDATE public.payments
SET verification_status = 'verified'
WHERE source = 'loanbook_daily' OR payment_method = 'Loan Book Sync';

-- Reported payments followed by a loan book drop for the same customer are overridden.
UPDATE public.payments p
SET verification_status = 'overridden'
WHERE p.verification_status = 'reported'
  AND EXISTS (
    SELECT 1 FROM public.arrears_sync_logs l
    WHERE l.master_customer_id = p.master_customer_id
      AND l.created_at > p.created_at
      AND lower(l.movement_type) IN ('cleared', 'reduced')
  );

-- Outstanding = the customer's latest ticket amount (the latest loan book / import figure).
UPDATE public.master_customers mc
SET outstanding_balance = latest.amount_owed
FROM (
  SELECT DISTINCT ON (master_customer_id) master_customer_id, amount_owed
  FROM public.tickets
  ORDER BY master_customer_id, created_at DESC
) latest
WHERE latest.master_customer_id = mc.id
  AND mc.outstanding_balance IS DISTINCT FROM latest.amount_owed;

-- Verified totals and payment status for every customer.
UPDATE public.master_customers mc
SET total_paid = v.paid,
    payment_status = CASE
      WHEN v.paid <= 0 THEN 'Not Paid'
      WHEN COALESCE(mc.outstanding_balance, 0) <= 0 THEN 'Fully Paid'
      ELSE 'Partially Paid'
    END
FROM (
  SELECT m.id, COALESCE(SUM(p.amount) FILTER (WHERE p.verification_status = 'verified'), 0) AS paid
  FROM public.master_customers m
  LEFT JOIN public.payments p ON p.master_customer_id = m.id
  GROUP BY m.id
) v
WHERE v.id = mc.id;

-- Tickets marked Resolved while arrears remain are reopened.
UPDATE public.tickets
SET status = 'In Progress', resolved_date = NULL
WHERE status IN ('Resolved', 'Pending Confirmation')
  AND amount_owed > 0;

-- ============================================================
-- 4. Loan book syncs: verify drops, override reported payments, reopen tickets
-- ============================================================

CREATE OR REPLACE FUNCTION public.process_loan_book_sync(p_sync_data text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  v_overridden int := 0;
  v_rows int;
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
  v_was_closed boolean;
BEGIN
  IF NOT has_role(v_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can run the loan book sync' USING ERRCODE = '42501';
  END IF;

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

    -- Prefer the open ticket; fall back to the latest closed one so it can be reopened.
    SELECT * INTO v_ticket_record FROM tickets
    WHERE master_customer_id = v_customer_record.id
    ORDER BY (status NOT IN ('Resolved', 'Pending Confirmation')) DESC, created_at DESC
    LIMIT 1;

    v_old_arrears := COALESCE(
      v_ticket_record.amount_owed,
      v_customer_record.loan_book_arrears,
      v_customer_record.outstanding_balance,
      0
    );

    IF v_new_arrears IS NULL THEN
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
    ELSE
      v_movement_type := 'increased';
      v_updated := v_updated + 1;
    END IF;

    UPDATE master_customers SET
      outstanding_balance = v_new_arrears,
      loan_book_arrears = v_new_arrears,
      loan_book_last_payment_date = COALESCE(v_last_payment_date, loan_book_last_payment_date),
      updated_at = now()
    WHERE id = v_customer_record.id;

    -- A loan book drop replaces whatever was reported for this customer.
    IF v_movement_type IN ('cleared', 'reduced') THEN
      UPDATE payments SET verification_status = 'overridden'
      WHERE master_customer_id = v_customer_record.id AND verification_status = 'reported';
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_overridden := v_overridden + v_rows;
    END IF;

    IF v_ticket_record.id IS NOT NULL THEN
      v_was_closed := v_ticket_record.status IN ('Resolved', 'Pending Confirmation');

      UPDATE tickets SET
        amount_owed = v_new_arrears,
        days_in_arrears = COALESCE(v_days_in_arrears, days_in_arrears),
        status = CASE
          WHEN v_new_arrears = 0 THEN 'Resolved'
          WHEN v_was_closed THEN 'In Progress'
          ELSE status
        END,
        resolved_date = CASE
          WHEN v_new_arrears = 0 THEN COALESCE(resolved_date, now())
          ELSE NULL
        END,
        updated_at = now()
      WHERE id = v_ticket_record.id;

      IF v_movement_type IN ('cleared', 'reduced') THEN
        v_payment_amount := v_old_arrears - v_new_arrears;

        INSERT INTO payments (
          ticket_id, master_customer_id, customer_name, amount,
          payment_method, payment_date, notes, recorded_by, source, verification_status
        ) VALUES (
          v_ticket_record.id, v_customer_record.id, v_customer_record.name,
          v_payment_amount, 'Bank', COALESCE(v_last_payment_date, now()),
          'Daily loan book sync - ' || v_movement_type || ' from K' || v_old_arrears || ' to K' || v_new_arrears,
          v_admin_id, 'loanbook_daily', 'verified'
        );
      END IF;

      IF v_ticket_record.assigned_agent IS NOT NULL THEN
        IF v_was_closed AND v_new_arrears > 0 THEN
          v_reopened := v_reopened + 1;
          INSERT INTO agent_notifications (
            agent_id, title, message, type, related_ticket_id, related_customer_id
          ) VALUES (
            v_ticket_record.assigned_agent,
            'Ticket Reopened',
            v_customer_record.name || ': loan book still shows K' || v_new_arrears::text || ' in arrears',
            'ticket_reopened',
            v_ticket_record.id,
            v_customer_record.id
          );
        ELSIF v_movement_type != 'maintained' THEN
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
    END IF;

    PERFORM refresh_customer_payment_totals(v_customer_record.id);

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
    'overridden_payments', v_overridden,
    'errors', v_errors
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_daily_loan_book_update(p_batch_id uuid, p_sync_data text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  v_overridden int := 0;
  v_rows int;
  v_errors text[] := ARRAY[]::text[];
  v_nrc text;
  v_new_arrears numeric;
  v_days_in_arrears int;
  v_last_payment_date timestamptz;
  v_ticket_record RECORD;
  v_old_arrears numeric;
  v_movement_type text;
  v_payment_amount numeric;
  v_was_closed boolean;
BEGIN
  IF NOT has_role(v_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can run the loan book update' USING ERRCODE = '42501';
  END IF;

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

    SELECT t.*, mc.name as customer_name_full, mc.id as master_id INTO v_ticket_record
    FROM tickets t
    JOIN master_customers mc ON mc.id = t.master_customer_id
    WHERE t.batch_id = p_batch_id AND t.nrc_number = v_nrc
    LIMIT 1;

    IF v_ticket_record.id IS NULL THEN
      v_not_found := v_not_found + 1;
      CONTINUE;
    END IF;

    v_old_arrears := COALESCE(v_ticket_record.amount_owed, 0);

    IF v_new_arrears IS NULL THEN
      v_maintained := v_maintained + 1;
      CONTINUE;
    END IF;

    v_was_closed := v_ticket_record.status IN ('Resolved', 'Pending Confirmation');

    IF v_old_arrears = v_new_arrears THEN
      v_movement_type := 'maintained';
      v_maintained := v_maintained + 1;
      -- No movement, but a ticket closed while arrears remain must still reopen.
      IF NOT (v_was_closed AND v_new_arrears > 0) THEN
        CONTINUE;
      END IF;
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

    UPDATE tickets SET
      amount_owed = v_new_arrears,
      days_in_arrears = COALESCE(v_days_in_arrears, days_in_arrears),
      status = CASE
        WHEN v_new_arrears = 0 THEN 'Resolved'
        WHEN v_was_closed THEN 'In Progress'
        ELSE status
      END,
      resolved_date = CASE
        WHEN v_new_arrears = 0 THEN COALESCE(resolved_date, now())
        ELSE NULL
      END,
      updated_at = now()
    WHERE id = v_ticket_record.id;

    UPDATE master_customers SET
      outstanding_balance = v_new_arrears,
      loan_book_arrears = v_new_arrears,
      loan_book_last_payment_date = COALESCE(v_last_payment_date, loan_book_last_payment_date),
      updated_at = now()
    WHERE id = v_ticket_record.master_id;

    IF v_movement_type IN ('cleared', 'reduced') THEN
      UPDATE payments SET verification_status = 'overridden'
      WHERE master_customer_id = v_ticket_record.master_id AND verification_status = 'reported';
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_overridden := v_overridden + v_rows;

      v_payment_amount := v_old_arrears - v_new_arrears;

      INSERT INTO payments (
        ticket_id, master_customer_id, customer_name, amount,
        payment_method, payment_date, notes, recorded_by, source, verification_status
      ) VALUES (
        v_ticket_record.id, v_ticket_record.master_id, v_ticket_record.customer_name_full,
        v_payment_amount, 'Bank', COALESCE(v_last_payment_date, now()),
        'Batch loan book sync - ' || v_movement_type || ' from K' || v_old_arrears || ' to K' || v_new_arrears,
        v_admin_id, 'loanbook_daily', 'verified'
      );
    END IF;

    PERFORM refresh_customer_payment_totals(v_ticket_record.master_id);

    IF v_ticket_record.assigned_agent IS NOT NULL THEN
      IF v_was_closed AND v_new_arrears > 0 THEN
        v_reopened := v_reopened + 1;
        INSERT INTO agent_notifications (
          agent_id, title, message, type, related_ticket_id, related_customer_id
        ) VALUES (
          v_ticket_record.assigned_agent,
          'Ticket Reopened',
          v_ticket_record.customer_name_full || ': loan book still shows K' || v_new_arrears::text || ' in arrears',
          'ticket_reopened',
          v_ticket_record.id,
          v_ticket_record.master_id
        );
      ELSIF v_movement_type != 'maintained' THEN
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
          v_ticket_record.customer_name_full || ': K' || v_old_arrears::text || ' → K' || v_new_arrears::text,
          'loan_book_update',
          v_ticket_record.id,
          v_ticket_record.master_id
        );
      END IF;
    END IF;

    INSERT INTO arrears_sync_logs (
      sync_batch_id, admin_user_id, nrc_number, master_customer_id,
      old_arrears, new_arrears, movement_type, loan_book_payment_date,
      ticket_resolved, source
    ) VALUES (
      v_sync_batch_id, v_admin_id, v_nrc, v_ticket_record.master_id,
      v_old_arrears, v_new_arrears, v_movement_type, v_last_payment_date,
      (v_new_arrears = 0), 'loanbook_daily'
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
    'overridden_payments', v_overridden,
    'errors', v_errors
  );
END;
$function$;

-- ============================================================
-- 5. Reports: outstanding = loan book, collected = verified only
--    (total_owed is reported as outstanding + collected, so owed - collected = outstanding still holds)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_agent_id uuid DEFAULT NULL::uuid, p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_customers integer;
  v_total_outstanding numeric;
  v_total_collected numeric;
  v_reported_pending numeric;
  v_open integer;
  v_in_progress integer;
  v_resolved integer;
  v_pending_confirmation integer;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    p_agent_id := auth.uid();
  END IF;

  SELECT
    COUNT(DISTINCT t.master_customer_id),
    COALESCE(SUM(t.amount_owed), 0),
    COUNT(*) FILTER (WHERE t.status = 'Open'),
    COUNT(*) FILTER (WHERE t.status = 'In Progress'),
    COUNT(*) FILTER (WHERE t.status = 'Resolved'),
    COUNT(*) FILTER (WHERE t.status = 'Pending Confirmation')
  INTO v_total_customers, v_total_outstanding, v_open, v_in_progress, v_resolved, v_pending_confirmation
  FROM tickets t
  WHERE (p_batch_id IS NULL OR t.batch_id = p_batch_id)
    AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id);

  SELECT
    COALESCE(SUM(p.amount) FILTER (WHERE p.verification_status = 'verified'), 0),
    COALESCE(SUM(p.amount) FILTER (WHERE p.verification_status = 'reported'), 0)
  INTO v_total_collected, v_reported_pending
  FROM payments p
  JOIN tickets t ON t.id = p.ticket_id
  WHERE (p_batch_id IS NULL OR t.batch_id = p_batch_id)
    AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id);

  RETURN jsonb_build_object(
    'total_customers', v_total_customers,
    'total_outstanding', v_total_outstanding,
    'total_collected', v_total_collected,
    'reported_pending', v_reported_pending,
    'collection_rate', CASE WHEN (v_total_outstanding + v_total_collected) > 0
      THEN ROUND((v_total_collected / (v_total_outstanding + v_total_collected)) * 100, 1)
      ELSE 0 END,
    'open_tickets', v_open,
    'in_progress_tickets', v_in_progress,
    'resolved_tickets', v_resolved,
    'pending_confirmation_tickets', v_pending_confirmation
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_weekly_report_stats(p_agent_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_agent uuid;
  v_tickets integer;
  v_outstanding numeric;
  v_collected numeric;
  v_open integer;
  v_in_progress integer;
  v_resolved integer;
BEGIN
  IF has_role(auth.uid(), 'admin'::app_role) THEN
    v_agent := p_agent_id;
  ELSE
    v_agent := auth.uid();
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(t.amount_owed), 0),
    COUNT(*) FILTER (WHERE t.status = 'Open'),
    COUNT(*) FILTER (WHERE t.status = 'In Progress'),
    COUNT(*) FILTER (WHERE t.status = 'Resolved')
  INTO v_tickets, v_outstanding, v_open, v_in_progress, v_resolved
  FROM tickets t
  WHERE (v_agent IS NULL OR t.assigned_agent = v_agent);

  SELECT COALESCE(SUM(p.amount), 0) INTO v_collected
  FROM payments p
  JOIN tickets t ON t.id = p.ticket_id
  WHERE p.verification_status = 'verified'
    AND (v_agent IS NULL OR t.assigned_agent = v_agent);

  RETURN json_build_object(
    'total_tickets', v_tickets,
    'total_owed', v_outstanding + v_collected,
    'total_collected', v_collected,
    'outstanding_balance', v_outstanding,
    'collection_rate', CASE WHEN (v_outstanding + v_collected) > 0
      THEN ROUND((v_collected / (v_outstanding + v_collected)) * 100, 2)
      ELSE 0 END,
    'open_tickets', v_open,
    'in_progress_tickets', v_in_progress,
    'resolved_tickets', v_resolved
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_collections_by_agent(p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result json;
  v_is_admin boolean := has_role(auth.uid(), 'admin'::app_role);
BEGIN
  SELECT json_agg(
    json_build_object(
      'agent_id', agent_id,
      'name', agent_name,
      'collected', collected,
      'tickets', ticket_count
    )
    ORDER BY collected DESC
  )
  INTO v_result
  FROM (
    SELECT
      pr.id AS agent_id,
      COALESCE(pr.display_name, pr.full_name) AS agent_name,
      COALESCE((
        SELECT SUM(p.amount)
        FROM payments p
        JOIN tickets t2 ON t2.id = p.ticket_id
        WHERE t2.assigned_agent = pr.id
          AND (p_batch_id IS NULL OR t2.batch_id = p_batch_id)
          AND p.verification_status = 'verified'
      ), 0) AS collected,
      COUNT(t.id) AS ticket_count
    FROM profiles pr
    JOIN tickets t ON t.assigned_agent = pr.id
      AND (p_batch_id IS NULL OR t.batch_id = p_batch_id)
    WHERE v_is_admin OR pr.id = auth.uid()
    GROUP BY pr.id, pr.display_name, pr.full_name
  ) agents;

  RETURN COALESCE(v_result, '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_interaction_analytics(p_agent_id uuid DEFAULT NULL::uuid, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
  v_start_date TIMESTAMP WITH TIME ZONE;
  v_end_date TIMESTAMP WITH TIME ZONE;
  v_effective_agent_id uuid;
BEGIN
  v_start_date := COALESCE(p_start_date::TIMESTAMP WITH TIME ZONE, NOW() - INTERVAL '7 days');
  v_end_date := COALESCE(p_end_date::TIMESTAMP WITH TIME ZONE, NOW());

  IF has_role(auth.uid(), 'admin'::app_role) THEN
    v_effective_agent_id := p_agent_id;
  ELSE
    v_effective_agent_id := auth.uid();
  END IF;

  WITH agent_stats AS (
    SELECT
      pr.id AS agent_id,
      pr.display_name,
      pr.full_name,
      (SELECT COUNT(*) FROM tickets t
        WHERE t.assigned_agent = pr.id AND t.status = 'In Progress') AS in_progress_tickets,
      (SELECT COUNT(*) FROM tickets t
        WHERE t.assigned_agent = pr.id AND t.status = 'Resolved') AS tickets_resolved,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
        JOIN tickets t ON t.id = p.ticket_id
        WHERE t.assigned_agent = pr.id
          AND p.verification_status = 'verified'
          AND p.created_at >= v_start_date AND p.created_at <= v_end_date) AS collected_amount
    FROM profiles pr
    WHERE (v_effective_agent_id IS NULL OR pr.id = v_effective_agent_id)
  )
  SELECT json_build_object(
    'total_interactions', (SELECT COALESCE(SUM(in_progress_tickets + tickets_resolved), 0) FROM agent_stats),
    'total_tickets_resolved', (SELECT COALESCE(SUM(tickets_resolved), 0) FROM agent_stats),
    'total_collected', (SELECT COALESCE(SUM(collected_amount), 0) FROM agent_stats),
    'by_agent', (
      SELECT json_agg(json_build_object(
        'agent_id', agent_id,
        'agent_name', COALESCE(display_name, full_name),
        'in_progress_tickets', in_progress_tickets,
        'tickets_resolved', tickets_resolved,
        'collected_amount', collected_amount,
        'total_interactions', in_progress_tickets + tickets_resolved
      ))
      FROM agent_stats
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_interaction_analytics(p_start_date text DEFAULT NULL::text, p_end_date text DEFAULT NULL::text, p_agent_id text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Same report as the uuid/date version.
  RETURN public.get_interaction_analytics(
    NULLIF(p_agent_id, '')::uuid,
    NULLIF(p_start_date, '')::date,
    NULLIF(p_end_date, '')::date
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_agent_analytics(p_agent_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can access this function';
  END IF;

  WITH agent_stats AS (
    SELECT
      pr.id AS agent_id,
      COALESCE(pr.display_name, pr.full_name) AS agent_name,
      (SELECT COUNT(*) FROM tickets t WHERE t.assigned_agent = pr.id) AS total_tickets,
      (SELECT COALESCE(SUM(t.amount_owed), 0) FROM tickets t WHERE t.assigned_agent = pr.id) AS outstanding,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
        JOIN tickets t ON t.id = p.ticket_id
        WHERE t.assigned_agent = pr.id AND p.verification_status = 'verified') AS collected,
      (SELECT COUNT(*) FROM tickets t
        WHERE t.assigned_agent = pr.id AND t.status IN ('In Progress', 'Resolved')) AS interaction_count
    FROM profiles pr
    WHERE (p_agent_id IS NULL OR pr.id = p_agent_id)
  )
  SELECT json_build_object(
    'agents', (
      SELECT json_agg(json_build_object(
        'agent_id', agent_id,
        'agent_name', agent_name,
        'total_tickets', total_tickets,
        'total_owed', outstanding + collected,
        'total_collected', collected,
        'outstanding_balance', outstanding,
        'collection_rate', CASE WHEN (outstanding + collected) > 0
          THEN ROUND((collected / (outstanding + collected)) * 100, 2)
          ELSE 0 END,
        'interaction_count', interaction_count
      ))
      FROM agent_stats
      WHERE total_tickets > 0 OR interaction_count > 0
    ),
    'totals', (
      SELECT json_build_object(
        'total_tickets', COALESCE(SUM(total_tickets), 0),
        'total_owed', COALESCE(SUM(outstanding + collected), 0),
        'total_collected', COALESCE(SUM(collected), 0),
        'outstanding_balance', COALESCE(SUM(outstanding), 0),
        'total_interactions', COALESCE(SUM(interaction_count), 0)
      )
      FROM agent_stats
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- Admin correction of amount owed: the new amount IS the outstanding (payments are not subtracted).
-- The next loan book sync still overrides it.
CREATE OR REPLACE FUNCTION public.update_amount_owed(p_ticket_id uuid, p_new_amount numeric, p_source text DEFAULT 'manual_edit'::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket RECORD;
  v_old_amount NUMERIC;
  v_new_status TEXT;
  v_user_id UUID := auth.uid();
BEGIN
  IF NOT has_role(v_user_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change the amount owed';
  END IF;

  IF p_new_amount < 0 THEN
    RAISE EXCEPTION 'Amount must be >= 0';
  END IF;

  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  v_old_amount := COALESCE(v_ticket.amount_owed, 0);

  IF v_old_amount = p_new_amount THEN
    RETURN jsonb_build_object('success', true, 'message', 'No change required');
  END IF;

  v_new_status := CASE
    WHEN p_new_amount = 0 THEN 'Resolved'
    WHEN v_ticket.status IN ('Resolved', 'Pending Confirmation') THEN 'In Progress'
    ELSE v_ticket.status
  END;

  INSERT INTO amount_owed_audit_logs (
    ticket_id, master_customer_id, old_amount, new_amount, changed_by, source, notes
  ) VALUES (
    p_ticket_id, v_ticket.master_customer_id, v_old_amount, p_new_amount, v_user_id, p_source, p_notes
  );

  UPDATE tickets SET
    amount_owed = p_new_amount,
    status = v_new_status,
    resolved_date = CASE WHEN p_new_amount = 0 THEN COALESCE(resolved_date, now()) ELSE NULL END,
    updated_at = now()
  WHERE id = p_ticket_id;

  UPDATE master_customers SET
    total_owed = p_new_amount,
    outstanding_balance = p_new_amount,
    updated_at = now()
  WHERE id = v_ticket.master_customer_id;

  PERFORM refresh_customer_payment_totals(v_ticket.master_customer_id);

  IF v_ticket.assigned_agent IS NOT NULL THEN
    INSERT INTO agent_notifications (
      agent_id, title, message, type, related_ticket_id, related_customer_id
    ) VALUES (
      v_ticket.assigned_agent,
      'Amount Owed Updated',
      format('Amount changed from %s to %s',
        to_char(v_old_amount, 'FM999,999,999.00'),
        to_char(p_new_amount, 'FM999,999,999.00')
      ),
      'info',
      p_ticket_id,
      v_ticket.master_customer_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'old_amount', v_old_amount,
    'new_amount', p_new_amount,
    'new_balance', p_new_amount,
    'new_status', v_new_status
  );
END;
$function$;

-- ============================================================
-- 6. Permissions on the new functions
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.protect_loan_book_balances() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_customer_payment_totals(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
