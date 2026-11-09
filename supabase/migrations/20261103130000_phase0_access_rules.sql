-- Phase 0: access rules and money-record protection (2026-11-03)
--
-- Business rules agreed with the platform owner:
--   * New sign-ups get no access until an admin approves them (assigns agent or admin).
--   * Only admins change amount owed, run loan book syncs, import batches and delete batches.
--   * Agents may add walk-in customers (assigned to themselves) and delete their own tickets.
--   * Agents may record, edit and delete their own manual payments; every payment change is audited.
--   * Loan book syncs keep creating auto-payments (source = 'loanbook_daily').
--   * Deleting a ticket or batch no longer deletes payments; they stay on record.
--
-- Runs as one transaction: if any statement fails, nothing changes.

BEGIN;

-- ============================================================
-- 1. Helpers
-- ============================================================

-- True when the user has been approved (holds any role).
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin', 'agent')
  )
$$;

-- Blocks non-admins from changing the columns passed as trigger arguments.
-- Server functions run as their owner (not 'authenticated'), so syncs and RPCs are unaffected.
CREATE OR REPLACE FUNCTION public.guard_agent_column_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_col text;
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
BEGIN
  IF current_user <> 'authenticated' OR has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  FOREACH v_col IN ARRAY TG_ARGV LOOP
    IF (v_old -> v_col) IS DISTINCT FROM (v_new -> v_col) THEN
      RAISE EXCEPTION 'Only admins can change %.%', TG_TABLE_NAME, v_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_ticket_columns ON public.tickets;
CREATE TRIGGER guard_ticket_columns
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_agent_column_changes(
    'amount_owed', 'original_amount', 'assigned_agent', 'batch_id',
    'master_customer_id', 'loan_id', 'nrc_number');

DROP TRIGGER IF EXISTS guard_master_customer_columns ON public.master_customers;
CREATE TRIGGER guard_master_customer_columns
  BEFORE UPDATE ON public.master_customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_agent_column_changes(
    'nrc_number', 'name', 'assigned_agent', 'total_owed', 'loan_book_arrears',
    'loan_book_last_payment_date', 'next_of_kin_name', 'next_of_kin_contact',
    'workplace_contact', 'workplace_destination', 'employer_name', 'branch_name');

DROP TRIGGER IF EXISTS guard_batch_columns ON public.batches;
CREATE TRIGGER guard_batch_columns
  BEFORE UPDATE ON public.batches
  FOR EACH ROW EXECUTE FUNCTION public.guard_agent_column_changes(
    'name', 'institution_name', 'uploaded_by', 'upload_date');

DROP TRIGGER IF EXISTS guard_payment_columns ON public.payments;
CREATE TRIGGER guard_payment_columns
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_agent_column_changes(
    'recorded_by', 'source', 'master_customer_id', 'ticket_id', 'created_at');

-- New payments must be positive (existing rows are not re-checked).
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0) NOT VALID;

-- ============================================================
-- 2. Payment audit trail (every insert, edit and delete)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payment_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_payment_id ON public.payment_audit_logs(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_changed_at ON public.payment_audit_logs(changed_at);

ALTER TABLE public.payment_audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_audit_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.payment_audit_logs FROM authenticated;

CREATE OR REPLACE FUNCTION public.log_payment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO payment_audit_logs (payment_id, action, new_data, changed_by)
    VALUES (NEW.id, TG_OP, to_jsonb(NEW), auth.uid());
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO payment_audit_logs (payment_id, action, old_data, new_data, changed_by)
    VALUES (NEW.id, TG_OP, to_jsonb(OLD), to_jsonb(NEW), auth.uid());
  ELSE
    INSERT INTO payment_audit_logs (payment_id, action, old_data, changed_by)
    VALUES (OLD.id, TG_OP, to_jsonb(OLD), auth.uid());
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS audit_payment_changes ON public.payments;
CREATE TRIGGER audit_payment_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.log_payment_change();

-- ============================================================
-- 3. Access rules (RLS): drop every existing policy, recreate for logged-in users only
-- ============================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Logged-in users can't truncate or alter tables through the API.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

-- profiles
CREATE POLICY "Staff view profiles" ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT is_staff(auth.uid())) OR id = (SELECT auth.uid()));
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

-- user_roles
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "Users view own role" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- batches
CREATE POLICY "Admins manage batches" ON public.batches FOR ALL TO authenticated
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "Staff view batches" ON public.batches FOR SELECT TO authenticated
  USING ((SELECT is_staff(auth.uid())));
-- Walk-in customers bump batch counts; the column guard limits agents to customer_count / total_amount.
CREATE POLICY "Agents update batch counts" ON public.batches FOR UPDATE TO authenticated
  USING ((SELECT is_staff(auth.uid()))) WITH CHECK ((SELECT is_staff(auth.uid())));

-- master_customers
CREATE POLICY "Admins manage customers" ON public.master_customers FOR ALL TO authenticated
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "Agents view assigned customers" ON public.master_customers FOR SELECT TO authenticated
  USING ((SELECT is_staff(auth.uid())) AND assigned_agent = (SELECT auth.uid()));
CREATE POLICY "Agents add own walk-in customers" ON public.master_customers FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT is_staff(auth.uid()))
    AND assigned_agent = (SELECT auth.uid())
    AND COALESCE(total_owed, 0) = 0
    AND COALESCE(total_paid, 0) = 0
    AND COALESCE(outstanding_balance, 0) = 0
    AND COALESCE(loan_book_arrears, 0) = 0
  );
CREATE POLICY "Agents update assigned customers" ON public.master_customers FOR UPDATE TO authenticated
  USING ((SELECT is_staff(auth.uid())) AND assigned_agent = (SELECT auth.uid()))
  WITH CHECK (assigned_agent = (SELECT auth.uid()));

-- batch_customers
CREATE POLICY "Admins manage batch customers" ON public.batch_customers FOR ALL TO authenticated
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "Agents view assigned batch customers" ON public.batch_customers FOR SELECT TO authenticated
  USING ((SELECT is_staff(auth.uid())) AND assigned_agent_id = (SELECT auth.uid()));
CREATE POLICY "Agents add own walk-in batch customers" ON public.batch_customers FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT is_staff(auth.uid()))
    AND assigned_agent_id = (SELECT auth.uid())
    AND master_customer_id IN (SELECT id FROM master_customers WHERE assigned_agent = (SELECT auth.uid()))
  );

-- tickets
CREATE POLICY "Admins manage tickets" ON public.tickets FOR ALL TO authenticated
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "Agents view assigned tickets" ON public.tickets FOR SELECT TO authenticated
  USING ((SELECT is_staff(auth.uid())) AND assigned_agent = (SELECT auth.uid()));
-- Only on their own customers, so an agent can't use a new ticket to take over someone else's customer.
CREATE POLICY "Agents add tickets for own customers" ON public.tickets FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT is_staff(auth.uid()))
    AND assigned_agent = (SELECT auth.uid())
    AND status = 'Open'
    AND master_customer_id IN (SELECT id FROM master_customers WHERE assigned_agent = (SELECT auth.uid()))
  );
CREATE POLICY "Agents update assigned tickets" ON public.tickets FOR UPDATE TO authenticated
  USING ((SELECT is_staff(auth.uid())) AND assigned_agent = (SELECT auth.uid()))
  WITH CHECK (assigned_agent = (SELECT auth.uid()));

-- payments
CREATE POLICY "Admins manage payments" ON public.payments FOR ALL TO authenticated
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "Agents view own and assigned payments" ON public.payments FOR SELECT TO authenticated
  USING (
    (SELECT is_staff(auth.uid()))
    AND (recorded_by = (SELECT auth.uid())
         OR ticket_id IN (SELECT id FROM tickets WHERE assigned_agent = (SELECT auth.uid())))
  );
CREATE POLICY "Agents record payments for own customers" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT is_staff(auth.uid()))
    AND recorded_by = (SELECT auth.uid())
    AND source = 'system_manual'
    AND payment_method IN ('Mobile Money', 'Bank')
    AND master_customer_id IN (SELECT id FROM master_customers WHERE assigned_agent = (SELECT auth.uid()))
  );
CREATE POLICY "Agents edit own manual payments" ON public.payments FOR UPDATE TO authenticated
  USING ((SELECT is_staff(auth.uid())) AND recorded_by = (SELECT auth.uid()) AND source = 'system_manual')
  WITH CHECK (
    recorded_by = (SELECT auth.uid())
    AND source = 'system_manual'
    AND payment_method IN ('Mobile Money', 'Bank')
  );
CREATE POLICY "Agents delete own manual payments" ON public.payments FOR DELETE TO authenticated
  USING ((SELECT is_staff(auth.uid())) AND recorded_by = (SELECT auth.uid()) AND source = 'system_manual');

-- call_logs
CREATE POLICY "Admins manage call logs" ON public.call_logs FOR ALL TO authenticated
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "Agents view own and customer call logs" ON public.call_logs FOR SELECT TO authenticated
  USING (
    (SELECT is_staff(auth.uid()))
    AND (agent_id = (SELECT auth.uid())
         OR master_customer_id IN (SELECT id FROM master_customers WHERE assigned_agent = (SELECT auth.uid())))
  );
CREATE POLICY "Agents add own call logs" ON public.call_logs FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_staff(auth.uid())) AND agent_id = (SELECT auth.uid()));
CREATE POLICY "Agents edit own call logs" ON public.call_logs FOR UPDATE TO authenticated
  USING ((SELECT is_staff(auth.uid())) AND agent_id = (SELECT auth.uid()))
  WITH CHECK (agent_id = (SELECT auth.uid()));

-- agent_notifications
CREATE POLICY "Admins manage notifications" ON public.agent_notifications FOR ALL TO authenticated
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "Agents view own notifications" ON public.agent_notifications FOR SELECT TO authenticated
  USING (agent_id = (SELECT auth.uid()));
CREATE POLICY "Agents update own notifications" ON public.agent_notifications FOR UPDATE TO authenticated
  USING (agent_id = (SELECT auth.uid())) WITH CHECK (agent_id = (SELECT auth.uid()));

-- Audit and sync logs are read-only for everyone (written only by server functions).
CREATE POLICY "Admins view sync logs" ON public.arrears_sync_logs FOR SELECT TO authenticated
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "Agents view sync logs for assigned customers" ON public.arrears_sync_logs FOR SELECT TO authenticated
  USING (
    (SELECT is_staff(auth.uid()))
    AND master_customer_id IN (SELECT id FROM master_customers WHERE assigned_agent = (SELECT auth.uid()))
  );

CREATE POLICY "Admins view amount audit logs" ON public.amount_owed_audit_logs FOR SELECT TO authenticated
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "Agents view amount audit logs for own tickets" ON public.amount_owed_audit_logs FOR SELECT TO authenticated
  USING (
    (SELECT is_staff(auth.uid()))
    AND ticket_id IN (SELECT id FROM tickets WHERE assigned_agent = (SELECT auth.uid()))
  );

CREATE POLICY "Admins view payment audit logs" ON public.payment_audit_logs FOR SELECT TO authenticated
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)));

-- ============================================================
-- 4. Sign-ups wait for admin approval
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Profile only: no role until an admin approves the account in Settings.
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  RETURN NEW;
END;
$function$;

-- Approving a pending user (no role yet) inserts the role instead of failing.
CREATE OR REPLACE FUNCTION public.update_user_role(p_target_user_id uuid, p_new_role app_role)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_role app_role;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change user roles';
  END IF;

  IF p_target_user_id = auth.uid() AND p_new_role = 'agent' THEN
    RAISE EXCEPTION 'You cannot demote yourself';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT role INTO v_current_role FROM user_roles WHERE user_id = p_target_user_id;

  IF v_current_role IS NULL THEN
    INSERT INTO user_roles (user_id, role) VALUES (p_target_user_id, p_new_role);
  ELSE
    UPDATE user_roles SET role = p_new_role WHERE user_id = p_target_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_target_user_id,
    'old_role', COALESCE(v_current_role::text, 'pending'),
    'new_role', p_new_role
  );
END;
$function$;

-- ============================================================
-- 5. Admin-only operations
-- ============================================================

-- Amount owed: admins only.
CREATE OR REPLACE FUNCTION public.update_amount_owed(p_ticket_id uuid, p_new_amount numeric, p_source text DEFAULT 'manual_edit'::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket RECORD;
  v_old_amount NUMERIC;
  v_total_paid NUMERIC;
  v_new_balance NUMERIC;
  v_new_status TEXT;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF NOT has_role(v_user_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change the amount owed';
  END IF;

  IF p_new_amount < 0 THEN
    RAISE EXCEPTION 'Amount must be >= 0';
  END IF;

  SELECT t.*, mc.id as mc_id
  INTO v_ticket
  FROM tickets t
  JOIN master_customers mc ON mc.id = t.master_customer_id
  WHERE t.id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  v_old_amount := COALESCE(v_ticket.amount_owed, 0);

  IF v_old_amount = p_new_amount THEN
    RETURN jsonb_build_object('success', true, 'message', 'No change required');
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM payments
  WHERE ticket_id = p_ticket_id;

  v_new_balance := GREATEST(0, p_new_amount - v_total_paid);

  IF p_new_amount = 0 THEN
    v_new_status := 'Pending Confirmation';
  ELSIF v_total_paid = 0 THEN
    v_new_status := 'Open';
  ELSIF v_new_balance > 0 THEN
    v_new_status := 'In Progress';
  ELSE
    v_new_status := 'Pending Confirmation';
  END IF;

  INSERT INTO amount_owed_audit_logs (
    ticket_id, master_customer_id, old_amount, new_amount, changed_by, source, notes
  ) VALUES (
    p_ticket_id, v_ticket.master_customer_id, v_old_amount, p_new_amount, v_user_id, p_source, p_notes
  );

  UPDATE tickets
  SET amount_owed = p_new_amount, status = v_new_status, updated_at = now()
  WHERE id = p_ticket_id;

  UPDATE master_customers
  SET total_owed = p_new_amount, outstanding_balance = v_new_balance, updated_at = now()
  WHERE id = v_ticket.master_customer_id;

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
    'new_balance', v_new_balance,
    'new_status', v_new_status
  );
END;
$function$;

-- Ticket delete: agents (own tickets) and admins. Payments are kept (detached) instead of deleted,
-- and the customer record is kept while it still has payments or call notes.
CREATE OR REPLACE FUNCTION public.hard_delete_ticket(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean;
  v_ticket_agent uuid;
  v_master_customer_id uuid;
  v_batch_id uuid;
  v_detached_payments integer := 0;
  v_detached_call_logs integer := 0;
  v_has_other_tickets boolean;
  v_has_history boolean := false;
BEGIN
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);

  SELECT assigned_agent, master_customer_id, batch_id
  INTO v_ticket_agent, v_master_customer_id, v_batch_id
  FROM tickets
  WHERE id = p_ticket_id;

  IF v_master_customer_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  IF NOT v_is_admin AND v_ticket_agent IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only delete tickets assigned to you';
  END IF;

  UPDATE call_logs SET ticket_id = NULL WHERE ticket_id = p_ticket_id;
  GET DIAGNOSTICS v_detached_call_logs = ROW_COUNT;

  UPDATE payments SET ticket_id = NULL WHERE ticket_id = p_ticket_id;
  GET DIAGNOSTICS v_detached_payments = ROW_COUNT;

  DELETE FROM tickets WHERE id = p_ticket_id;

  IF v_batch_id IS NOT NULL THEN
    DELETE FROM batch_customers
    WHERE batch_id = v_batch_id AND master_customer_id = v_master_customer_id;
  END IF;

  SELECT EXISTS(SELECT 1 FROM tickets WHERE master_customer_id = v_master_customer_id)
  INTO v_has_other_tickets;

  IF NOT v_has_other_tickets THEN
    SELECT EXISTS(SELECT 1 FROM call_logs WHERE master_customer_id = v_master_customer_id)
        OR EXISTS(SELECT 1 FROM payments WHERE master_customer_id = v_master_customer_id)
    INTO v_has_history;

    IF NOT v_has_history THEN
      DELETE FROM master_customers WHERE id = v_master_customer_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_call_logs', 0,
    'detached_call_logs', v_detached_call_logs,
    'deleted_payments', 0,
    'detached_payments', v_detached_payments,
    'master_customer_deleted', NOT v_has_other_tickets AND NOT v_has_history
  );
END;
$function$;

-- Batch delete: admins only. Payments are kept (detached) instead of deleted.
CREATE OR REPLACE FUNCTION public.safe_delete_batch(p_batch_id uuid, p_chunk_size integer DEFAULT 500, p_archive boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_detached_call_logs integer := 0;
  v_detached_payments integer := 0;
  v_deleted_tickets integer := 0;
  v_deleted_batch_customers integer := 0;
  v_deleted_master_customers integer := 0;
  v_ticket_ids uuid[];
  v_master_customer_ids uuid[];
  v_rows_affected integer;
  v_archive_data jsonb;
  v_batch_data jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can delete batches';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM batches WHERE id = p_batch_id) THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;

  IF p_archive THEN
    SELECT to_jsonb(b.*) INTO v_batch_data FROM batches b WHERE b.id = p_batch_id;

    SELECT jsonb_build_object(
      'batch', v_batch_data,
      'batch_customers', COALESCE((SELECT jsonb_agg(to_jsonb(bc.*)) FROM batch_customers bc WHERE bc.batch_id = p_batch_id), '[]'::jsonb),
      'tickets', COALESCE((SELECT jsonb_agg(to_jsonb(t.*)) FROM tickets t WHERE t.batch_id = p_batch_id), '[]'::jsonb),
      'payments', COALESCE((
        SELECT jsonb_agg(to_jsonb(p.*))
        FROM payments p
        WHERE p.ticket_id IN (SELECT id FROM tickets WHERE batch_id = p_batch_id)
      ), '[]'::jsonb),
      'call_logs', COALESCE((
        SELECT jsonb_agg(to_jsonb(cl.*))
        FROM call_logs cl
        WHERE cl.ticket_id IN (SELECT id FROM tickets WHERE batch_id = p_batch_id)
      ), '[]'::jsonb),
      'archived_at', now(),
      'archived_by', auth.uid()
    ) INTO v_archive_data;
  END IF;

  SELECT ARRAY_AGG(id) INTO v_ticket_ids FROM tickets WHERE batch_id = p_batch_id;

  SELECT ARRAY_AGG(master_customer_id) INTO v_master_customer_ids
  FROM batch_customers WHERE batch_id = p_batch_id;

  IF v_ticket_ids IS NOT NULL AND array_length(v_ticket_ids, 1) > 0 THEN
    UPDATE call_logs SET ticket_id = NULL WHERE ticket_id = ANY(v_ticket_ids);
    GET DIAGNOSTICS v_detached_call_logs = ROW_COUNT;

    UPDATE payments SET ticket_id = NULL WHERE ticket_id = ANY(v_ticket_ids);
    GET DIAGNOSTICS v_detached_payments = ROW_COUNT;
  END IF;

  LOOP
    DELETE FROM tickets
    WHERE batch_id = p_batch_id
    AND id IN (SELECT id FROM tickets WHERE batch_id = p_batch_id LIMIT p_chunk_size);
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    v_deleted_tickets := v_deleted_tickets + v_rows_affected;
    EXIT WHEN v_rows_affected = 0 OR v_rows_affected < p_chunk_size;
  END LOOP;

  LOOP
    DELETE FROM batch_customers
    WHERE batch_id = p_batch_id
    AND id IN (SELECT id FROM batch_customers WHERE batch_id = p_batch_id LIMIT p_chunk_size);
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    v_deleted_batch_customers := v_deleted_batch_customers + v_rows_affected;
    EXIT WHEN v_rows_affected = 0 OR v_rows_affected < p_chunk_size;
  END LOOP;

  -- Remove customers no longer in any batch and with no payments or call notes.
  IF v_master_customer_ids IS NOT NULL THEN
    DELETE FROM master_customers mc
    WHERE mc.id = ANY(v_master_customer_ids)
      AND NOT EXISTS (SELECT 1 FROM batch_customers bc WHERE bc.master_customer_id = mc.id)
      AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.master_customer_id = mc.id)
      AND NOT EXISTS (SELECT 1 FROM call_logs cl WHERE cl.master_customer_id = mc.id)
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.master_customer_id = mc.id);
    GET DIAGNOSTICS v_deleted_master_customers = ROW_COUNT;
  END IF;

  DELETE FROM batches WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_call_logs', 0,
    'detached_call_logs', v_detached_call_logs,
    'deleted_payments', 0,
    'detached_payments', v_detached_payments,
    'deleted_tickets', v_deleted_tickets,
    'deleted_batch_customers', v_deleted_batch_customers,
    'deleted_master_customers', v_deleted_master_customers,
    'archive_data', CASE WHEN p_archive THEN v_archive_data ELSE null END
  );
END;
$function$;

-- Global loan book sync: admins only (body otherwise unchanged from live).
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

    SELECT * INTO v_ticket_record FROM tickets
    WHERE master_customer_id = v_customer_record.id
      AND status != 'Resolved'
    ORDER BY created_at DESC
    LIMIT 1;

    v_old_arrears := COALESCE(v_ticket_record.amount_owed, v_customer_record.outstanding_balance, 0);

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
$function$;

-- Batch loan book update: admins only, and search_path pinned (body otherwise unchanged from live).
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
  v_errors text[] := ARRAY[]::text[];
  v_nrc text;
  v_new_arrears numeric;
  v_days_in_arrears int;
  v_last_payment_date timestamptz;
  v_ticket_record RECORD;
  v_old_arrears numeric;
  v_movement_type text;
  v_payment_amount numeric;
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

    IF v_old_arrears = v_new_arrears THEN
      v_movement_type := 'maintained';
      v_maintained := v_maintained + 1;
      CONTINUE;
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
      status = CASE WHEN v_new_arrears = 0 THEN 'Resolved' ELSE status END,
      resolved_date = CASE WHEN v_new_arrears = 0 THEN now() ELSE resolved_date END,
      updated_at = now()
    WHERE id = v_ticket_record.id;

    UPDATE master_customers SET
      outstanding_balance = v_new_arrears,
      loan_book_arrears = v_new_arrears,
      loan_book_last_payment_date = COALESCE(v_last_payment_date, loan_book_last_payment_date),
      updated_at = now()
    WHERE id = v_ticket_record.master_id;

    IF v_movement_type IN ('cleared', 'reduced') THEN
      v_payment_amount := v_old_arrears - v_new_arrears;

      INSERT INTO payments (
        ticket_id, master_customer_id, customer_name, amount,
        payment_method, payment_date, notes, recorded_by, source
      ) VALUES (
        v_ticket_record.id, v_ticket_record.master_id, v_ticket_record.customer_name_full,
        v_payment_amount, 'Bank', COALESCE(v_last_payment_date, now()),
        'Batch loan book sync - ' || v_movement_type || ' from K' || v_old_arrears || ' to K' || v_new_arrears,
        v_admin_id, 'loanbook_daily'
      );
    END IF;

    IF v_ticket_record.assigned_agent IS NOT NULL THEN
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
    'errors', v_errors
  );
END;
$function$;

-- ============================================================
-- 6. Reports: agents see only their own figures
-- ============================================================

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
      pr.id as agent_id,
      COALESCE(pr.display_name, pr.full_name) as agent_name,
      COALESCE(SUM(p.amount), 0) as collected,
      COUNT(DISTINCT t.id) as ticket_count
    FROM profiles pr
    LEFT JOIN tickets t ON t.assigned_agent = pr.id
      AND (p_batch_id IS NULL OR t.batch_id = p_batch_id)
    LEFT JOIN payments p ON p.ticket_id = t.id
      AND (p.source IS NULL OR p.source = 'system_manual')
    WHERE v_is_admin OR pr.id = auth.uid()
    GROUP BY pr.id, pr.display_name, pr.full_name
    HAVING COUNT(t.id) > 0
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
        WHERE t.assigned_agent = pr.id
        AND t.status = 'In Progress') AS in_progress_tickets,
      (SELECT COUNT(*) FROM tickets t
        WHERE t.assigned_agent = pr.id
        AND t.status = 'Resolved') AS tickets_resolved,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
        WHERE p.recorded_by = pr.id
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

-- This overload has no admin check and can never run successfully: it reads the deleted
-- arrears_snapshots table and compares uuid to text. The admin-checked overload remains.
DROP FUNCTION IF EXISTS public.get_arrears_movement_analytics(text, text, text);

-- ============================================================
-- 7. Permissions on the new functions (new functions default to PUBLIC execute)
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.guard_agent_column_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_payment_change() FROM PUBLIC, anon, authenticated;

COMMIT;
