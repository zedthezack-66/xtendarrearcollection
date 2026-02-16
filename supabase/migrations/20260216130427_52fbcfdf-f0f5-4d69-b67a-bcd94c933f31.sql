
-- ============================================================
-- FIX: Convert all RESTRICTIVE RLS policies to PERMISSIVE
-- RESTRICTIVE = AND (all must pass) → broken for admin
-- PERMISSIVE = OR (any can pass) → correct role-based access
-- ============================================================

-- ==================== master_customers ====================
DROP POLICY IF EXISTS "Admin full access to customers" ON public.master_customers;
DROP POLICY IF EXISTS "Agents see assigned customers" ON public.master_customers;
DROP POLICY IF EXISTS "Agents can insert customers" ON public.master_customers;
DROP POLICY IF EXISTS "Agents can update assigned customers" ON public.master_customers;

CREATE POLICY "Admin full access to customers" ON public.master_customers FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Agents see assigned customers" ON public.master_customers FOR SELECT USING (assigned_agent = auth.uid());
CREATE POLICY "Agents can insert customers" ON public.master_customers FOR INSERT WITH CHECK (true);
CREATE POLICY "Agents can update assigned customers" ON public.master_customers FOR UPDATE USING (assigned_agent = auth.uid());

-- ==================== tickets ====================
DROP POLICY IF EXISTS "Admin full access to tickets" ON public.tickets;
DROP POLICY IF EXISTS "Agents see assigned tickets" ON public.tickets;
DROP POLICY IF EXISTS "Agents can insert tickets" ON public.tickets;
DROP POLICY IF EXISTS "Agents can update assigned tickets" ON public.tickets;
DROP POLICY IF EXISTS "Agents can delete assigned tickets" ON public.tickets;

CREATE POLICY "Admin full access to tickets" ON public.tickets FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Agents see assigned tickets" ON public.tickets FOR SELECT USING (assigned_agent = auth.uid());
CREATE POLICY "Agents can insert tickets" ON public.tickets FOR INSERT WITH CHECK (true);
CREATE POLICY "Agents can update assigned tickets" ON public.tickets FOR UPDATE USING (assigned_agent = auth.uid());
CREATE POLICY "Agents can delete assigned tickets" ON public.tickets FOR DELETE USING (assigned_agent = auth.uid());

-- ==================== payments ====================
DROP POLICY IF EXISTS "Admin full access to payments" ON public.payments;
DROP POLICY IF EXISTS "Agents see payments on assigned tickets" ON public.payments;
DROP POLICY IF EXISTS "Agents see own payments" ON public.payments;
DROP POLICY IF EXISTS "Agents can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Agents can update own payments" ON public.payments;
DROP POLICY IF EXISTS "Agents can delete own payments" ON public.payments;

CREATE POLICY "Admin full access to payments" ON public.payments FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Agents see payments on assigned tickets" ON public.payments FOR SELECT USING (recorded_by = auth.uid() OR ticket_id IN (SELECT id FROM public.tickets WHERE assigned_agent = auth.uid()));
CREATE POLICY "Agents can insert payments" ON public.payments FOR INSERT WITH CHECK (true);
CREATE POLICY "Agents can update own payments" ON public.payments FOR UPDATE USING (recorded_by = auth.uid());
CREATE POLICY "Agents can delete own payments" ON public.payments FOR DELETE USING (recorded_by = auth.uid());

-- ==================== batch_customers ====================
DROP POLICY IF EXISTS "Admin full access to batch_customers" ON public.batch_customers;
DROP POLICY IF EXISTS "Agents see assigned batch_customers" ON public.batch_customers;
DROP POLICY IF EXISTS "Agents can insert batch_customers" ON public.batch_customers;

CREATE POLICY "Admin full access to batch_customers" ON public.batch_customers FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Agents see assigned batch_customers" ON public.batch_customers FOR SELECT USING (assigned_agent_id = auth.uid());
CREATE POLICY "Agents can insert batch_customers" ON public.batch_customers FOR INSERT WITH CHECK (true);

-- ==================== call_logs ====================
DROP POLICY IF EXISTS "Admin full access to call_logs" ON public.call_logs;
DROP POLICY IF EXISTS "Agents see own call_logs" ON public.call_logs;
DROP POLICY IF EXISTS "Agents can insert call_logs" ON public.call_logs;
DROP POLICY IF EXISTS "Agents can update own call_logs" ON public.call_logs;

CREATE POLICY "Admin full access to call_logs" ON public.call_logs FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Agents see own call_logs" ON public.call_logs FOR SELECT USING (agent_id = auth.uid());
CREATE POLICY "Agents can insert call_logs" ON public.call_logs FOR INSERT WITH CHECK (agent_id = auth.uid());
CREATE POLICY "Agents can update own call_logs" ON public.call_logs FOR UPDATE USING (agent_id = auth.uid()) WITH CHECK (agent_id = auth.uid());

-- ==================== agent_notifications ====================
DROP POLICY IF EXISTS "Admin full access to notifications" ON public.agent_notifications;
DROP POLICY IF EXISTS "Agents see own notifications" ON public.agent_notifications;
DROP POLICY IF EXISTS "Agents can update own notifications" ON public.agent_notifications;

CREATE POLICY "Admin full access to notifications" ON public.agent_notifications FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Agents see own notifications" ON public.agent_notifications FOR SELECT USING (agent_id = auth.uid());
CREATE POLICY "Agents can update own notifications" ON public.agent_notifications FOR UPDATE USING (agent_id = auth.uid());

-- ==================== arrears_sync_logs ====================
DROP POLICY IF EXISTS "Admin full access to arrears_sync_logs" ON public.arrears_sync_logs;
DROP POLICY IF EXISTS "Agents can view sync logs for assigned customers" ON public.arrears_sync_logs;

CREATE POLICY "Admin full access to arrears_sync_logs" ON public.arrears_sync_logs FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Agents can view sync logs for assigned customers" ON public.arrears_sync_logs FOR SELECT USING (master_customer_id IN (SELECT id FROM master_customers WHERE assigned_agent = auth.uid()));

-- ==================== amount_owed_audit_logs ====================
DROP POLICY IF EXISTS "Admin full access to audit logs" ON public.amount_owed_audit_logs;
DROP POLICY IF EXISTS "Agents view own audit logs" ON public.amount_owed_audit_logs;
DROP POLICY IF EXISTS "Agents can insert audit logs" ON public.amount_owed_audit_logs;

CREATE POLICY "Admin full access to audit logs" ON public.amount_owed_audit_logs FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Agents view own audit logs" ON public.amount_owed_audit_logs FOR SELECT USING (ticket_id IN (SELECT id FROM tickets WHERE assigned_agent = auth.uid()));
CREATE POLICY "Agents can insert audit logs" ON public.amount_owed_audit_logs FOR INSERT WITH CHECK (changed_by = auth.uid());

-- ==================== user_roles ====================
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can view own role" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

-- ==================== profiles ====================
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- ==================== batches ====================
DROP POLICY IF EXISTS "Authenticated users can view batches" ON public.batches;
DROP POLICY IF EXISTS "Admins can manage batches" ON public.batches;
DROP POLICY IF EXISTS "Agents can create batches" ON public.batches;
DROP POLICY IF EXISTS "Agents can update batches" ON public.batches;
DROP POLICY IF EXISTS "Admins can delete batches" ON public.batches;

CREATE POLICY "Authenticated users can view batches" ON public.batches FOR SELECT USING (true);
CREATE POLICY "Admins can manage batches" ON public.batches FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Agents can create batches" ON public.batches FOR INSERT WITH CHECK (true);
CREATE POLICY "Agents can update batches" ON public.batches FOR UPDATE USING (true);
