-- Merge duplicate customer records, part 1 (2026-11-06)
--
-- Merges NRCs where every record carries the same name. NRCs whose records carry different names are
-- left untouched for manual review. The unique NRC rule is added once those are resolved.
--
-- Kept record: the one with a ticket, otherwise the newest. Call notes, payments, batch rows, sync and
-- audit history move onto it, and blank details are filled from the copies. Each removed copy is saved in
-- merged_customer_archive with the IDs of what moved.
--
-- Runs as one transaction: if any statement fails, nothing changes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.merged_customer_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nrc_number text NOT NULL,
  removed_customer_id uuid NOT NULL,
  kept_customer_id uuid NOT NULL,
  removed_customer jsonb NOT NULL,
  moved_payment_ids uuid[] NOT NULL DEFAULT '{}',
  moved_call_log_ids uuid[] NOT NULL DEFAULT '{}',
  moved_batch_customer_ids uuid[] NOT NULL DEFAULT '{}',
  moved_notification_ids uuid[] NOT NULL DEFAULT '{}',
  moved_sync_log_ids uuid[] NOT NULL DEFAULT '{}',
  moved_amount_audit_ids uuid[] NOT NULL DEFAULT '{}',
  removed_batch_rows jsonb,
  merged_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merged_customer_archive_kept ON public.merged_customer_archive(kept_customer_id);

ALTER TABLE public.merged_customer_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merged_customer_archive FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.merged_customer_archive FROM authenticated;

DROP POLICY IF EXISTS "Admins view merged customer archive" ON public.merged_customer_archive;
CREATE POLICY "Admins view merged customer archive" ON public.merged_customer_archive FOR SELECT TO authenticated
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)));

DO $$
DECLARE
  g RECORD;
  d RECORD;
  v_kept uuid;
  v_ticket uuid;
  v_payment_ids uuid[];
  v_call_log_ids uuid[];
  v_batch_row_ids uuid[];
  v_notification_ids uuid[];
  v_sync_log_ids uuid[];
  v_audit_ids uuid[];
  v_removed_rows jsonb;
  v_removed_batches uuid[];
  v_affected_batches uuid[] := '{}';
  v_remaining integer;
BEGIN
  FOR g IN
    SELECT nrc_number
    FROM public.master_customers
    GROUP BY nrc_number
    HAVING COUNT(*) > 1 AND COUNT(DISTINCT lower(trim(name))) = 1
  LOOP
    SELECT mc.id INTO v_kept
    FROM public.master_customers mc
    WHERE mc.nrc_number = g.nrc_number
    ORDER BY EXISTS (SELECT 1 FROM public.tickets t WHERE t.master_customer_id = mc.id) DESC,
             mc.created_at DESC, mc.id
    LIMIT 1;

    SELECT t.id INTO v_ticket
    FROM public.tickets t
    WHERE t.master_customer_id = v_kept
    ORDER BY t.created_at DESC
    LIMIT 1;

    FOR d IN
      SELECT * FROM public.master_customers
      WHERE nrc_number = g.nrc_number AND id <> v_kept
      ORDER BY created_at DESC, id
    LOOP
      IF EXISTS (SELECT 1 FROM public.tickets t WHERE t.master_customer_id = d.id) THEN
        RAISE EXCEPTION 'Duplicate customer % has a ticket; aborting merge', d.id;
      END IF;

      WITH moved AS (
        UPDATE public.payments SET master_customer_id = v_kept
        WHERE master_customer_id = d.id RETURNING id
      ) SELECT COALESCE(array_agg(id), '{}') INTO v_payment_ids FROM moved;

      -- Unattached notes join the kept record's ticket, as the import does for returning customers.
      WITH moved AS (
        UPDATE public.call_logs SET
          master_customer_id = v_kept,
          is_from_previous_batch = CASE
            WHEN ticket_id IS NULL AND v_ticket IS NOT NULL THEN true
            ELSE is_from_previous_batch
          END,
          ticket_id = COALESCE(ticket_id, v_ticket)
        WHERE master_customer_id = d.id RETURNING id
      ) SELECT COALESCE(array_agg(id), '{}') INTO v_call_log_ids FROM moved;

      WITH moved AS (
        UPDATE public.batch_customers SET master_customer_id = v_kept
        WHERE master_customer_id = d.id RETURNING id
      ) SELECT COALESCE(array_agg(id), '{}') INTO v_batch_row_ids FROM moved;

      WITH moved AS (
        UPDATE public.agent_notifications SET related_customer_id = v_kept
        WHERE related_customer_id = d.id RETURNING id
      ) SELECT COALESCE(array_agg(id), '{}') INTO v_notification_ids FROM moved;

      WITH moved AS (
        UPDATE public.arrears_sync_logs SET master_customer_id = v_kept
        WHERE master_customer_id = d.id RETURNING id
      ) SELECT COALESCE(array_agg(id), '{}') INTO v_sync_log_ids FROM moved;

      WITH moved AS (
        UPDATE public.amount_owed_audit_logs SET master_customer_id = v_kept
        WHERE master_customer_id = d.id RETURNING id
      ) SELECT COALESCE(array_agg(id), '{}') INTO v_audit_ids FROM moved;

      -- The kept record now appears once per batch; the newest batch row stays.
      WITH ranked AS (
        SELECT id, row_number() OVER (PARTITION BY batch_id ORDER BY created_at DESC, id) AS rn
        FROM public.batch_customers
        WHERE master_customer_id = v_kept
      ), removed AS (
        DELETE FROM public.batch_customers bc
        USING ranked r
        WHERE bc.id = r.id AND r.rn > 1
        RETURNING bc.*
      )
      SELECT jsonb_agg(to_jsonb(removed)), array_agg(removed.batch_id)
      INTO v_removed_rows, v_removed_batches
      FROM removed;

      IF v_removed_batches IS NOT NULL THEN
        v_affected_batches := v_affected_batches || v_removed_batches;
      END IF;

      -- Fill blanks on the kept record; copies are visited newest first.
      UPDATE public.master_customers SET
        mobile_number = COALESCE(NULLIF(mobile_number, ''), d.mobile_number),
        loan_account_number = COALESCE(NULLIF(loan_account_number, ''), d.loan_account_number),
        branch_name = COALESCE(NULLIF(branch_name, ''), d.branch_name),
        arrear_status = COALESCE(NULLIF(arrear_status, ''), d.arrear_status),
        employer_name = COALESCE(NULLIF(employer_name, ''), d.employer_name),
        employer_subdivision = COALESCE(NULLIF(employer_subdivision, ''), d.employer_subdivision),
        loan_consultant = COALESCE(NULLIF(loan_consultant, ''), d.loan_consultant),
        tenure = COALESCE(NULLIF(tenure, ''), d.tenure),
        reason_for_arrears = COALESCE(NULLIF(reason_for_arrears, ''), d.reason_for_arrears),
        next_of_kin_name = COALESCE(NULLIF(next_of_kin_name, ''), d.next_of_kin_name),
        next_of_kin_contact = COALESCE(NULLIF(next_of_kin_contact, ''), d.next_of_kin_contact),
        workplace_contact = COALESCE(NULLIF(workplace_contact, ''), d.workplace_contact),
        workplace_destination = COALESCE(NULLIF(workplace_destination, ''), d.workplace_destination),
        assigned_agent = COALESCE(assigned_agent, d.assigned_agent),
        last_payment_date = GREATEST(last_payment_date, d.last_payment_date),
        loan_book_last_payment_date = GREATEST(loan_book_last_payment_date, d.loan_book_last_payment_date),
        call_notes = CASE
          WHEN COALESCE(d.call_notes, '') = '' OR d.call_notes = call_notes THEN call_notes
          WHEN COALESCE(call_notes, '') = '' THEN d.call_notes
          ELSE call_notes || E'\n' || d.call_notes
        END
      WHERE id = v_kept;

      INSERT INTO public.merged_customer_archive (
        nrc_number, removed_customer_id, kept_customer_id, removed_customer,
        moved_payment_ids, moved_call_log_ids, moved_batch_customer_ids,
        moved_notification_ids, moved_sync_log_ids, moved_amount_audit_ids, removed_batch_rows
      ) VALUES (
        g.nrc_number, d.id, v_kept, to_jsonb(d),
        v_payment_ids, v_call_log_ids, v_batch_row_ids,
        v_notification_ids, v_sync_log_ids, v_audit_ids, v_removed_rows
      );

      DELETE FROM public.master_customers WHERE id = d.id;
    END LOOP;

    -- Balance and totals now reflect everything moved onto the kept record.
    PERFORM public.refresh_provisional_balance(NULL::uuid, v_kept);
  END LOOP;

  -- Batch counts change only where a duplicate batch row was removed.
  UPDATE public.batches b SET
    customer_count = (SELECT COUNT(*) FROM public.batch_customers bc WHERE bc.batch_id = b.id),
    total_amount = (SELECT COALESCE(SUM(bc.amount_owed), 0) FROM public.batch_customers bc WHERE bc.batch_id = b.id)
  WHERE b.id = ANY(v_affected_batches);

  SELECT COUNT(*) INTO v_remaining
  FROM (
    SELECT nrc_number FROM public.master_customers
    GROUP BY nrc_number
    HAVING COUNT(*) > 1 AND COUNT(DISTINCT lower(trim(name))) = 1
  ) x;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Merge left % same-name duplicate NRCs; aborting', v_remaining;
  END IF;
END $$;

COMMIT;
