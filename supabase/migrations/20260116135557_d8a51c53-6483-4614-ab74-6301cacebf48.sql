-- Add loan_book_last_payment_date to master_customers (separate from system payment date)
ALTER TABLE public.master_customers 
ADD COLUMN IF NOT EXISTS loan_book_last_payment_date TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.master_customers 
ADD COLUMN IF NOT EXISTS loan_book_arrears NUMERIC DEFAULT 0;

-- Create arrears_sync_logs table for audit trail
CREATE TABLE IF NOT EXISTS public.arrears_sync_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sync_batch_id UUID NOT NULL,
  admin_user_id UUID NOT NULL,
  nrc_number TEXT NOT NULL,
  master_customer_id UUID,
  old_arrears NUMERIC NOT NULL DEFAULT 0,
  new_arrears NUMERIC NOT NULL DEFAULT 0,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('Increased', 'Reduced', 'Cleared', 'Maintained', 'Not Found')),
  loan_book_payment_date TIMESTAMP WITH TIME ZONE,
  ticket_resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on arrears_sync_logs
ALTER TABLE public.arrears_sync_logs ENABLE ROW LEVEL SECURITY;

-- Admin-only access to sync logs
CREATE POLICY "Admin full access to arrears_sync_logs" 
ON public.arrears_sync_logs 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Agents can view sync logs for their customers
CREATE POLICY "Agents can view sync logs for assigned customers" 
ON public.arrears_sync_logs 
FOR SELECT 
USING (
  master_customer_id IN (
    SELECT id FROM master_customers WHERE assigned_agent = auth.uid()
  )
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_arrears_sync_logs_sync_batch ON public.arrears_sync_logs(sync_batch_id);
CREATE INDEX IF NOT EXISTS idx_arrears_sync_logs_nrc ON public.arrears_sync_logs(nrc_number);
CREATE INDEX IF NOT EXISTS idx_arrears_sync_logs_created ON public.arrears_sync_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_arrears_sync_logs_movement ON public.arrears_sync_logs(movement_type);
CREATE INDEX IF NOT EXISTS idx_master_customers_loan_book ON public.master_customers(loan_book_last_payment_date);

-- RPC: Process loan book sync (Admin-only, atomic transaction)
CREATE OR REPLACE FUNCTION public.process_loan_book_sync(
  p_sync_data JSONB -- Array of {nrc_number, arrears_amount, last_payment_date}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sync_batch_id UUID;
  v_admin_id UUID;
  v_record JSONB;
  v_customer RECORD;
  v_old_arrears NUMERIC;
  v_new_arrears NUMERIC;
  v_movement_type TEXT;
  v_ticket_resolved BOOLEAN;
  v_payment_date TIMESTAMP WITH TIME ZONE;
  v_processed INTEGER := 0;
  v_updated INTEGER := 0;
  v_not_found INTEGER := 0;
  v_resolved INTEGER := 0;
  v_errors TEXT[] := '{}';
BEGIN
  -- Check if caller is admin
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can perform loan book sync';
  END IF;
  
  v_admin_id := auth.uid();
  v_sync_batch_id := gen_random_uuid();
  
  -- Process each record
  FOR v_record IN SELECT * FROM jsonb_array_elements(p_sync_data)
  LOOP
    v_processed := v_processed + 1;
    v_ticket_resolved := FALSE;
    
    -- Parse values
    v_new_arrears := COALESCE((v_record->>'arrears_amount')::NUMERIC, 0);
    v_payment_date := CASE 
      WHEN v_record->>'last_payment_date' IS NOT NULL AND v_record->>'last_payment_date' != ''
      THEN (v_record->>'last_payment_date')::TIMESTAMP WITH TIME ZONE
      ELSE NULL
    END;
    
    -- Find customer by NRC
    SELECT id, COALESCE(loan_book_arrears, outstanding_balance, 0) AS current_arrears
    INTO v_customer
    FROM master_customers
    WHERE nrc_number = v_record->>'nrc_number'
    LIMIT 1;
    
    IF v_customer IS NULL THEN
      -- Customer not found - log and continue
      v_not_found := v_not_found + 1;
      v_movement_type := 'Not Found';
      
      INSERT INTO arrears_sync_logs (
        sync_batch_id, admin_user_id, nrc_number, master_customer_id,
        old_arrears, new_arrears, movement_type, loan_book_payment_date
      ) VALUES (
        v_sync_batch_id, v_admin_id, v_record->>'nrc_number', NULL,
        0, v_new_arrears, v_movement_type, v_payment_date
      );
      
      CONTINUE;
    END IF;
    
    v_old_arrears := v_customer.current_arrears;
    
    -- Determine movement type
    IF v_new_arrears = 0 THEN
      v_movement_type := 'Cleared';
    ELSIF v_new_arrears > v_old_arrears THEN
      v_movement_type := 'Increased';
    ELSIF v_new_arrears < v_old_arrears THEN
      v_movement_type := 'Reduced';
    ELSE
      v_movement_type := 'Maintained';
    END IF;
    
    -- Update master_customer (ONLY arrears and loan book payment date)
    UPDATE master_customers
    SET 
      loan_book_arrears = v_new_arrears,
      outstanding_balance = v_new_arrears,
      loan_book_last_payment_date = COALESCE(v_payment_date, loan_book_last_payment_date),
      updated_at = NOW()
    WHERE id = v_customer.id;
    
    -- Update tickets amount_owed for this customer
    UPDATE tickets
    SET 
      amount_owed = v_new_arrears,
      updated_at = NOW()
    WHERE master_customer_id = v_customer.id;
    
    -- If arrears = 0, resolve ticket
    IF v_new_arrears = 0 THEN
      UPDATE tickets
      SET 
        status = 'Resolved',
        resolved_date = NOW(),
        updated_at = NOW()
      WHERE master_customer_id = v_customer.id
        AND status != 'Resolved';
      
      v_ticket_resolved := TRUE;
      v_resolved := v_resolved + 1;
    END IF;
    
    v_updated := v_updated + 1;
    
    -- Log the sync
    INSERT INTO arrears_sync_logs (
      sync_batch_id, admin_user_id, nrc_number, master_customer_id,
      old_arrears, new_arrears, movement_type, loan_book_payment_date, ticket_resolved
    ) VALUES (
      v_sync_batch_id, v_admin_id, v_record->>'nrc_number', v_customer.id,
      v_old_arrears, v_new_arrears, v_movement_type, v_payment_date, v_ticket_resolved
    );
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'sync_batch_id', v_sync_batch_id,
    'processed', v_processed,
    'updated', v_updated,
    'not_found', v_not_found,
    'resolved', v_resolved,
    'errors', v_errors
  );
END;
$$;

-- RPC: Get arrears movement analytics (Admin-only)
CREATE OR REPLACE FUNCTION public.get_arrears_movement_analytics(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_agent_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result JSONB;
  v_start_date TIMESTAMP WITH TIME ZONE;
  v_end_date TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Check if caller is admin
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can access arrears analytics';
  END IF;
  
  v_start_date := COALESCE(p_start_date::TIMESTAMP WITH TIME ZONE, NOW() - INTERVAL '7 days');
  v_end_date := COALESCE(p_end_date::TIMESTAMP WITH TIME ZONE, NOW());
  
  WITH movement_stats AS (
    SELECT 
      asl.movement_type,
      COUNT(*) AS count,
      SUM(ABS(asl.new_arrears - asl.old_arrears)) AS total_change,
      COUNT(*) FILTER (WHERE asl.ticket_resolved) AS tickets_resolved
    FROM arrears_sync_logs asl
    LEFT JOIN master_customers mc ON mc.id = asl.master_customer_id
    WHERE asl.created_at >= v_start_date 
      AND asl.created_at <= v_end_date
      AND asl.movement_type != 'Not Found'
      AND (p_agent_id IS NULL OR mc.assigned_agent = p_agent_id)
    GROUP BY asl.movement_type
  ),
  agent_breakdown AS (
    SELECT 
      pr.id AS agent_id,
      COALESCE(pr.display_name, pr.full_name) AS agent_name,
      COUNT(*) FILTER (WHERE asl.movement_type = 'Cleared') AS cleared,
      COUNT(*) FILTER (WHERE asl.movement_type = 'Reduced') AS reduced,
      COUNT(*) FILTER (WHERE asl.movement_type = 'Increased') AS increased,
      COUNT(*) FILTER (WHERE asl.movement_type = 'Maintained') AS maintained,
      COUNT(*) FILTER (WHERE asl.ticket_resolved) AS tickets_resolved,
      SUM(CASE WHEN asl.movement_type IN ('Cleared', 'Reduced') 
          THEN asl.old_arrears - asl.new_arrears ELSE 0 END) AS total_recovered
    FROM profiles pr
    LEFT JOIN master_customers mc ON mc.assigned_agent = pr.id
    LEFT JOIN arrears_sync_logs asl ON asl.master_customer_id = mc.id
      AND asl.created_at >= v_start_date 
      AND asl.created_at <= v_end_date
      AND asl.movement_type != 'Not Found'
    WHERE (p_agent_id IS NULL OR pr.id = p_agent_id)
    GROUP BY pr.id, pr.display_name, pr.full_name
    HAVING COUNT(asl.id) > 0
  ),
  sync_history AS (
    SELECT DISTINCT ON (sync_batch_id)
      sync_batch_id,
      created_at AS sync_date,
      admin_user_id,
      (SELECT COUNT(*) FROM arrears_sync_logs WHERE sync_batch_id = asl.sync_batch_id) AS records_processed
    FROM arrears_sync_logs asl
    WHERE created_at >= v_start_date AND created_at <= v_end_date
    ORDER BY sync_batch_id, created_at DESC
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'cleared', COALESCE(SUM(count) FILTER (WHERE movement_type = 'Cleared'), 0),
        'reduced', COALESCE(SUM(count) FILTER (WHERE movement_type = 'Reduced'), 0),
        'increased', COALESCE(SUM(count) FILTER (WHERE movement_type = 'Increased'), 0),
        'maintained', COALESCE(SUM(count) FILTER (WHERE movement_type = 'Maintained'), 0),
        'total_tickets_resolved', COALESCE(SUM(tickets_resolved), 0),
        'total_change_amount', COALESCE(SUM(total_change), 0)
      )
      FROM movement_stats
    ),
    'by_agent', (SELECT COALESCE(jsonb_agg(to_jsonb(ab.*)), '[]'::jsonb) FROM agent_breakdown ab),
    'recent_syncs', (SELECT COALESCE(jsonb_agg(to_jsonb(sh.*)), '[]'::jsonb) FROM sync_history sh),
    'date_range', jsonb_build_object(
      'start_date', v_start_date,
      'end_date', v_end_date
    )
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;

-- Add comments
COMMENT ON TABLE public.arrears_sync_logs IS 'Audit trail for daily loan book sync operations';
COMMENT ON COLUMN public.master_customers.loan_book_last_payment_date IS 'Last payment date from loan book (authoritative)';
COMMENT ON COLUMN public.master_customers.loan_book_arrears IS 'Current arrears amount from loan book';