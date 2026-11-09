-- Server-side batch import (2026-11-09)
--
-- Replaces the browser's row-by-row "Create New Batch" import with one admin-only function.
-- The whole file is checked first; nothing is saved if any row has an error.
-- p_commit = false runs everything and then rolls it back, returning what would happen (preview).
--
-- Rules agreed with the platform owner:
--   * Customers are matched by NRC (unique); their details update from the newest file.
--   * A loan returning with the same Loan ID continues its ticket: it moves into the new batch with its
--     call notes, payments and history. New Loan IDs get new tickets.
--   * The file is a loan book position: recorded payments for each customer in it are overridden,
--     and a closed ticket with arrears reopens. No loan book payments are created at import.
--   * tickets.original_amount holds the amount at import, the month's starting figure.
--   * Last Payment Date is month/day/year (Excel date serials and YYYY-MM-DD are also accepted).
--   * The Assigned Agent matches a staff member's display name or full name.

BEGIN;

-- Trims, collapses repeated spaces, and treats spreadsheet placeholders as empty.
CREATE OR REPLACE FUNCTION public.import_clean(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(regexp_replace(trim(COALESCE(p_value, '')), '\s+', ' ', 'g'))
         IN ('', '#N/A', 'N/A', 'NA', 'NULL', '-', '--', '#REF!', '#VALUE!', '#NAME?', '#DIV/0!')
      THEN NULL
    ELSE regexp_replace(trim(p_value), '\s+', ' ', 'g')
  END
$$;

CREATE OR REPLACE FUNCTION public.import_batch(
  p_batch_name text,
  p_institution_name text,
  p_rows jsonb,
  p_commit boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid := auth.uid();
  v_row jsonb;
  v_idx integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_clean_rows jsonb := '[]'::jsonb;
  v_seen_loans text[] := '{}';

  v_loan text;
  v_nrc text;
  v_name text;
  v_amount_raw text;
  v_amount numeric;
  v_agent text;
  v_agent_ids uuid[];
  v_mobile text;
  v_date_raw text;
  v_date date;
  v_days integer;

  v_batch_id uuid;
  v_customer_id uuid;
  v_ticket RECORD;
  v_ticket_id uuid;
  v_was_closed boolean;
  v_touched uuid[] := '{}';
  v_rows_affected integer;

  v_new_customers integer := 0;
  v_returning_customers integer := 0;
  v_new_tickets integer := 0;
  v_continued_tickets integer := 0;
  v_reopened integer := 0;
  v_zero_balance integer := 0;
  v_notes_reattached integer := 0;
  v_overridden integer := 0;
  v_total_amount numeric := 0;
BEGIN
  IF NOT has_role(v_admin, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can import batches' USING ERRCODE = '42501';
  END IF;

  IF import_clean(p_batch_name) IS NULL OR import_clean(p_institution_name) IS NULL THEN
    RAISE EXCEPTION 'Batch name and institution name are required';
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'The file has no rows';
  END IF;

  -- ============================================================
  -- Pass 1: check and clean every row. Any error stops the import.
  -- ============================================================
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_idx := v_idx + 1;

    v_loan := import_clean(v_row->>'loan_id');
    v_nrc := import_clean(v_row->>'nrc_number');
    v_name := import_clean(v_row->>'customer_name');
    v_agent := import_clean(v_row->>'assigned_agent');
    v_mobile := regexp_replace(COALESCE(import_clean(v_row->>'mobile_number'), ''), '\s', '', 'g');
    v_mobile := NULLIF(v_mobile, '');

    IF v_nrc IS NULL THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'loan_id', v_loan, 'message', 'NRC Number is required');
    END IF;
    IF v_name IS NULL THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'loan_id', v_loan, 'message', 'Customer Name is required');
    END IF;

    IF v_loan IS NULL THEN
      v_loan := 'LN' || to_char(now(), 'YYYYMMDD') || upper(substr(md5(random()::text || v_idx::text), 1, 8));
      v_warnings := v_warnings || jsonb_build_object('row', v_idx, 'loan_id', v_loan, 'message', 'No Loan ID; one was generated');
    ELSIF v_loan = ANY(v_seen_loans) THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'loan_id', v_loan, 'message', 'Loan ID appears more than once in the file');
    END IF;
    v_seen_loans := v_seen_loans || v_loan;

    v_amount_raw := regexp_replace(COALESCE(import_clean(v_row->>'amount_owed'), ''), '[^0-9.\-]', '', 'g');
    v_amount := NULL;
    IF v_amount_raw = '' THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'loan_id', v_loan, 'message', 'Amount Owed is required');
    ELSE
      BEGIN
        v_amount := v_amount_raw::numeric;
        IF v_amount < 0 THEN
          v_errors := v_errors || jsonb_build_object('row', v_idx, 'loan_id', v_loan, 'message', 'Amount Owed cannot be negative');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'loan_id', v_loan, 'message', 'Amount Owed is not a number');
      END;
    END IF;

    v_agent_ids := NULL;
    IF v_agent IS NULL THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'loan_id', v_loan, 'message', 'Assigned Agent is required');
    ELSE
      SELECT array_agg(DISTINCT p.id) INTO v_agent_ids
      FROM profiles p
      JOIN user_roles r ON r.user_id = p.id
      WHERE lower(import_clean(p.display_name)) = lower(v_agent)
         OR lower(import_clean(p.full_name)) = lower(v_agent);

      IF v_agent_ids IS NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'loan_id', v_loan, 'message', format('Agent "%s" not found', v_agent));
      ELSIF array_length(v_agent_ids, 1) > 1 THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'loan_id', v_loan, 'message', format('Agent "%s" matches more than one staff member', v_agent));
      END IF;
    END IF;

    v_date_raw := import_clean(v_row->>'last_payment_date');
    v_date := NULL;
    IF v_date_raw IS NOT NULL THEN
      BEGIN
        IF v_date_raw ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
          v_date := to_date(v_date_raw, 'MM/DD/YYYY');
          IF to_char(v_date, 'FMMM/FMDD/YYYY') <> regexp_replace(v_date_raw, '(^|/)0', '\1', 'g') THEN
            RAISE EXCEPTION 'invalid date';
          END IF;
        ELSIF v_date_raw ~ '^\d{4}-\d{2}-\d{2}' THEN
          v_date := left(v_date_raw, 10)::date;
        ELSIF v_date_raw ~ '^\d{5}(\.\d+)?$' THEN
          v_date := date '1899-12-30' + floor(v_date_raw::numeric)::integer;
        ELSE
          RAISE EXCEPTION 'invalid date';
        END IF;
        IF v_date < date '1900-01-01' OR v_date > date '2100-12-31' THEN
          RAISE EXCEPTION 'invalid date';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_date := NULL;
        v_warnings := v_warnings || jsonb_build_object('row', v_idx, 'loan_id', v_loan,
          'message', format('Last Payment Date "%s" could not be read and was left blank', v_date_raw));
      END;
    END IF;

    BEGIN
      v_days := NULLIF(regexp_replace(COALESCE(import_clean(v_row->>'days_in_arrears'), ''), '[^0-9]', '', 'g'), '')::integer;
    EXCEPTION WHEN OTHERS THEN
      v_days := NULL;
    END;

    IF v_mobile IS NOT NULL AND v_mobile !~ '^260[79][0-9]{8}$' THEN
      v_warnings := v_warnings || jsonb_build_object('row', v_idx, 'loan_id', v_loan,
        'message', format('Mobile Number "%s" does not look like a Zambian mobile number', v_mobile));
    END IF;

    v_clean_rows := v_clean_rows || jsonb_build_object(
      'loan_id', v_loan,
      'nrc_number', v_nrc,
      'customer_name', v_name,
      'amount_owed', v_amount,
      'agent_id', v_agent_ids[1],
      'mobile_number', v_mobile,
      'last_payment_date', v_date,
      'days_in_arrears', v_days,
      'branch_name', import_clean(v_row->>'branch_name'),
      'employer_name', import_clean(v_row->>'employer_name'),
      'employer_subdivision', import_clean(v_row->>'employer_subdivision'),
      'loan_consultant', import_clean(v_row->>'loan_consultant'),
      'tenure', import_clean(v_row->>'tenure'),
      'next_of_kin_name', import_clean(v_row->>'next_of_kin_name'),
      'next_of_kin_contact', import_clean(v_row->>'next_of_kin_contact'),
      'workplace_contact', import_clean(v_row->>'workplace_contact'),
      'workplace_destination', import_clean(v_row->>'workplace_destination')
    );
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'committed', false,
      'rows', v_idx,
      'errors', v_errors,
      'warnings', v_warnings
    );
  END IF;

  -- ============================================================
  -- Pass 2: import. A preview runs this and then undoes it.
  -- ============================================================
  BEGIN
    INSERT INTO batches (name, institution_name, uploaded_by, customer_count, total_amount)
    VALUES (import_clean(p_batch_name), import_clean(p_institution_name), v_admin, 0, 0)
    RETURNING id INTO v_batch_id;

    FOR v_row IN SELECT * FROM jsonb_array_elements(v_clean_rows) LOOP
      SELECT id INTO v_customer_id FROM master_customers WHERE nrc_number = v_row->>'nrc_number';

      IF v_customer_id IS NULL THEN
        INSERT INTO master_customers (
          nrc_number, name, mobile_number, total_owed, outstanding_balance, loan_book_arrears,
          assigned_agent, branch_name, employer_name, employer_subdivision, loan_consultant, tenure,
          last_payment_date, loan_book_last_payment_date, next_of_kin_name, next_of_kin_contact,
          workplace_contact, workplace_destination
        ) VALUES (
          v_row->>'nrc_number', v_row->>'customer_name', v_row->>'mobile_number',
          (v_row->>'amount_owed')::numeric, (v_row->>'amount_owed')::numeric, (v_row->>'amount_owed')::numeric,
          (v_row->>'agent_id')::uuid, v_row->>'branch_name', v_row->>'employer_name',
          v_row->>'employer_subdivision', v_row->>'loan_consultant', v_row->>'tenure',
          (v_row->>'last_payment_date')::date, (v_row->>'last_payment_date')::date,
          v_row->>'next_of_kin_name', v_row->>'next_of_kin_contact',
          v_row->>'workplace_contact', v_row->>'workplace_destination'
        )
        RETURNING id INTO v_customer_id;
        v_new_customers := v_new_customers + 1;
      ELSE
        IF NOT (v_customer_id = ANY(v_touched)) THEN
          v_returning_customers := v_returning_customers + 1;
        END IF;

        UPDATE master_customers SET
          name = v_row->>'customer_name',
          mobile_number = COALESCE(v_row->>'mobile_number', mobile_number),
          assigned_agent = (v_row->>'agent_id')::uuid,
          branch_name = COALESCE(v_row->>'branch_name', branch_name),
          employer_name = COALESCE(v_row->>'employer_name', employer_name),
          employer_subdivision = COALESCE(v_row->>'employer_subdivision', employer_subdivision),
          loan_consultant = COALESCE(v_row->>'loan_consultant', loan_consultant),
          tenure = COALESCE(v_row->>'tenure', tenure),
          next_of_kin_name = COALESCE(v_row->>'next_of_kin_name', next_of_kin_name),
          next_of_kin_contact = COALESCE(v_row->>'next_of_kin_contact', next_of_kin_contact),
          workplace_contact = COALESCE(v_row->>'workplace_contact', workplace_contact),
          workplace_destination = COALESCE(v_row->>'workplace_destination', workplace_destination),
          last_payment_date = GREATEST(last_payment_date, (v_row->>'last_payment_date')::date),
          loan_book_last_payment_date = GREATEST(loan_book_last_payment_date, (v_row->>'last_payment_date')::date),
          updated_at = now()
        WHERE id = v_customer_id;

        -- The file is the loan book position, so it replaces payments recorded since the last figure.
        UPDATE payments SET verification_status = 'overridden'
        WHERE master_customer_id = v_customer_id AND verification_status = 'reported';
        GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
        v_overridden := v_overridden + v_rows_affected;
      END IF;

      SELECT id, status INTO v_ticket FROM tickets WHERE loan_id = v_row->>'loan_id';

      IF v_ticket.id IS NOT NULL THEN
        v_was_closed := v_ticket.status IN ('Resolved', 'Pending Confirmation');

        UPDATE tickets SET
          batch_id = v_batch_id,
          master_customer_id = v_customer_id,
          assigned_agent = (v_row->>'agent_id')::uuid,
          customer_name = v_row->>'customer_name',
          nrc_number = v_row->>'nrc_number',
          mobile_number = COALESCE(v_row->>'mobile_number', mobile_number),
          amount_owed = (v_row->>'amount_owed')::numeric,
          original_amount = (v_row->>'amount_owed')::numeric,
          days_in_arrears = COALESCE((v_row->>'days_in_arrears')::integer, days_in_arrears),
          status = CASE
            WHEN (v_row->>'amount_owed')::numeric = 0 THEN 'Resolved'
            WHEN v_was_closed THEN 'In Progress'
            ELSE status
          END,
          resolved_date = CASE
            WHEN (v_row->>'amount_owed')::numeric = 0 THEN COALESCE(resolved_date, now())
            ELSE NULL
          END,
          updated_at = now()
        WHERE id = v_ticket.id;

        v_ticket_id := v_ticket.id;
        v_continued_tickets := v_continued_tickets + 1;
        IF v_was_closed AND (v_row->>'amount_owed')::numeric > 0 THEN
          v_reopened := v_reopened + 1;
        END IF;
      ELSE
        INSERT INTO tickets (
          master_customer_id, batch_id, customer_name, nrc_number, mobile_number,
          amount_owed, original_amount, assigned_agent, priority, status, resolved_date,
          loan_id, days_in_arrears
        ) VALUES (
          v_customer_id, v_batch_id, v_row->>'customer_name', v_row->>'nrc_number', v_row->>'mobile_number',
          (v_row->>'amount_owed')::numeric, (v_row->>'amount_owed')::numeric, (v_row->>'agent_id')::uuid,
          CASE WHEN (v_row->>'amount_owed')::numeric = 0 THEN 'Low' ELSE 'High' END,
          CASE WHEN (v_row->>'amount_owed')::numeric = 0 THEN 'Resolved' ELSE 'Open' END,
          CASE WHEN (v_row->>'amount_owed')::numeric = 0 THEN now() ELSE NULL END,
          v_row->>'loan_id', (v_row->>'days_in_arrears')::integer
        )
        RETURNING id INTO v_ticket_id;
        v_new_tickets := v_new_tickets + 1;
      END IF;

      IF (v_row->>'amount_owed')::numeric = 0 THEN
        v_zero_balance := v_zero_balance + 1;
      END IF;

      INSERT INTO batch_customers (
        batch_id, master_customer_id, nrc_number, name, mobile_number, amount_owed, assigned_agent_id,
        branch_name, employer_name, employer_subdivision, loan_consultant, tenure, last_payment_date, loan_id
      ) VALUES (
        v_batch_id, v_customer_id, v_row->>'nrc_number', v_row->>'customer_name', v_row->>'mobile_number',
        (v_row->>'amount_owed')::numeric, (v_row->>'agent_id')::uuid,
        v_row->>'branch_name', v_row->>'employer_name', v_row->>'employer_subdivision',
        v_row->>'loan_consultant', v_row->>'tenure', (v_row->>'last_payment_date')::date, v_row->>'loan_id'
      );

      -- Call notes left from earlier batches join this ticket.
      UPDATE call_logs SET ticket_id = v_ticket_id, is_from_previous_batch = true
      WHERE master_customer_id = v_customer_id AND ticket_id IS NULL;
      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      v_notes_reattached := v_notes_reattached + v_rows_affected;

      v_total_amount := v_total_amount + (v_row->>'amount_owed')::numeric;
      IF NOT (v_customer_id = ANY(v_touched)) THEN
        v_touched := v_touched || v_customer_id;
      END IF;
    END LOOP;

    -- A customer's balance is the total of their loans in this file.
    UPDATE master_customers mc SET
      total_owed = s.total,
      loan_book_arrears = s.total,
      outstanding_balance = s.total,
      updated_at = now()
    FROM (
      SELECT master_customer_id, SUM(amount_owed) AS total
      FROM batch_customers
      WHERE batch_id = v_batch_id
      GROUP BY master_customer_id
    ) s
    WHERE mc.id = s.master_customer_id;

    FOR v_customer_id IN SELECT unnest(v_touched) LOOP
      PERFORM refresh_customer_payment_totals(v_customer_id);
    END LOOP;

    UPDATE batches SET customer_count = v_idx, total_amount = v_total_amount WHERE id = v_batch_id;

    IF NOT p_commit THEN
      RAISE EXCEPTION 'preview' USING ERRCODE = 'P0099';
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    v_batch_id := NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'committed', p_commit,
    'batch_id', v_batch_id,
    'rows', v_idx,
    'total_amount', v_total_amount,
    'new_customers', v_new_customers,
    'returning_customers', v_returning_customers,
    'new_tickets', v_new_tickets,
    'continued_tickets', v_continued_tickets,
    'reopened_tickets', v_reopened,
    'zero_balance', v_zero_balance,
    'notes_reattached', v_notes_reattached,
    'overridden_payments', v_overridden,
    'errors', v_errors,
    'warnings', v_warnings
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.import_clean(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_clean(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.import_batch(text, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_batch(text, text, jsonb, boolean) TO authenticated, service_role;

COMMIT;
