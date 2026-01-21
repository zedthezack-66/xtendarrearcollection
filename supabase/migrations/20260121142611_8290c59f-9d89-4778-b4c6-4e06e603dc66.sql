-- Create amount_owed_audit_logs table
CREATE TABLE IF NOT EXISTS public.amount_owed_audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL,
  master_customer_id UUID NOT NULL,
  old_amount NUMERIC NOT NULL,
  new_amount NUMERIC NOT NULL,
  changed_by UUID NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual_edit',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.amount_owed_audit_logs ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admin full access to audit logs"
ON public.amount_owed_audit_logs
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Agents can view logs for their assigned tickets
CREATE POLICY "Agents view own audit logs"
ON public.amount_owed_audit_logs
FOR SELECT
USING (
  ticket_id IN (
    SELECT id FROM tickets WHERE assigned_agent = auth.uid()
  )
);

-- Agents can insert audit logs for their tickets
CREATE POLICY "Agents can insert audit logs"
ON public.amount_owed_audit_logs
FOR INSERT
WITH CHECK (
  changed_by = auth.uid()
);

-- Create index for faster lookups
CREATE INDEX idx_audit_logs_ticket_id ON public.amount_owed_audit_logs(ticket_id);
CREATE INDEX idx_audit_logs_master_customer_id ON public.amount_owed_audit_logs(master_customer_id);
CREATE INDEX idx_audit_logs_created_at ON public.amount_owed_audit_logs(created_at);

-- Create RPC to update amount owed with audit logging and recalculations
CREATE OR REPLACE FUNCTION public.update_amount_owed(
  p_ticket_id UUID,
  p_new_amount NUMERIC,
  p_source TEXT DEFAULT 'manual_edit',
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket RECORD;
  v_old_amount NUMERIC;
  v_total_paid NUMERIC;
  v_new_balance NUMERIC;
  v_new_status TEXT;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  -- Validate amount
  IF p_new_amount < 0 THEN
    RAISE EXCEPTION 'Amount must be >= 0';
  END IF;
  
  -- Get ticket with current values
  SELECT t.*, mc.id as mc_id
  INTO v_ticket
  FROM tickets t
  JOIN master_customers mc ON mc.id = t.master_customer_id
  WHERE t.id = p_ticket_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;
  
  -- Check permissions (admin or assigned agent)
  IF NOT (
    has_role(v_user_id, 'admin'::app_role) OR 
    v_ticket.assigned_agent = v_user_id
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  
  v_old_amount := COALESCE(v_ticket.amount_owed, 0);
  
  -- Skip if no change
  IF v_old_amount = p_new_amount THEN
    RETURN jsonb_build_object('success', true, 'message', 'No change required');
  END IF;
  
  -- Calculate total paid for this ticket
  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM payments
  WHERE ticket_id = p_ticket_id;
  
  -- Calculate new balance
  v_new_balance := GREATEST(0, p_new_amount - v_total_paid);
  
  -- Determine new status based on payment state
  IF p_new_amount = 0 THEN
    -- Amount owed is 0 - set to Pending Confirmation
    v_new_status := 'Pending Confirmation';
  ELSIF v_total_paid = 0 THEN
    v_new_status := 'Open';
  ELSIF v_new_balance > 0 THEN
    v_new_status := 'In Progress';
  ELSE
    -- Fully paid
    v_new_status := 'Pending Confirmation';
  END IF;
  
  -- Insert audit log FIRST (immutable)
  INSERT INTO amount_owed_audit_logs (
    ticket_id,
    master_customer_id,
    old_amount,
    new_amount,
    changed_by,
    source,
    notes
  ) VALUES (
    p_ticket_id,
    v_ticket.master_customer_id,
    v_old_amount,
    p_new_amount,
    v_user_id,
    p_source,
    p_notes
  );
  
  -- Update ticket
  UPDATE tickets
  SET 
    amount_owed = p_new_amount,
    status = v_new_status,
    updated_at = now()
  WHERE id = p_ticket_id;
  
  -- Update master customer totals
  UPDATE master_customers
  SET
    total_owed = p_new_amount,
    outstanding_balance = v_new_balance,
    updated_at = now()
  WHERE id = v_ticket.master_customer_id;
  
  -- Create notification if significant change
  IF v_ticket.assigned_agent IS NOT NULL AND v_old_amount != p_new_amount THEN
    INSERT INTO agent_notifications (
      agent_id,
      title,
      message,
      type,
      related_ticket_id,
      related_customer_id
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
$$;