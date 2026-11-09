-- Merge duplicate customer records, part 2 (2026-11-06)
-- Run AFTER 20261106100000_merge_duplicate_customers.sql.
--
-- The remaining duplicate NRCs were reviewed: their names differ only by extra spaces. Same rules as part 1,
-- then a unique rule stops new duplicates. Aborts if any NRC has names differing by more than spacing.
--
-- Runs as one transaction: if any statement fails, nothing changes.

BEGIN;

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
  v_conflicts integer;
BEGIN
  SELECT COUNT(*) INTO v_conflicts
  FROM (
    SELECT nrc_number FROM public.master_customers
    GROUP BY nrc_number
    HAVING COUNT(DISTINCT regexp_replace(lower(trim(name)), '\s+', ' ', 'g')) > 1
  ) x;

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION '% NRCs have names differing by more than spacing; aborting merge', v_conflicts;
  END IF;

  FOR g IN
    SELECT nrc_number FROM public.master_customers
    GROUP BY nrc_number
    HAVING COUNT(*) > 1
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

    PERFORM public.refresh_provisional_balance(NULL::uuid, v_kept);
  END LOOP;

  UPDATE public.batches b SET
    customer_count = (SELECT COUNT(*) FROM public.batch_customers bc WHERE bc.batch_id = b.id),
    total_amount = (SELECT COALESCE(SUM(bc.amount_owed), 0) FROM public.batch_customers bc WHERE bc.batch_id = b.id)
  WHERE b.id = ANY(v_affected_batches);
END $$;

-- From here on, the database rejects a second record for the same NRC.
CREATE UNIQUE INDEX master_customers_nrc_number_unique ON public.master_customers(nrc_number);

COMMIT;
