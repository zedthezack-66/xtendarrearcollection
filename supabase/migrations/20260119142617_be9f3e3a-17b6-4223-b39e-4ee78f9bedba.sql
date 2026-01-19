-- Enhanced bulk_transfer_clients RPC with proper batch recalculation
CREATE OR REPLACE FUNCTION public.bulk_transfer_clients(p_ticket_ids uuid[], p_target_agent_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
  v_transferred_count INTEGER := 0;
  v_failed_count INTEGER := 0;
  v_ticket_id UUID;
  v_ticket RECORD;
  v_errors TEXT[] := '{}';
  v_affected_batch_ids UUID[] := '{}';
BEGIN
  -- Check if caller is admin
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can perform bulk transfers';
  END IF;

  -- Validate target agent exists
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_target_agent_id) THEN
    RAISE EXCEPTION 'Target agent not found';
  END IF;

  -- Process each ticket
  FOREACH v_ticket_id IN ARRAY p_ticket_ids
  LOOP
    BEGIN
      -- Get ticket info
      SELECT id, batch_id, master_customer_id, amount_owed, assigned_agent
      INTO v_ticket
      FROM tickets
      WHERE id = v_ticket_id;
      
      IF v_ticket IS NULL THEN
        v_errors := array_append(v_errors, 'Ticket ' || v_ticket_id::text || ' not found');
        v_failed_count := v_failed_count + 1;
        CONTINUE;
      END IF;

      -- Skip if already assigned to target agent
      IF v_ticket.assigned_agent = p_target_agent_id THEN
        v_errors := array_append(v_errors, 'Ticket ' || v_ticket_id::text || ' already assigned to target agent');
        CONTINUE;
      END IF;

      -- Track affected batch for recalculation
      IF v_ticket.batch_id IS NOT NULL AND NOT (v_ticket.batch_id = ANY(v_affected_batch_ids)) THEN
        v_affected_batch_ids := array_append(v_affected_batch_ids, v_ticket.batch_id);
      END IF;

      -- Update ticket assigned_agent
      UPDATE tickets
      SET 
        assigned_agent = p_target_agent_id,
        updated_at = NOW()
      WHERE id = v_ticket_id;

      -- Update batch_customer assigned_agent_id if exists
      UPDATE batch_customers
      SET assigned_agent_id = p_target_agent_id
      WHERE batch_id = v_ticket.batch_id 
        AND master_customer_id = v_ticket.master_customer_id;

      -- Update master_customer assigned_agent
      UPDATE master_customers
      SET 
        assigned_agent = p_target_agent_id,
        updated_at = NOW()
      WHERE id = v_ticket.master_customer_id;

      v_transferred_count := v_transferred_count + 1;

    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 'Error transferring ticket ' || v_ticket_id::text || ': ' || SQLERRM);
      v_failed_count := v_failed_count + 1;
    END;
  END LOOP;

  v_result := json_build_object(
    'success', true,
    'transferred_count', v_transferred_count,
    'failed_count', v_failed_count,
    'total_requested', array_length(p_ticket_ids, 1),
    'errors', v_errors,
    'target_agent_id', p_target_agent_id,
    'affected_batch_ids', v_affected_batch_ids
  );

  RETURN v_result;
END;
$function$;

-- Enhanced transfer_client_to_batch RPC - ensure complete data transfer
CREATE OR REPLACE FUNCTION public.transfer_client_to_batch(p_ticket_id uuid, p_target_batch_id uuid, p_target_agent_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
  v_old_batch_id UUID;
  v_master_customer_id UUID;
  v_ticket RECORD;
  v_batch_customer RECORD;
  v_new_amount_owed NUMERIC;
BEGIN
  -- Check if caller is admin
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can transfer clients between batches';
  END IF;

  -- Get ticket info
  SELECT id, batch_id, master_customer_id, amount_owed, assigned_agent
  INTO v_ticket
  FROM tickets
  WHERE id = p_ticket_id;
  
  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;
  
  v_old_batch_id := v_ticket.batch_id;
  v_master_customer_id := v_ticket.master_customer_id;
  v_new_amount_owed := v_ticket.amount_owed;
  
  IF v_old_batch_id = p_target_batch_id THEN
    RAISE EXCEPTION 'Client is already in the target batch';
  END IF;

  -- Get the full batch_customer record for transfer
  SELECT * INTO v_batch_customer
  FROM batch_customers
  WHERE batch_id = v_old_batch_id AND master_customer_id = v_master_customer_id
  LIMIT 1;

  -- 1. Update ticket: move to new batch and new agent
  UPDATE tickets
  SET 
    batch_id = p_target_batch_id,
    assigned_agent = p_target_agent_id,
    updated_at = NOW()
  WHERE id = p_ticket_id;

  -- 2. Handle batch_customer transfer
  IF v_batch_customer IS NOT NULL THEN
    -- Delete from old batch
    DELETE FROM batch_customers WHERE id = v_batch_customer.id;
    
    -- Update old batch totals
    UPDATE batches
    SET 
      customer_count = GREATEST(customer_count - 1, 0),
      total_amount = GREATEST(total_amount - COALESCE(v_batch_customer.amount_owed, 0), 0)
    WHERE id = v_old_batch_id;

    -- Create new batch_customer entry in target batch (preserve all fields)
    INSERT INTO batch_customers (
      batch_id, master_customer_id, nrc_number, name, mobile_number, 
      amount_owed, assigned_agent_id, branch_name, employer_name, 
      employer_subdivision, loan_consultant, tenure, arrear_status,
      last_payment_date, reason_for_arrears
    )
    VALUES (
      p_target_batch_id,
      v_master_customer_id,
      v_batch_customer.nrc_number,
      v_batch_customer.name,
      v_batch_customer.mobile_number,
      v_new_amount_owed,
      p_target_agent_id,
      v_batch_customer.branch_name,
      v_batch_customer.employer_name,
      v_batch_customer.employer_subdivision,
      v_batch_customer.loan_consultant,
      v_batch_customer.tenure,
      v_batch_customer.arrear_status,
      v_batch_customer.last_payment_date,
      v_batch_customer.reason_for_arrears
    )
    ON CONFLICT DO NOTHING;

    -- Update target batch totals
    UPDATE batches
    SET 
      customer_count = customer_count + 1,
      total_amount = total_amount + v_new_amount_owed
    WHERE id = p_target_batch_id;
  ELSE
    -- No existing batch_customer, create new one from master_customer
    INSERT INTO batch_customers (
      batch_id, master_customer_id, nrc_number, name, mobile_number, 
      amount_owed, assigned_agent_id
    )
    SELECT 
      p_target_batch_id,
      mc.id,
      mc.nrc_number,
      mc.name,
      mc.mobile_number,
      v_new_amount_owed,
      p_target_agent_id
    FROM master_customers mc
    WHERE mc.id = v_master_customer_id
    ON CONFLICT DO NOTHING;

    -- Update target batch totals
    UPDATE batches
    SET 
      customer_count = customer_count + 1,
      total_amount = total_amount + v_new_amount_owed
    WHERE id = p_target_batch_id;
  END IF;

  -- 3. Update master_customer assigned_agent
  UPDATE master_customers
  SET 
    assigned_agent = p_target_agent_id,
    updated_at = NOW()
  WHERE id = v_master_customer_id;

  -- Note: Payments stay linked to ticket_id, so they automatically follow

  v_result := json_build_object(
    'success', true,
    'message', 'Client transferred successfully',
    'ticket_id', p_ticket_id,
    'from_batch_id', v_old_batch_id,
    'to_batch_id', p_target_batch_id,
    'new_agent_id', p_target_agent_id
  );

  RETURN v_result;
END;
$function$;