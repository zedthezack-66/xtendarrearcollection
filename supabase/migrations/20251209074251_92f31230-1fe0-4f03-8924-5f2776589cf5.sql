-- CLEAR ALL EXISTING DATA (in correct order to respect foreign keys)
TRUNCATE public.call_logs CASCADE;
TRUNCATE public.payments CASCADE;
TRUNCATE public.tickets CASCADE;
TRUNCATE public.batch_customers CASCADE;
TRUNCATE public.batches CASCADE;
TRUNCATE public.master_customers CASCADE;

-- Add display_name to profiles with unique constraint
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS display_name text;

-- Create unique index for display_name (ignoring nulls)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_display_name_unique 
ON public.profiles(display_name) 
WHERE display_name IS NOT NULL;

-- Add batch_id to tickets to link tickets to batches
ALTER TABLE public.tickets 
ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.batches(id) ON DELETE CASCADE;

-- Add assigned_agent_id to batch_customers
ALTER TABLE public.batch_customers 
ADD COLUMN IF NOT EXISTS assigned_agent_id uuid REFERENCES public.profiles(id);

-- Update handle_new_user to make first user admin, others agent
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_count integer;
BEGIN
  -- Insert profile
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  
  -- Check if this is the first user
  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  
  -- First user becomes admin, all others become agent
  IF user_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'agent');
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop existing RLS policies and recreate with proper agent visibility
DROP POLICY IF EXISTS "Agents see assigned customers" ON public.master_customers;
DROP POLICY IF EXISTS "Admins can manage customers" ON public.master_customers;
DROP POLICY IF EXISTS "Agents can create customers" ON public.master_customers;
DROP POLICY IF EXISTS "Agents can update assigned customers" ON public.master_customers;

CREATE POLICY "Admin full access to customers" ON public.master_customers
FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents see assigned customers" ON public.master_customers
FOR SELECT USING (assigned_agent = auth.uid());

CREATE POLICY "Agents can insert customers" ON public.master_customers
FOR INSERT WITH CHECK (true);

CREATE POLICY "Agents can update assigned customers" ON public.master_customers
FOR UPDATE USING (assigned_agent = auth.uid());

-- Tickets RLS - agents only see their assigned tickets
DROP POLICY IF EXISTS "Agents see assigned tickets" ON public.tickets;
DROP POLICY IF EXISTS "Admins can manage tickets" ON public.tickets;
DROP POLICY IF EXISTS "Agents can create tickets" ON public.tickets;
DROP POLICY IF EXISTS "Agents can update assigned tickets" ON public.tickets;
DROP POLICY IF EXISTS "Agents can delete assigned tickets" ON public.tickets;

CREATE POLICY "Admin full access to tickets" ON public.tickets
FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents see assigned tickets" ON public.tickets
FOR SELECT USING (assigned_agent = auth.uid());

CREATE POLICY "Agents can insert tickets" ON public.tickets
FOR INSERT WITH CHECK (true);

CREATE POLICY "Agents can update assigned tickets" ON public.tickets
FOR UPDATE USING (assigned_agent = auth.uid());

CREATE POLICY "Agents can delete assigned tickets" ON public.tickets
FOR DELETE USING (assigned_agent = auth.uid());

-- Batch customers - agents see only their assigned
DROP POLICY IF EXISTS "View batch customers" ON public.batch_customers;
DROP POLICY IF EXISTS "Admins manage batch customers" ON public.batch_customers;
DROP POLICY IF EXISTS "Agents can create batch customers" ON public.batch_customers;
DROP POLICY IF EXISTS "Admins can delete batch_customers" ON public.batch_customers;

CREATE POLICY "Admin full access to batch_customers" ON public.batch_customers
FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents see assigned batch_customers" ON public.batch_customers
FOR SELECT USING (assigned_agent_id = auth.uid());

CREATE POLICY "Agents can insert batch_customers" ON public.batch_customers
FOR INSERT WITH CHECK (true);

-- Payments - agents see only their recorded payments
DROP POLICY IF EXISTS "View relevant payments" ON public.payments;
DROP POLICY IF EXISTS "Admins can manage payments" ON public.payments;
DROP POLICY IF EXISTS "Authenticated users can record payments" ON public.payments;

CREATE POLICY "Admin full access to payments" ON public.payments
FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents see own payments" ON public.payments
FOR SELECT USING (recorded_by = auth.uid());

CREATE POLICY "Agents can insert payments" ON public.payments
FOR INSERT WITH CHECK (true);

-- Call logs - agents see their own
DROP POLICY IF EXISTS "View call logs" ON public.call_logs;
DROP POLICY IF EXISTS "Admins can manage call logs" ON public.call_logs;
DROP POLICY IF EXISTS "Agents can add call logs" ON public.call_logs;

CREATE POLICY "Admin full access to call_logs" ON public.call_logs
FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents see own call_logs" ON public.call_logs
FOR SELECT USING (agent_id = auth.uid());

CREATE POLICY "Agents can insert call_logs" ON public.call_logs
FOR INSERT WITH CHECK (agent_id = auth.uid());

-- Create safe batch delete RPC function (chunked deletion)
CREATE OR REPLACE FUNCTION public.safe_delete_batch(
  p_batch_id uuid,
  p_chunk_size integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted_call_logs integer := 0;
  v_deleted_payments integer := 0;
  v_deleted_tickets integer := 0;
  v_deleted_batch_customers integer := 0;
  v_deleted_master_customers integer := 0;
  v_ticket_ids uuid[];
  v_master_customer_ids uuid[];
  v_chunk_ticket_ids uuid[];
  v_chunk_customer_ids uuid[];
  v_rows_affected integer;
BEGIN
  -- Check if user is admin
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can delete batches';
  END IF;

  -- Get all ticket IDs for this batch
  SELECT ARRAY_AGG(id) INTO v_ticket_ids FROM tickets WHERE batch_id = p_batch_id;
  
  -- Get all master customer IDs for this batch
  SELECT ARRAY_AGG(master_customer_id) INTO v_master_customer_ids 
  FROM batch_customers WHERE batch_id = p_batch_id;

  -- Delete call_logs in chunks
  IF v_ticket_ids IS NOT NULL THEN
    LOOP
      SELECT ARRAY_AGG(id) INTO v_chunk_ticket_ids 
      FROM (SELECT unnest(v_ticket_ids) as id LIMIT p_chunk_size) t;
      
      EXIT WHEN v_chunk_ticket_ids IS NULL OR array_length(v_chunk_ticket_ids, 1) = 0;
      
      DELETE FROM call_logs WHERE ticket_id = ANY(v_chunk_ticket_ids);
      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      v_deleted_call_logs := v_deleted_call_logs + v_rows_affected;
      
      v_ticket_ids := array_remove(v_ticket_ids, v_chunk_ticket_ids[1]);
    END LOOP;
  END IF;

  -- Delete payments in chunks
  SELECT ARRAY_AGG(id) INTO v_ticket_ids FROM tickets WHERE batch_id = p_batch_id;
  IF v_ticket_ids IS NOT NULL THEN
    DELETE FROM payments WHERE ticket_id = ANY(v_ticket_ids);
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    v_deleted_payments := v_deleted_payments + v_rows_affected;
  END IF;

  -- Delete tickets in chunks
  DELETE FROM tickets WHERE batch_id = p_batch_id;
  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  v_deleted_tickets := v_deleted_tickets + v_rows_affected;

  -- Delete batch_customers
  DELETE FROM batch_customers WHERE batch_id = p_batch_id;
  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  v_deleted_batch_customers := v_deleted_batch_customers + v_rows_affected;

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
    'deleted_master_customers', v_deleted_master_customers
  );
END;
$$;

-- Create RPC to clear all data (admin only)
CREATE OR REPLACE FUNCTION public.clear_all_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Check if user is admin
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can clear all data';
  END IF;

  TRUNCATE public.call_logs CASCADE;
  TRUNCATE public.payments CASCADE;
  TRUNCATE public.tickets CASCADE;
  TRUNCATE public.batch_customers CASCADE;
  TRUNCATE public.batches CASCADE;
  TRUNCATE public.master_customers CASCADE;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Enable realtime for tickets and payments
ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;

-- Create dashboard view for stats
CREATE OR REPLACE VIEW public.dashboard_stats AS
SELECT 
  COUNT(DISTINCT mc.id) as total_customers,
  COALESCE(SUM(mc.outstanding_balance), 0) as total_outstanding,
  COALESCE(SUM(mc.total_paid), 0) as total_collected,
  COALESCE(SUM(mc.total_owed), 0) as total_owed,
  (SELECT COUNT(*) FROM tickets WHERE status = 'Open') as open_tickets,
  (SELECT COUNT(*) FROM tickets WHERE status = 'In Progress') as in_progress_tickets,
  (SELECT COUNT(*) FROM tickets WHERE status = 'Resolved') as resolved_tickets
FROM master_customers mc;