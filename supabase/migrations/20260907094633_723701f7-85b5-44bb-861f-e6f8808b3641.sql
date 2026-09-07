ALTER TABLE public.call_logs
ALTER COLUMN ticket_id DROP NOT NULL;

ALTER TABLE public.call_logs
ADD COLUMN IF NOT EXISTS is_from_previous_batch boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ticket_status_at_save varchar(50);

UPDATE public.call_logs cl
SET ticket_status_at_save = t.status
FROM public.tickets t
WHERE cl.ticket_id = t.id
  AND cl.ticket_status_at_save IS NULL;

CREATE INDEX IF NOT EXISTS idx_call_logs_master_customer_id
ON public.call_logs(master_customer_id);

DROP POLICY IF EXISTS "Agents see own call_logs" ON public.call_logs;

CREATE POLICY "Agents see own and customer call_logs"
ON public.call_logs
FOR SELECT
USING (
  agent_id = auth.uid()
  OR master_customer_id IN (
    SELECT id
    FROM public.master_customers
    WHERE assigned_agent = auth.uid()
  )
);

CREATE OR REPLACE FUNCTION public.safe_delete_batch(
  p_batch_id uuid,
  p_chunk_size integer DEFAULT 500,
  p_archive boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean;
  v_batch_uploader uuid;
  v_detached_call_logs integer := 0;
  v_deleted_payments integer := 0;
  v_deleted_tickets integer := 0;
  v_deleted_batch_customers integer := 0;
  v_deleted_master_customers integer := 0;
  v_ticket_ids uuid[];
  v_master_customer_ids uuid[];
  v_rows_affected integer;
  v_archive_data jsonb;
  v_batch_data jsonb;
  v_has_customer_call_logs boolean := false;
BEGIN
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);

  SELECT uploaded_by INTO v_batch_uploader FROM batches WHERE id = p_batch_id;

  IF v_batch_uploader IS NULL THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;

  IF NOT v_is_admin AND v_batch_uploader != auth.uid() THEN
    RAISE EXCEPTION 'You can only delete batches you uploaded';
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
    UPDATE call_logs
    SET ticket_id = NULL
    WHERE ticket_id = ANY(v_ticket_ids);
    GET DIAGNOSTICS v_detached_call_logs = ROW_COUNT;
  END IF;

  IF v_ticket_ids IS NOT NULL AND array_length(v_ticket_ids, 1) > 0 THEN
    LOOP
      DELETE FROM payments
      WHERE ticket_id = ANY(v_ticket_ids)
      AND id IN (
        SELECT id FROM payments
        WHERE ticket_id = ANY(v_ticket_ids)
        LIMIT p_chunk_size
      );
      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      v_deleted_payments := v_deleted_payments + v_rows_affected;
      EXIT WHEN v_rows_affected < p_chunk_size;
    END LOOP;
  END IF;

  LOOP
    DELETE FROM tickets
    WHERE batch_id = p_batch_id
    AND id IN (
      SELECT id FROM tickets
      WHERE batch_id = p_batch_id
      LIMIT p_chunk_size
    );
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    v_deleted_tickets := v_deleted_tickets + v_rows_affected;
    EXIT WHEN v_rows_affected = 0 OR v_rows_affected < p_chunk_size;
  END LOOP;

  LOOP
    DELETE FROM batch_customers
    WHERE batch_id = p_batch_id
    AND id IN (
      SELECT id FROM batch_customers
      WHERE batch_id = p_batch_id
      LIMIT p_chunk_size
    );
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    v_deleted_batch_customers := v_deleted_batch_customers + v_rows_affected;
    EXIT WHEN v_rows_affected = 0 OR v_rows_affected < p_chunk_size;
  END LOOP;

  IF v_master_customer_ids IS NOT NULL THEN
    FOR i IN 1..array_length(v_master_customer_ids, 1) LOOP
      IF NOT EXISTS (SELECT 1 FROM batch_customers WHERE master_customer_id = v_master_customer_ids[i]) THEN
        SELECT EXISTS(SELECT 1 FROM call_logs WHERE master_customer_id = v_master_customer_ids[i])
        INTO v_has_customer_call_logs;

        IF NOT v_has_customer_call_logs THEN
          DELETE FROM master_customers WHERE id = v_master_customer_ids[i];
          GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
          v_deleted_master_customers := v_deleted_master_customers + v_rows_affected;
        END IF;
      END IF;
    END LOOP;
  END IF;

  DELETE FROM batches WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_call_logs', 0,
    'detached_call_logs', v_detached_call_logs,
    'deleted_payments', v_deleted_payments,
    'deleted_tickets', v_deleted_tickets,
    'deleted_batch_customers', v_deleted_batch_customers,
    'deleted_master_customers', v_deleted_master_customers,
    'archive_data', CASE WHEN p_archive THEN v_archive_data ELSE null END
  );
END;
$function$;

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
  v_deleted_payments integer := 0;
  v_detached_call_logs integer := 0;
  v_has_other_tickets boolean;
  v_has_customer_call_logs boolean := false;
BEGIN
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);

  SELECT assigned_agent, master_customer_id, batch_id
  INTO v_ticket_agent, v_master_customer_id, v_batch_id
  FROM tickets
  WHERE id = p_ticket_id;

  IF v_master_customer_id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  IF NOT v_is_admin AND v_ticket_agent != auth.uid() THEN
    RAISE EXCEPTION 'You can only delete tickets assigned to you';
  END IF;

  UPDATE call_logs SET ticket_id = NULL WHERE ticket_id = p_ticket_id;
  GET DIAGNOSTICS v_detached_call_logs = ROW_COUNT;

  DELETE FROM payments WHERE ticket_id = p_ticket_id;
  GET DIAGNOSTICS v_deleted_payments = ROW_COUNT;

  DELETE FROM tickets WHERE id = p_ticket_id;

  IF v_batch_id IS NOT NULL THEN
    DELETE FROM batch_customers
    WHERE batch_id = v_batch_id AND master_customer_id = v_master_customer_id;
  END IF;

  SELECT EXISTS(SELECT 1 FROM tickets WHERE master_customer_id = v_master_customer_id)
  INTO v_has_other_tickets;

  IF NOT v_has_other_tickets THEN
    SELECT EXISTS(SELECT 1 FROM call_logs WHERE master_customer_id = v_master_customer_id)
    INTO v_has_customer_call_logs;

    IF NOT v_has_customer_call_logs THEN
      DELETE FROM master_customers WHERE id = v_master_customer_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_call_logs', 0,
    'detached_call_logs', v_detached_call_logs,
    'deleted_payments', v_deleted_payments,
    'master_customer_deleted', NOT v_has_other_tickets AND NOT v_has_customer_call_logs
  );
END;
$function$;