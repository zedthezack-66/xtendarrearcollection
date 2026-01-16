-- Add new customer contact and workplace fields to master_customers
ALTER TABLE public.master_customers 
ADD COLUMN IF NOT EXISTS next_of_kin_name text,
ADD COLUMN IF NOT EXISTS next_of_kin_contact text,
ADD COLUMN IF NOT EXISTS workplace_contact text,
ADD COLUMN IF NOT EXISTS workplace_destination text;

-- Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_master_customers_next_of_kin_name ON public.master_customers(next_of_kin_name);

-- Add comments for documentation
COMMENT ON COLUMN public.master_customers.next_of_kin_name IS 'Name of next of kin contact';
COMMENT ON COLUMN public.master_customers.next_of_kin_contact IS 'Phone/contact number for next of kin';
COMMENT ON COLUMN public.master_customers.workplace_contact IS 'Contact number for workplace';
COMMENT ON COLUMN public.master_customers.workplace_destination IS 'Workplace destination/location';

-- Create bulk transfer function for admin to transfer multiple clients at once
CREATE OR REPLACE FUNCTION public.bulk_transfer_clients(
  p_ticket_ids UUID[],
  p_target_agent_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_transferred_count INTEGER := 0;
  v_failed_count INTEGER := 0;
  v_ticket_id UUID;
  v_ticket RECORD;
  v_errors TEXT[] := '{}';
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
    'target_agent_id', p_target_agent_id
  );

  RETURN v_result;
END;
$$;