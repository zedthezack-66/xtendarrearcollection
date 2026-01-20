-- =====================================================
-- ARREARS SNAPSHOTS TABLE - For time-based comparisons
-- =====================================================

-- Create arrears_snapshots table to track arrears state after each sync
CREATE TABLE IF NOT EXISTS public.arrears_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sync_batch_id UUID, -- Links to specific sync operation
  source TEXT NOT NULL CHECK (source IN ('daily_sync', 'batch_upload', 'batch_update', 'manual')),
  
  -- Agent-level snapshot
  agent_id UUID REFERENCES public.profiles(id),
  agent_total_arrears NUMERIC NOT NULL DEFAULT 0,
  agent_ticket_count INTEGER NOT NULL DEFAULT 0,
  
  -- Batch-level snapshot
  batch_id UUID REFERENCES public.batches(id),
  batch_total_arrears NUMERIC NOT NULL DEFAULT 0,
  batch_ticket_count INTEGER NOT NULL DEFAULT 0,
  
  -- System-level totals (stored in one row per sync)
  system_total_arrears NUMERIC DEFAULT NULL,
  system_total_tickets INTEGER DEFAULT NULL,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON public.arrears_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_agent ON public.arrears_snapshots(agent_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_batch ON public.arrears_snapshots(batch_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_sync_batch ON public.arrears_snapshots(sync_batch_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_source ON public.arrears_snapshots(source);

-- Enable RLS
ALTER TABLE public.arrears_snapshots ENABLE ROW LEVEL SECURITY;

-- Admin-only access
CREATE POLICY "Admins can view all snapshots"
ON public.arrears_snapshots FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

CREATE POLICY "Admins can insert snapshots"
ON public.arrears_snapshots FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

-- =====================================================
-- ENHANCED SYNC LOG - Add source column
-- =====================================================
ALTER TABLE public.arrears_sync_logs 
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'daily_sync';

-- =====================================================
-- FUNCTION: Create arrears snapshots after sync
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_arrears_snapshots(
  p_sync_batch_id UUID,
  p_source TEXT DEFAULT 'daily_sync'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_time TIMESTAMP WITH TIME ZONE := now();
  v_system_arrears NUMERIC := 0;
  v_system_tickets INTEGER := 0;
BEGIN
  -- Calculate and insert agent-level snapshots
  INSERT INTO arrears_snapshots (
    snapshot_date,
    sync_batch_id,
    source,
    agent_id,
    agent_total_arrears,
    agent_ticket_count
  )
  SELECT 
    v_snapshot_time,
    p_sync_batch_id,
    p_source,
    t.assigned_agent,
    COALESCE(SUM(t.amount_owed), 0),
    COUNT(t.id)
  FROM tickets t
  WHERE t.assigned_agent IS NOT NULL
    AND t.status != 'Resolved'
  GROUP BY t.assigned_agent;

  -- Calculate and insert batch-level snapshots
  INSERT INTO arrears_snapshots (
    snapshot_date,
    sync_batch_id,
    source,
    batch_id,
    batch_total_arrears,
    batch_ticket_count
  )
  SELECT 
    v_snapshot_time,
    p_sync_batch_id,
    p_source,
    t.batch_id,
    COALESCE(SUM(t.amount_owed), 0),
    COUNT(t.id)
  FROM tickets t
  WHERE t.batch_id IS NOT NULL
    AND t.status != 'Resolved'
  GROUP BY t.batch_id;

  -- Calculate system totals
  SELECT 
    COALESCE(SUM(amount_owed), 0),
    COUNT(id)
  INTO v_system_arrears, v_system_tickets
  FROM tickets
  WHERE status != 'Resolved';

  -- Insert one system-level snapshot
  INSERT INTO arrears_snapshots (
    snapshot_date,
    sync_batch_id,
    source,
    system_total_arrears,
    system_total_tickets
  ) VALUES (
    v_snapshot_time,
    p_sync_batch_id,
    p_source,
    v_system_arrears,
    v_system_tickets
  );

  RETURN json_build_object(
    'success', true,
    'snapshot_time', v_snapshot_time,
    'system_total_arrears', v_system_arrears,
    'system_total_tickets', v_system_tickets
  );
END;
$$;

-- =====================================================
-- FUNCTION: Process batch update with arrears movement
-- This mimics the loan book sync logic for batch updates
-- =====================================================
CREATE OR REPLACE FUNCTION public.process_batch_arrears_update(
  p_batch_id UUID,
  p_updates JSON
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_sync_batch_id UUID := gen_random_uuid();
  v_record JSON;
  v_nrc TEXT;
  v_new_arrears NUMERIC;
  v_old_arrears NUMERIC;
  v_customer_id UUID;
  v_ticket_id UUID;
  v_agent_id UUID;
  v_customer_name TEXT;
  v_movement_type TEXT;
  v_payment_amount NUMERIC;
  v_processed INTEGER := 0;
  v_updated INTEGER := 0;
  v_payments_created INTEGER := 0;
  v_resolved INTEGER := 0;
  v_errors TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Verify admin role
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_admin_id AND role = 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin access required');
  END IF;

  -- Process each record
  FOR v_record IN SELECT * FROM json_array_elements(p_updates)
  LOOP
    v_nrc := v_record->>'nrc_number';
    v_new_arrears := COALESCE((v_record->>'amount_owed')::NUMERIC, NULL);
    
    -- Skip if no amount change specified
    IF v_new_arrears IS NULL THEN
      CONTINUE;
    END IF;
    
    v_processed := v_processed + 1;
    
    -- Get current ticket data for this batch
    SELECT t.id, t.amount_owed, t.assigned_agent, t.master_customer_id, t.customer_name
    INTO v_ticket_id, v_old_arrears, v_agent_id, v_customer_id, v_customer_name
    FROM tickets t
    WHERE t.batch_id = p_batch_id AND t.nrc_number = v_nrc;
    
    IF v_ticket_id IS NULL THEN
      v_errors := array_append(v_errors, 'NRC not found in batch: ' || v_nrc);
      CONTINUE;
    END IF;
    
    -- Determine movement type
    IF v_new_arrears = 0 AND v_old_arrears > 0 THEN
      v_movement_type := 'Cleared';
      v_payment_amount := v_old_arrears;
    ELSIF v_new_arrears < v_old_arrears THEN
      v_movement_type := 'Reduced';
      v_payment_amount := v_old_arrears - v_new_arrears;
    ELSIF v_new_arrears > v_old_arrears THEN
      v_movement_type := 'Increased';
      v_payment_amount := 0;
    ELSE
      v_movement_type := 'Maintained';
      v_payment_amount := 0;
    END IF;
    
    -- Create payment record for reductions
    IF v_payment_amount > 0 THEN
      INSERT INTO payments (
        master_customer_id,
        ticket_id,
        amount,
        payment_method,
        customer_name,
        notes,
        recorded_by,
        payment_date
      ) VALUES (
        v_customer_id,
        v_ticket_id,
        v_payment_amount,
        'Batch Update',
        COALESCE(v_customer_name, 'Unknown'),
        'Auto-recorded from Batch Update. Movement: ' || v_movement_type,
        v_admin_id,
        now()
      );
      v_payments_created := v_payments_created + 1;
      
      -- Send notification to agent
      IF v_agent_id IS NOT NULL THEN
        INSERT INTO agent_notifications (
          agent_id,
          title,
          message,
          type,
          related_ticket_id,
          related_customer_id
        ) VALUES (
          v_agent_id,
          CASE WHEN v_movement_type = 'Cleared' THEN 'Account Cleared!' ELSE 'Payment Received' END,
          CASE WHEN v_movement_type = 'Cleared' 
               THEN v_customer_name || '''s arrears have been fully cleared (K' || v_payment_amount || '). Review and close ticket.'
               ELSE v_customer_name || ' made a payment of K' || v_payment_amount || '. Arrears reduced from K' || v_old_arrears || ' to K' || v_new_arrears || '.'
          END,
          CASE WHEN v_movement_type = 'Cleared' THEN 'resolved' ELSE 'payment' END,
          v_ticket_id,
          v_customer_id
        );
      END IF;
    END IF;
    
    -- Update ticket
    UPDATE tickets SET
      amount_owed = v_new_arrears,
      status = CASE WHEN v_new_arrears = 0 THEN 'Resolved' ELSE status END,
      resolved_date = CASE WHEN v_new_arrears = 0 THEN now() ELSE resolved_date END,
      updated_at = now()
    WHERE id = v_ticket_id;
    
    IF v_new_arrears = 0 THEN
      v_resolved := v_resolved + 1;
    END IF;
    
    -- Update batch_customers
    UPDATE batch_customers SET
      amount_owed = v_new_arrears
    WHERE batch_id = p_batch_id AND nrc_number = v_nrc;
    
    -- Update master_customers loan_book_arrears
    UPDATE master_customers SET
      loan_book_arrears = v_new_arrears,
      updated_at = now()
    WHERE id = v_customer_id;
    
    -- Log the movement
    INSERT INTO arrears_sync_logs (
      sync_batch_id,
      admin_user_id,
      nrc_number,
      master_customer_id,
      old_arrears,
      new_arrears,
      movement_type,
      ticket_resolved,
      source
    ) VALUES (
      v_sync_batch_id,
      v_admin_id,
      v_nrc,
      v_customer_id,
      v_old_arrears,
      v_new_arrears,
      v_movement_type,
      v_new_arrears = 0,
      'batch_update'
    );
    
    v_updated := v_updated + 1;
  END LOOP;
  
  -- Create snapshots after update
  PERFORM create_arrears_snapshots(v_sync_batch_id, 'batch_update');
  
  RETURN json_build_object(
    'success', true,
    'sync_batch_id', v_sync_batch_id,
    'processed', v_processed,
    'updated', v_updated,
    'payments_created', v_payments_created,
    'resolved', v_resolved,
    'errors', v_errors
  );
END;
$$;

-- =====================================================
-- UPDATE: Existing process_loan_book_sync to create snapshots
-- =====================================================
-- We need to modify the existing function to call create_arrears_snapshots at the end
-- First drop and recreate with snapshot creation

DROP FUNCTION IF EXISTS public.process_loan_book_sync(jsonb);
DROP FUNCTION IF EXISTS public.process_loan_book_sync(text);

CREATE OR REPLACE FUNCTION public.process_loan_book_sync(p_sync_data TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_sync_batch_id UUID := gen_random_uuid();
  v_data JSON;
  v_record JSON;
  v_nrc TEXT;
  v_arrears NUMERIC;
  v_payment_date TEXT;
  v_customer_id UUID;
  v_ticket_id UUID;
  v_agent_id UUID;
  v_old_arrears NUMERIC;
  v_movement_type TEXT;
  v_arrears_change NUMERIC;
  v_processed INTEGER := 0;
  v_updated INTEGER := 0;
  v_not_found INTEGER := 0;
  v_resolved INTEGER := 0;
  v_payments_created INTEGER := 0;
  v_errors TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Verify admin role
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_admin_id AND role = 'admin') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Admin access required',
      'sync_batch_id', v_sync_batch_id,
      'processed', 0,
      'updated', 0,
      'not_found', 0,
      'resolved', 0,
      'payments_created', 0,
      'errors', ARRAY['Unauthorized: Admin role required']
    );
  END IF;

  -- Parse JSON data
  BEGIN
    v_data := p_sync_data::JSON;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Invalid JSON data',
      'sync_batch_id', v_sync_batch_id,
      'processed', 0,
      'updated', 0,
      'not_found', 0,
      'resolved', 0,
      'payments_created', 0,
      'errors', ARRAY['Failed to parse JSON: ' || SQLERRM]
    );
  END;

  -- Process each record
  FOR v_record IN SELECT * FROM json_array_elements(v_data)
  LOOP
    v_nrc := v_record->>'nrc_number';
    v_arrears := NULLIF(v_record->>'arrears_amount', '')::NUMERIC;
    v_payment_date := v_record->>'last_payment_date';
    
    v_processed := v_processed + 1;
    
    -- Skip if arrears is null (no change)
    IF v_arrears IS NULL THEN
      CONTINUE;
    END IF;
    
    -- Find customer by NRC
    SELECT id, COALESCE(loan_book_arrears, outstanding_balance, 0)
    INTO v_customer_id, v_old_arrears
    FROM master_customers
    WHERE nrc_number = v_nrc;
    
    IF v_customer_id IS NULL THEN
      v_not_found := v_not_found + 1;
      
      -- Log not found record
      INSERT INTO arrears_sync_logs (
        sync_batch_id, admin_user_id, nrc_number, old_arrears, new_arrears, movement_type, source
      ) VALUES (
        v_sync_batch_id, v_admin_id, v_nrc, 0, v_arrears, 'Not Found', 'daily_sync'
      );
      
      CONTINUE;
    END IF;
    
    -- Determine movement type
    IF v_arrears = 0 AND v_old_arrears > 0 THEN
      v_movement_type := 'Cleared';
      v_arrears_change := -v_old_arrears;
    ELSIF v_arrears < v_old_arrears THEN
      v_movement_type := 'Reduced';
      v_arrears_change := v_arrears - v_old_arrears;
    ELSIF v_arrears > v_old_arrears THEN
      v_movement_type := 'Increased';
      v_arrears_change := v_arrears - v_old_arrears;
    ELSE
      v_movement_type := 'Maintained';
      v_arrears_change := 0;
    END IF;
    
    -- Update master_customers
    UPDATE master_customers SET
      loan_book_arrears = v_arrears,
      loan_book_last_payment_date = CASE 
        WHEN v_payment_date IS NOT NULL AND v_payment_date != '' 
        THEN v_payment_date::TIMESTAMP WITH TIME ZONE 
        ELSE loan_book_last_payment_date 
      END,
      updated_at = now()
    WHERE id = v_customer_id;
    
    -- Find active ticket for this customer
    SELECT t.id, t.assigned_agent
    INTO v_ticket_id, v_agent_id
    FROM tickets t
    WHERE t.master_customer_id = v_customer_id
      AND t.status != 'Resolved'
    ORDER BY t.created_at DESC
    LIMIT 1;
    
    -- Create payment record if arrears decreased
    IF v_arrears < v_old_arrears THEN
      DECLARE
        v_payment_amount NUMERIC := v_old_arrears - v_arrears;
        v_customer_name TEXT;
      BEGIN
        SELECT name INTO v_customer_name FROM master_customers WHERE id = v_customer_id;
        
        -- Create payment record
        INSERT INTO payments (
          master_customer_id,
          ticket_id,
          amount,
          payment_method,
          customer_name,
          notes,
          recorded_by,
          payment_date
        ) VALUES (
          v_customer_id,
          v_ticket_id,
          v_payment_amount,
          'Loan Book Sync',
          COALESCE(v_customer_name, 'Unknown'),
          'Auto-recorded from Daily Loan Book Sync. Movement: ' || v_movement_type,
          v_admin_id,
          COALESCE(v_payment_date::TIMESTAMP, now())
        );
        
        v_payments_created := v_payments_created + 1;
        
        -- Send notification to agent
        IF v_agent_id IS NOT NULL THEN
          INSERT INTO agent_notifications (
            agent_id,
            title,
            message,
            type,
            related_ticket_id,
            related_customer_id
          ) VALUES (
            v_agent_id,
            CASE WHEN v_movement_type = 'Cleared' THEN 'Account Cleared!' 
                 ELSE 'Payment Received' END,
            CASE WHEN v_movement_type = 'Cleared' 
                 THEN v_customer_name || '''s arrears have been fully cleared (K' || v_payment_amount || '). Review and close ticket.'
                 ELSE v_customer_name || ' made a payment of K' || v_payment_amount || '. Arrears reduced from K' || v_old_arrears || ' to K' || v_arrears || '.'
            END,
            CASE WHEN v_movement_type = 'Cleared' THEN 'resolved' ELSE 'payment' END,
            v_ticket_id,
            v_customer_id
          );
        END IF;
      END;
    END IF;
    
    -- Update ticket if exists
    IF v_ticket_id IS NOT NULL THEN
      IF v_arrears = 0 THEN
        -- Resolve ticket when arrears cleared
        UPDATE tickets SET 
          amount_owed = 0,
          status = 'Resolved',
          resolved_date = now(),
          updated_at = now()
        WHERE id = v_ticket_id;
        v_resolved := v_resolved + 1;
      ELSE
        -- Update ticket amount
        UPDATE tickets SET 
          amount_owed = v_arrears,
          updated_at = now()
        WHERE id = v_ticket_id;
      END IF;
    END IF;
    
    -- Log the sync
    INSERT INTO arrears_sync_logs (
      sync_batch_id,
      admin_user_id,
      nrc_number,
      master_customer_id,
      old_arrears,
      new_arrears,
      movement_type,
      loan_book_payment_date,
      ticket_resolved,
      source
    ) VALUES (
      v_sync_batch_id,
      v_admin_id,
      v_nrc,
      v_customer_id,
      v_old_arrears,
      v_arrears,
      v_movement_type,
      v_payment_date::TIMESTAMP,
      v_arrears = 0,
      'daily_sync'
    );
    
    v_updated := v_updated + 1;
  END LOOP;
  
  -- Create snapshots after sync
  PERFORM create_arrears_snapshots(v_sync_batch_id, 'daily_sync');
  
  RETURN json_build_object(
    'success', true,
    'sync_batch_id', v_sync_batch_id,
    'processed', v_processed,
    'updated', v_updated,
    'not_found', v_not_found,
    'resolved', v_resolved,
    'payments_created', v_payments_created,
    'errors', v_errors
  );
END;
$$;

-- =====================================================
-- UPDATED: Arrears movement analytics with snapshots
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_arrears_movement_analytics(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_agent_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start DATE;
  v_end DATE;
  v_result JSON;
BEGIN
  -- Default to last 7 days if not provided
  v_start := COALESCE(p_start_date, CURRENT_DATE - INTERVAL '7 days');
  v_end := COALESCE(p_end_date, CURRENT_DATE);
  
  SELECT json_build_object(
    'summary', (
      SELECT json_build_object(
        'cleared', COALESCE(SUM(CASE WHEN movement_type = 'Cleared' THEN 1 ELSE 0 END), 0),
        'reduced', COALESCE(SUM(CASE WHEN movement_type = 'Reduced' THEN 1 ELSE 0 END), 0),
        'increased', COALESCE(SUM(CASE WHEN movement_type = 'Increased' THEN 1 ELSE 0 END), 0),
        'maintained', COALESCE(SUM(CASE WHEN movement_type = 'Maintained' THEN 1 ELSE 0 END), 0),
        'total_tickets_resolved', COALESCE(SUM(CASE WHEN ticket_resolved THEN 1 ELSE 0 END), 0),
        'total_change_amount', COALESCE(SUM(new_arrears - old_arrears), 0),
        'total_previous_arrears', COALESCE(SUM(old_arrears), 0),
        'total_current_arrears', COALESCE(SUM(new_arrears), 0)
      )
      FROM arrears_sync_logs
      WHERE created_at::date >= v_start AND created_at::date <= v_end
        AND movement_type != 'Not Found'
        AND (p_agent_id IS NULL OR EXISTS (
          SELECT 1 FROM tickets t 
          WHERE t.master_customer_id = arrears_sync_logs.master_customer_id 
          AND t.assigned_agent = p_agent_id
        ))
    ),
    'by_agent', COALESCE((
      SELECT json_agg(agent_data ORDER BY agent_name)
      FROM (
        SELECT 
          t.assigned_agent as agent_id,
          COALESCE(p.display_name, p.full_name, 'Unassigned') as agent_name,
          COUNT(CASE WHEN asl.movement_type = 'Cleared' THEN 1 END) as cleared,
          COUNT(CASE WHEN asl.movement_type = 'Reduced' THEN 1 END) as reduced,
          COUNT(CASE WHEN asl.movement_type = 'Increased' THEN 1 END) as increased,
          COUNT(CASE WHEN asl.movement_type = 'Maintained' THEN 1 END) as maintained,
          COUNT(CASE WHEN asl.ticket_resolved THEN 1 END) as tickets_resolved,
          COALESCE(SUM(asl.old_arrears - asl.new_arrears), 0) as total_recovered,
          COALESCE(SUM(asl.old_arrears), 0) as previous_arrears_total,
          COALESCE(SUM(asl.new_arrears), 0) as current_arrears_total
        FROM arrears_sync_logs asl
        LEFT JOIN tickets t ON t.master_customer_id = asl.master_customer_id
        LEFT JOIN profiles p ON t.assigned_agent = p.id
        WHERE asl.created_at::date >= v_start AND asl.created_at::date <= v_end
          AND asl.movement_type != 'Not Found'
          AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id)
        GROUP BY t.assigned_agent, p.display_name, p.full_name
      ) agent_data
    ), '[]'::json),
    'by_customer', COALESCE((
      SELECT json_agg(customer_data ORDER BY customer_name)
      FROM (
        SELECT 
          asl.nrc_number,
          mc.name as customer_name,
          t.assigned_agent as agent_id,
          COALESCE(p.display_name, p.full_name, 'Unassigned') as agent_name,
          asl.old_arrears as previous_arrears,
          asl.new_arrears as current_arrears,
          asl.old_arrears - asl.new_arrears as movement_amount,
          asl.movement_type,
          asl.ticket_resolved,
          asl.source,
          asl.created_at as sync_date
        FROM arrears_sync_logs asl
        LEFT JOIN master_customers mc ON mc.id = asl.master_customer_id
        LEFT JOIN tickets t ON t.master_customer_id = asl.master_customer_id
        LEFT JOIN profiles p ON t.assigned_agent = p.id
        WHERE asl.created_at::date >= v_start AND asl.created_at::date <= v_end
          AND asl.movement_type != 'Not Found'
          AND (p_agent_id IS NULL OR t.assigned_agent = p_agent_id)
        ORDER BY asl.created_at DESC
        LIMIT 500
      ) customer_data
    ), '[]'::json),
    'recent_syncs', COALESCE((
      SELECT json_agg(sync_data ORDER BY sync_date DESC)
      FROM (
        SELECT 
          sync_batch_id,
          MIN(created_at) as sync_date,
          admin_user_id,
          MAX(source) as source,
          COUNT(*) as records_processed,
          COUNT(CASE WHEN movement_type = 'Cleared' THEN 1 END) as cleared_count,
          COUNT(CASE WHEN movement_type = 'Reduced' THEN 1 END) as reduced_count,
          COUNT(CASE WHEN movement_type = 'Increased' THEN 1 END) as increased_count,
          COUNT(CASE WHEN movement_type = 'Maintained' THEN 1 END) as maintained_count,
          COUNT(CASE WHEN ticket_resolved THEN 1 END) as tickets_resolved
        FROM arrears_sync_logs
        WHERE created_at::date >= v_start AND created_at::date <= v_end
          AND movement_type != 'Not Found'
        GROUP BY sync_batch_id, admin_user_id
        ORDER BY MIN(created_at) DESC
        LIMIT 20
      ) sync_data
    ), '[]'::json),
    'agent_snapshots', COALESCE((
      -- Get start and end snapshots for date range comparison
      SELECT json_agg(snapshot_data)
      FROM (
        SELECT 
          agent_id,
          COALESCE(p.display_name, p.full_name, 'Unknown') as agent_name,
          -- Start of period arrears (closest snapshot to start date)
          (SELECT agent_total_arrears FROM arrears_snapshots s2 
           WHERE s2.agent_id = s.agent_id AND s2.snapshot_date::date <= v_start
           ORDER BY s2.snapshot_date DESC LIMIT 1) as start_arrears,
          -- End of period arrears (latest snapshot up to end date)
          (SELECT agent_total_arrears FROM arrears_snapshots s3 
           WHERE s3.agent_id = s.agent_id AND s3.snapshot_date::date <= v_end
           ORDER BY s3.snapshot_date DESC LIMIT 1) as end_arrears
        FROM arrears_snapshots s
        LEFT JOIN profiles p ON s.agent_id = p.id
        WHERE s.agent_id IS NOT NULL
          AND (p_agent_id IS NULL OR s.agent_id = p_agent_id)
        GROUP BY s.agent_id, p.display_name, p.full_name
      ) snapshot_data
    ), '[]'::json),
    'date_range', json_build_object(
      'start', v_start,
      'end', v_end
    )
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;