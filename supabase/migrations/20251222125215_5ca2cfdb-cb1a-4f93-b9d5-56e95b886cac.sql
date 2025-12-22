-- Update safe_delete_batch to allow agents to delete their own batches
-- Add archive functionality
DROP FUNCTION IF EXISTS public.safe_delete_batch(uuid, integer);

CREATE OR REPLACE FUNCTION public.safe_delete_batch(
  p_batch_id uuid, 
  p_chunk_size integer DEFAULT 500,
  p_archive boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_batch_uploader uuid;
  v_deleted_call_logs integer := 0;
  v_deleted_payments integer := 0;
  v_deleted_tickets integer := 0;
  v_deleted_batch_customers integer := 0;
  v_deleted_master_customers integer := 0;
  v_ticket_ids uuid[];
  v_master_customer_ids uuid[];
  v_rows_affected integer;
  v_archive_data jsonb;
  v_batch_data jsonb;
BEGIN
  -- Check if user is admin
  v_is_admin := has_role(auth.uid(), 'admin'::app_role);
  
  -- Get batch uploader
  SELECT uploaded_by INTO v_batch_uploader FROM batches WHERE id = p_batch_id;
  
  IF v_batch_uploader IS NULL THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  
  -- Allow if admin OR if agent uploaded this batch
  IF NOT v_is_admin AND v_batch_uploader != auth.uid() THEN
    RAISE EXCEPTION 'You can only delete batches you uploaded';
  END IF;

  -- Archive data if requested
  IF p_archive THEN
    -- Get batch info
    SELECT to_jsonb(b.*) INTO v_batch_data FROM batches b WHERE b.id = p_batch_id;
    
    -- Build archive with all related data
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

  -- Get all ticket IDs for this batch
  SELECT ARRAY_AGG(id) INTO v_ticket_ids FROM tickets WHERE batch_id = p_batch_id;
  
  -- Get all master customer IDs for this batch
  SELECT ARRAY_AGG(master_customer_id) INTO v_master_customer_ids 
  FROM batch_customers WHERE batch_id = p_batch_id;

  -- Delete call_logs in chunks (order 1: call_logs first)
  IF v_ticket_ids IS NOT NULL AND array_length(v_ticket_ids, 1) > 0 THEN
    LOOP
      DELETE FROM call_logs 
      WHERE ticket_id = ANY(v_ticket_ids)
      AND id IN (
        SELECT id FROM call_logs 
        WHERE ticket_id = ANY(v_ticket_ids) 
        LIMIT p_chunk_size
      );
      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      v_deleted_call_logs := v_deleted_call_logs + v_rows_affected;
      EXIT WHEN v_rows_affected < p_chunk_size;
    END LOOP;
  END IF;

  -- Delete payments in chunks (order 2: payments)
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

  -- Delete tickets in chunks (order 3: tickets)
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

  -- Delete batch_customers in chunks (order 4: batch rows)
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

  -- Delete orphaned master_customers (not in any other batch)
  IF v_master_customer_ids IS NOT NULL THEN
    FOR i IN 1..array_length(v_master_customer_ids, 1) LOOP
      IF NOT EXISTS (SELECT 1 FROM batch_customers WHERE master_customer_id = v_master_customer_ids[i]) THEN
        DELETE FROM master_customers WHERE id = v_master_customer_ids[i];
        GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
        v_deleted_master_customers := v_deleted_master_customers + v_rows_affected;
      END IF;
    END LOOP;
  END IF;

  -- Delete the batch itself
  DELETE FROM batches WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_call_logs', v_deleted_call_logs,
    'deleted_payments', v_deleted_payments,
    'deleted_tickets', v_deleted_tickets,
    'deleted_batch_customers', v_deleted_batch_customers,
    'deleted_master_customers', v_deleted_master_customers,
    'archive_data', CASE WHEN p_archive THEN v_archive_data ELSE null END
  );
END;
$$;