-- Second fix for the loan book month-to-date update (2026-11-09)
--
-- The live database has check constraints that are not in this repo's migrations. payments.source
-- rejected 'loanbook_mtd', so uploads failed during the preview with nothing saved.
-- The month-to-date payment now uses 'loanbook_daily' (shown as "Loan Book Sync" on tickets), and the
-- change log uses the source and movement values the earlier sync already wrote ('no_arrears' is
-- logged as 'maintained'). The function finds its payment by id, never by source.
--
-- Before changing anything, this checks every value the function writes against the live check
-- constraints. If one would be rejected, it stops and names the constraint; nothing changes.

BEGIN;

DO $$
DECLARE
  v_check record;
  v_con record;
  v_value text;
BEGIN
  FOR v_check IN
    SELECT * FROM (VALUES
      ('payments', 'source', ARRAY['loanbook_daily']),
      ('payments', 'payment_method', ARRAY['Bank']),
      ('payments', 'verification_status', ARRAY['verified', 'overridden']),
      ('arrears_sync_logs', 'source', ARRAY['loanbook_daily']),
      ('arrears_sync_logs', 'movement_type', ARRAY['maintained', 'reduced', 'cleared', 'increased']),
      ('agent_notifications', 'type', ARRAY['ticket_reopened', 'loan_book_update']),
      ('tickets', 'status', ARRAY['Resolved', 'In Progress'])
    ) AS c(tbl, col, vals)
  LOOP
    FOR v_con IN
      SELECT con.conname, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      WHERE con.conrelid = ('public.' || v_check.tbl)::regclass
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) ~ ('\m' || v_check.col || '\M')
    LOOP
      FOREACH v_value IN ARRAY v_check.vals LOOP
        IF position(quote_literal(v_value) IN v_con.def) = 0 THEN
          RAISE EXCEPTION 'Constraint % on %.% would reject %: %. Nothing was changed.',
            v_con.conname, v_check.tbl, v_check.col, quote_literal(v_value), v_con.def;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.sync_loan_book_mtd(
  p_batch_ids uuid[],
  p_rows jsonb,
  p_file_name text DEFAULT NULL,
  p_commit boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_tolerance CONSTANT numeric := 1;
  c_max_missing_share CONSTANT numeric := 0.25;

  v_admin uuid := auth.uid();
  v_sync_id uuid := gen_random_uuid();
  v_errors jsonb;
  v_warnings jsonb;
  v_ticket_count integer;
  v_missing integer;
  v_overridden integer := 0;
  v_reopened integer := 0;
  v_notified integer := 0;
  v_tickets_changed integer := 0;
  v_collected_before numeric := 0;
  v_summary jsonb;
  v_customer uuid;
BEGIN
  IF NOT has_role(v_admin, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can run the loan book update' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(cardinality(p_batch_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Choose the month''s batches';
  END IF;

  IF (SELECT count(*) FROM batches WHERE id = ANY(p_batch_ids))
     <> (SELECT count(DISTINCT b) FROM unnest(p_batch_ids) b) THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'The file has no rows';
  END IF;

  -- One update at a time.
  PERFORM pg_advisory_xact_lock(hashtext('sync_loan_book_mtd'));

  -- ============================================================
  -- Read and check the file rows. Any error stops the update.
  -- ============================================================
  DROP TABLE IF EXISTS _lb_file;
  CREATE TEMP TABLE _lb_file ON COMMIT DROP AS
  SELECT
    COALESCE(NULLIF(r->>'row', '')::integer, e.ord::integer) AS row_no,
    NULLIF(upper(btrim(COALESCE(r->>'loan_id', ''))), '') AS loan_id,
    loan_book_norm_nrc(r->>'nrc_number') AS nrc,
    NULLIF(upper(btrim(COALESCE(r->>'foreclosure_loan_id', ''))), '') AS foreclosure_id,
    btrim(COALESCE(r->>'arrears_amount', '')) AS arrears_raw,
    btrim(COALESCE(r->>'days_in_arrears', '')) AS days_raw,
    btrim(COALESCE(r->>'last_payment_date', '')) AS date_raw,
    NULL::numeric AS arrears,
    NULL::integer AS days,
    NULL::date AS last_payment
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(r, ord);

  UPDATE _lb_file SET
    arrears = CASE WHEN replace(arrears_raw, ',', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
                   THEN replace(arrears_raw, ',', '')::numeric END,
    days = CASE WHEN days_raw ~ '^[0-9]{1,6}$' THEN days_raw::integer END,
    last_payment = loan_book_try_date(date_raw)
  WHERE true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('row', row_no, 'loan_id', loan_id, 'message', msg) ORDER BY row_no), '[]'::jsonb)
  INTO v_errors
  FROM (
    SELECT row_no, loan_id, msg FROM (
      SELECT row_no, loan_id, 'LoanRefId is blank' AS msg FROM _lb_file WHERE loan_id IS NULL
      UNION ALL
      SELECT row_no, loan_id, format('ArrearAmount "%s" is not a number', arrears_raw) FROM _lb_file WHERE arrears IS NULL
      UNION ALL
      SELECT min(row_no), loan_id, 'LoanRefId appears more than once in the file'
      FROM _lb_file WHERE loan_id IS NOT NULL GROUP BY loan_id HAVING count(*) > 1
    ) e
    ORDER BY row_no
    LIMIT 200
  ) e;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('success', false, 'committed', false, 'errors', v_errors, 'warnings', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('row', row_no, 'loan_id', loan_id, 'message', msg) ORDER BY row_no), '[]'::jsonb)
  INTO v_warnings
  FROM (
    SELECT row_no, loan_id, msg FROM (
      SELECT row_no, loan_id, format('LastPaymentDate "%s" could not be read and was ignored', date_raw) AS msg
      FROM _lb_file WHERE date_raw <> '' AND last_payment IS NULL
      UNION ALL
      SELECT row_no, loan_id, format('ArrearAmount %s is negative and was treated as 0', arrears)
      FROM _lb_file WHERE arrears < 0
    ) w
    ORDER BY row_no
    LIMIT 200
  ) w;

  UPDATE _lb_file SET arrears = 0 WHERE arrears < 0;

  CREATE INDEX ON _lb_file (loan_id);
  CREATE INDEX ON _lb_file (foreclosure_id);
  CREATE INDEX ON _lb_file (nrc);

  -- ============================================================
  -- The month's loans with their opening positions
  -- ============================================================
  DROP TABLE IF EXISTS _lb_t;
  CREATE TEMP TABLE _lb_t ON COMMIT DROP AS
  SELECT
    t.id AS ticket_id,
    t.batch_id,
    t.loan_id AS ticket_loan_id,
    NULLIF(upper(btrim(COALESCE(t.loan_id, ''))), '') AS loan_id,
    loan_book_norm_nrc(t.nrc_number) AS nrc,
    t.nrc_number,
    t.customer_name,
    t.master_customer_id,
    t.assigned_agent,
    t.status,
    t.amount_owed,
    COALESCE(lp.opening_arrears, t.original_amount, t.amount_owed, 0) AS opening,
    lp.current_arrears AS prev_current,
    lp.collected_mtd AS prev_collected,
    lp.days_in_arrears AS prev_days,
    lp.last_payment_date AS prev_last_payment,
    lp.payment_id,
    NULL::text AS matched_loan_id,
    NULL::text AS method,
    NULL::numeric AS cur,
    NULL::integer AS days,
    NULL::date AS last_payment,
    NULL::text AS movement,
    NULL::numeric AS collected,
    NULL::text AS flag
  FROM tickets t
  LEFT JOIN loan_book_positions lp ON lp.batch_id = t.batch_id AND lp.ticket_id = t.id
  WHERE t.batch_id = ANY(p_batch_ids);

  SELECT count(*) INTO v_ticket_count FROM _lb_t;
  IF v_ticket_count = 0 THEN
    RAISE EXCEPTION 'These batches have no loans';
  END IF;

  CREATE INDEX ON _lb_t (matched_loan_id);

  -- 1. Same Loan ID.
  UPDATE _lb_t t SET matched_loan_id = f.loan_id, method = 'loan_id'
  FROM _lb_file f
  WHERE f.loan_id = t.loan_id;

  -- 2. Topped up: the new loan names a batch loan as the one it closed.
  UPDATE _lb_t t SET matched_loan_id = s.loan_id, method = 'top_up'
  FROM (
    SELECT DISTINCT ON (f.foreclosure_id) f.foreclosure_id, f.loan_id
    FROM _lb_file f
    WHERE f.foreclosure_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM _lb_t x WHERE x.matched_loan_id = f.loan_id)
    ORDER BY f.foreclosure_id, f.loan_id DESC
  ) s
  WHERE t.method IS NULL AND s.foreclosure_id = t.loan_id;

  -- 3. Same NRC, only when one unmatched loan and one unmatched ticket share it.
  UPDATE _lb_t t SET
    matched_loan_id = CASE WHEN c.n = 1 AND o.n = 1 THEN c.loan_id END,
    method = CASE WHEN c.n = 1 AND o.n = 1 THEN 'nrc' ELSE 'ambiguous' END
  FROM (
    SELECT f.nrc, min(f.loan_id) AS loan_id, count(*) AS n
    FROM _lb_file f
    WHERE f.nrc IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM _lb_t x WHERE x.matched_loan_id = f.loan_id)
    GROUP BY f.nrc
  ) c
  JOIN (
    SELECT nrc, count(*) AS n FROM _lb_t WHERE method IS NULL AND nrc IS NOT NULL GROUP BY nrc
  ) o ON o.nrc = c.nrc
  WHERE t.method IS NULL AND t.nrc = c.nrc;

  UPDATE _lb_t SET method = 'missing' WHERE method IS NULL;

  SELECT count(*) INTO v_missing FROM _lb_t WHERE method = 'missing';
  IF v_missing > v_ticket_count * c_max_missing_share THEN
    RETURN jsonb_build_object(
      'success', false,
      'committed', false,
      'errors', jsonb_build_array(jsonb_build_object(
        'row', NULL,
        'loan_id', NULL,
        'message', format('%s of the month''s %s loans are not in this file. Check that it is the full daily loan book; nothing was saved.',
          v_missing, v_ticket_count)
      )),
      'warnings', v_warnings
    );
  END IF;

  -- ============================================================
  -- Compare with the opening position
  -- ============================================================
  UPDATE _lb_t t SET cur = f.arrears, days = f.days, last_payment = f.last_payment
  FROM _lb_file f
  WHERE f.loan_id = t.matched_loan_id;

  UPDATE _lb_t SET cur = 0 WHERE method = 'missing';
  UPDATE _lb_t SET cur = COALESCE(prev_current, amount_owed, 0) WHERE method = 'ambiguous';

  UPDATE _lb_t SET movement = CASE
    WHEN method = 'ambiguous' THEN 'ambiguous'
    WHEN opening < c_tolerance AND cur < c_tolerance THEN 'no_arrears'
    WHEN cur < c_tolerance THEN 'cleared'
    WHEN opening - cur >= c_tolerance THEN 'reduced'
    WHEN cur - opening >= c_tolerance THEN 'increased'
    ELSE 'maintained'
  END
  WHERE true;

  UPDATE _lb_t SET
    collected = CASE
      WHEN movement = 'ambiguous' THEN COALESCE(prev_collected, 0)
      WHEN movement IN ('reduced', 'cleared') THEN round(opening - cur, 2)
      ELSE 0
    END,
    flag = CASE
      WHEN method = 'missing' AND opening >= c_tolerance THEN 'Not in the loan book file; treated as cleared'
      WHEN method = 'missing' THEN 'Not in the loan book file'
      WHEN method = 'ambiguous' THEN 'Several possible loans for this NRC; not updated'
      WHEN movement = 'increased' THEN 'Arrears higher than the opening position'
    END
  WHERE true;

  SELECT COALESCE(sum(prev_collected), 0) INTO v_collected_before FROM _lb_t;

  -- ============================================================
  -- Apply. A preview runs this and then undoes it.
  -- ============================================================
  BEGIN
    -- The loan book figure replaces payments agents reported for these customers.
    UPDATE payments p SET verification_status = 'overridden'
    WHERE p.verification_status = 'reported'
      AND p.master_customer_id IN (SELECT master_customer_id FROM _lb_t WHERE movement <> 'ambiguous');
    GET DIAGNOSTICS v_overridden = ROW_COUNT;

    SELECT count(*) INTO v_reopened
    FROM _lb_t
    WHERE movement <> 'ambiguous' AND cur >= c_tolerance AND status IN ('Resolved', 'Pending Confirmation');

    UPDATE tickets t SET
      amount_owed = round(l.cur, 2),
      days_in_arrears = COALESCE(l.days, t.days_in_arrears),
      status = CASE
        WHEN l.cur < c_tolerance THEN 'Resolved'
        WHEN t.status IN ('Resolved', 'Pending Confirmation') THEN 'In Progress'
        ELSE t.status
      END,
      resolved_date = CASE WHEN l.cur < c_tolerance THEN COALESCE(t.resolved_date, now()) ELSE NULL END,
      updated_at = now()
    FROM _lb_t l
    WHERE l.ticket_id = t.id
      AND l.movement <> 'ambiguous'
      AND (
        t.amount_owed IS DISTINCT FROM round(l.cur, 2)
        OR (l.days IS NOT NULL AND t.days_in_arrears IS DISTINCT FROM l.days)
        OR (l.cur < c_tolerance AND t.status <> 'Resolved')
        OR (l.cur >= c_tolerance AND t.status IN ('Resolved', 'Pending Confirmation'))
      );
    GET DIAGNOSTICS v_tickets_changed = ROW_COUNT;

    -- One month-to-date payment per loan, adjusted on every upload.
    DELETE FROM payments p
    USING _lb_t l
    WHERE p.id = l.payment_id AND l.movement <> 'ambiguous' AND l.collected <= 0;

    UPDATE _lb_t SET payment_id = NULL WHERE movement <> 'ambiguous' AND collected <= 0;

    UPDATE payments p SET
      amount = l.collected,
      payment_date = COALESCE(l.last_payment::timestamptz, p.payment_date),
      notes = format('Loan book month to date: opening K%s, now K%s', round(l.opening, 2), round(l.cur, 2))
    FROM _lb_t l
    WHERE p.id = l.payment_id
      AND l.movement <> 'ambiguous'
      AND l.collected > 0
      AND (p.amount IS DISTINCT FROM l.collected OR p.payment_date IS DISTINCT FROM COALESCE(l.last_payment::timestamptz, p.payment_date));

    -- A position whose payment no longer exists gets a new one.
    UPDATE _lb_t l SET payment_id = NULL
    WHERE l.payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = l.payment_id);

    WITH ins AS (
      INSERT INTO payments (
        ticket_id, master_customer_id, customer_name, amount,
        payment_method, payment_date, notes, recorded_by, source, verification_status
      )
      SELECT
        l.ticket_id, l.master_customer_id, l.customer_name, l.collected,
        'Bank', COALESCE(l.last_payment::timestamptz, now()),
        format('Loan book month to date: opening K%s, now K%s', round(l.opening, 2), round(l.cur, 2)),
        v_admin, 'loanbook_daily', 'verified'
      FROM _lb_t l
      WHERE l.movement <> 'ambiguous' AND l.collected > 0 AND l.payment_id IS NULL
      RETURNING id, ticket_id
    )
    UPDATE _lb_t l SET payment_id = ins.id
    FROM ins
    WHERE ins.ticket_id = l.ticket_id;

    -- Agents hear about changes since the last upload (or since the opening, the first time).
    INSERT INTO agent_notifications (agent_id, title, message, type, related_ticket_id, related_customer_id)
    SELECT
      l.assigned_agent,
      CASE
        WHEN l.cur >= c_tolerance AND l.status IN ('Resolved', 'Pending Confirmation') THEN 'Ticket Reopened'
        WHEN l.movement = 'cleared' THEN 'Arrears Cleared'
        WHEN l.movement = 'reduced' THEN 'Arrears Reduced'
        WHEN l.movement = 'increased' THEN 'Arrears Increased'
        ELSE 'Arrears Updated'
      END,
      CASE
        WHEN l.method = 'missing' THEN l.customer_name || ': loan no longer in the loan book; treated as cleared'
        ELSE l.customer_name || ': K' || round(COALESCE(l.prev_current, l.opening), 2)::text
             || ' → K' || round(l.cur, 2)::text
             || CASE WHEN l.collected > 0 THEN ' (K' || l.collected::text || ' collected this month)' ELSE '' END
      END,
      CASE
        WHEN l.cur >= c_tolerance AND l.status IN ('Resolved', 'Pending Confirmation') THEN 'ticket_reopened'
        ELSE 'loan_book_update'
      END,
      l.ticket_id,
      l.master_customer_id
    FROM _lb_t l
    WHERE l.assigned_agent IS NOT NULL
      AND l.movement NOT IN ('ambiguous', 'no_arrears')
      AND abs(round(l.cur, 2) - COALESCE(l.prev_current, l.opening)) >= c_tolerance;
    GET DIAGNOSTICS v_notified = ROW_COUNT;

    INSERT INTO arrears_sync_logs (
      sync_batch_id, admin_user_id, nrc_number, master_customer_id, loan_id,
      old_arrears, new_arrears, movement_type, loan_book_payment_date, ticket_resolved, source
    )
    SELECT
      v_sync_id, v_admin, l.nrc_number, l.master_customer_id, l.ticket_loan_id,
      round(COALESCE(l.prev_current, l.opening), 2), round(l.cur, 2),
      CASE WHEN l.movement = 'no_arrears' THEN 'maintained' ELSE l.movement END, l.last_payment,
      l.cur < c_tolerance, 'loanbook_daily'
    FROM _lb_t l
    WHERE l.movement <> 'ambiguous'
      AND (l.prev_current IS NULL OR abs(round(l.cur, 2) - l.prev_current) >= c_tolerance);

    INSERT INTO loan_book_positions (
      batch_id, ticket_id, matched_loan_id, match_method, opening_arrears, current_arrears,
      collected_mtd, movement, flag_reason, days_in_arrears, last_payment_date, payment_id,
      file_name, updated_by, updated_at
    )
    SELECT
      l.batch_id, l.ticket_id, l.matched_loan_id, l.method, l.opening, round(l.cur, 2),
      l.collected, l.movement, l.flag, COALESCE(l.days, l.prev_days), COALESCE(l.last_payment, l.prev_last_payment),
      l.payment_id, p_file_name, v_admin, now()
    FROM _lb_t l
    ON CONFLICT (batch_id, ticket_id) DO UPDATE SET
      matched_loan_id = EXCLUDED.matched_loan_id,
      match_method = EXCLUDED.match_method,
      current_arrears = EXCLUDED.current_arrears,
      collected_mtd = EXCLUDED.collected_mtd,
      movement = EXCLUDED.movement,
      flag_reason = EXCLUDED.flag_reason,
      days_in_arrears = EXCLUDED.days_in_arrears,
      last_payment_date = EXCLUDED.last_payment_date,
      payment_id = EXCLUDED.payment_id,
      file_name = EXCLUDED.file_name,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;

    -- A customer's balance is the total of their loans in the month's batches.
    UPDATE master_customers mc SET
      outstanding_balance = s.total,
      loan_book_arrears = s.total,
      loan_book_last_payment_date = GREATEST(mc.loan_book_last_payment_date, s.last_payment),
      last_payment_date = GREATEST(mc.last_payment_date, s.last_payment),
      updated_at = now()
    FROM (
      SELECT l.master_customer_id, sum(t.amount_owed) AS total, max(l.last_payment) AS last_payment
      FROM _lb_t l
      JOIN tickets t ON t.id = l.ticket_id
      GROUP BY l.master_customer_id
    ) s
    WHERE mc.id = s.master_customer_id;

    FOR v_customer IN SELECT DISTINCT master_customer_id FROM _lb_t LOOP
      PERFORM refresh_customer_payment_totals(v_customer);
    END LOOP;

    v_summary := get_loan_book_mtd_summary(p_batch_ids);

    IF NOT p_commit THEN
      RAISE EXCEPTION 'preview' USING ERRCODE = 'P0099';
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'committed', p_commit,
    'sync_batch_id', CASE WHEN p_commit THEN v_sync_id END,
    'rows_received', (SELECT count(*) FROM _lb_file),
    'tickets', v_ticket_count,
    'tickets_changed', v_tickets_changed,
    'reopened', v_reopened,
    'overridden_payments', v_overridden,
    'notifications', v_notified,
    'collected_before', v_collected_before,
    'summary', v_summary,
    'errors', '[]'::jsonb,
    'warnings', v_warnings
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sync_loan_book_mtd(uuid[], jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_loan_book_mtd(uuid[], jsonb, text, boolean) TO authenticated, service_role;

COMMIT;
