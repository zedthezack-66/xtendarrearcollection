 function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

// Types for database operations



















































// Batches hooks
export function useBatches() {
  return useQuery({
    queryKey: ['batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select('*')
        .order('upload_date', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateBatch() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (batch) => {
      const { data, error } = await supabase
        .from('batches')
        .insert({
          ...batch,
          uploaded_by: _optionalChain([user, 'optionalAccess', _ => _.id]),
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      toast({ title: 'Batch created successfully' });
    },
    onError: (error) => {
      toast({ title: 'Error creating batch', description: error.message, variant: 'destructive' });
    },
  });
}

// Master Customers hooks - RLS will filter based on role
export function useMasterCustomers() {
  return useQuery({
    queryKey: ['master_customers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('master_customers')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateMasterCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (customer) => {
      const { data, error } = await supabase
        .from('master_customers')
        .insert(customer)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
    },
  });
}

export function useUpdateMasterCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }) => {
      const { data, error } = await supabase
        .from('master_customers')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
    },
  });
}

// Batch Customers hooks - RLS will filter based on assigned_agent_id
export function useBatchCustomers(batchId) {
  return useQuery({
    queryKey: ['batch_customers', batchId],
    queryFn: async () => {
      let query = supabase.from('batch_customers').select('*');
      
      if (batchId) {
        query = query.eq('batch_id', batchId);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateBatchCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (customer







) => {
      const { data, error } = await supabase
        .from('batch_customers')
        .insert(customer)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch_customers'] });
    },
  });
}

// Tickets hooks - RLS will filter based on assigned_agent
export function useTickets() {
  return useQuery({
    queryKey: ['tickets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ticket) => {
      const { generateLoanId } = await import('@/lib/generateLoanId');
      const ticketWithLoanId = { ...ticket, loan_id: ticket.loan_id || generateLoanId() };
      const { data, error } = await supabase
        .from('tickets')
        .insert(ticketWithLoanId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

// Helper to check if ticket can be resolved based on payments
export async function canTicketBeResolved(ticketId) {
  const { data: ticket } = await supabase
    .from('tickets')
    .select('amount_owed')
    .eq('id', ticketId)
    .single();
  
  const { data: ticketPayments } = await supabase
    .from('payments')
    .select('amount')
    .eq('ticket_id', ticketId);
  
  const amountOwed = ticket ? Number(ticket.amount_owed) : 0;
  const totalPaid = (ticketPayments || []).reduce((sum, p) => sum + Number(p.amount), 0);
  const balance = Math.max(0, amountOwed - totalPaid);
  
  return {
    canResolve: totalPaid >= amountOwed,
    amountOwed,
    totalPaid,
    balance
  };
}

export function useUpdateTicket() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }









) => {
      const { skipValidation, ...cleanUpdates } = updates ;
      
      // Validate status change to Resolved
      if (cleanUpdates.status === 'Resolved' && !skipValidation) {
        const { canResolve, balance } = await canTicketBeResolved(id);
        if (!canResolve) {
          throw new Error(`Cannot resolve ticket. Outstanding balance: K${balance.toLocaleString()}. Full payment required.`);
        }
      }
      
      const { data, error } = await supabase
        .from('tickets')
        .update(cleanUpdates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast({ title: 'Ticket updated successfully' });
    },
    onError: (error) => {
      toast({ title: 'Error updating ticket', description: error.message, variant: 'destructive' });
    },
  });
}

// Payments hooks - RLS will filter based on recorded_by
export function usePayments() {
  return useQuery({
    queryKey: ['payments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .order('payment_date', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });
}

// Helper to compute and update ticket status based on payments
async function updateTicketStatusFromPayments(ticketId, masterCustomerId) {
  if (!ticketId) return;
  
  // Get all payments for this ticket
  const { data: ticketPayments } = await supabase
    .from('payments')
    .select('amount')
    .eq('ticket_id', ticketId);
  
  // Get ticket amount owed
  const { data: ticket } = await supabase
    .from('tickets')
    .select('amount_owed')
    .eq('id', ticketId)
    .single();
  
  if (!ticket) return;
  
  const totalPaid = (ticketPayments || []).reduce((sum, p) => sum + Number(p.amount), 0);
  const amountOwed = Number(ticket.amount_owed);
  
  let newStatus;
  let resolvedDate = null;
  
  if (totalPaid <= 0) {
    newStatus = 'Open';
  } else if (totalPaid >= amountOwed) {
    newStatus = 'Resolved';
    resolvedDate = new Date().toISOString();
  } else {
    newStatus = 'In Progress';
  }
  
  await supabase
    .from('tickets')
    .update({ status: newStatus, resolved_date: resolvedDate })
    .eq('id', ticketId);
}

// Helper to update master customer totals from payments
async function updateMasterCustomerFromPayments(masterCustomerId) {
  // Get all payments for this customer
  const { data: customerPayments } = await supabase
    .from('payments')
    .select('amount')
    .eq('master_customer_id', masterCustomerId);
  
  // Get customer total owed
  const { data: customer } = await supabase
    .from('master_customers')
    .select('total_owed')
    .eq('id', masterCustomerId)
    .single();
  
  if (!customer) return;
  
  const totalPaid = (customerPayments || []).reduce((sum, p) => sum + Number(p.amount), 0);
  const totalOwed = Number(customer.total_owed);
  const outstanding = Math.max(0, totalOwed - totalPaid);
  
  let status;
  if (totalPaid <= 0) {
    status = 'Not Paid';
  } else if (outstanding <= 0) {
    status = 'Fully Paid';
  } else {
    status = 'Partially Paid';
  }
  
  await supabase
    .from('master_customers')
    .update({
      total_paid: totalPaid,
      outstanding_balance: outstanding,
      payment_status: status,
    })
    .eq('id', masterCustomerId);
}

export function useCreatePayment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (payment) => {
      const { data, error } = await supabase
        .from('payments')
        .insert({
          ...payment,
          recorded_by: _optionalChain([user, 'optionalAccess', _2 => _2.id]),
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // Update master customer totals, ticket status, and last_payment_date
      await updateMasterCustomerFromPayments(payment.master_customer_id);
      await updateTicketStatusFromPayments(payment.ticket_id, payment.master_customer_id);
      
      // Update last_payment_date on master_customers
      await supabase
        .from('master_customers')
        .update({ last_payment_date: data.payment_date })
        .eq('id', payment.master_customer_id);
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast({ title: 'Payment recorded successfully' });
    },
    onError: (error) => {
      toast({ title: 'Error recording payment', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdatePayment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }





) => {
      // Get existing payment to know which customer/ticket to update
      const { data: existingPayment, error: fetchError } = await supabase
        .from('payments')
        .select('*')
        .eq('id', id)
        .single();
      
      if (fetchError) throw fetchError;
      
      const { data, error } = await supabase
        .from('payments')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      
      // Recalculate balances
      await updateMasterCustomerFromPayments(existingPayment.master_customer_id);
      await updateTicketStatusFromPayments(existingPayment.ticket_id, existingPayment.master_customer_id);
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast({ title: 'Payment updated successfully' });
    },
    onError: (error) => {
      toast({ title: 'Error updating payment', description: error.message, variant: 'destructive' });
    },
  });
}

// Call Logs hooks
export function useCallLogs(ticketId) {
  return useQuery({
    queryKey: ['call_logs', ticketId],
    queryFn: async () => {
      let query = supabase.from('call_logs').select('*');
      
      if (ticketId) {
        query = query.eq('ticket_id', ticketId);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });
}

// Fetch call logs for multiple tickets (all tickets on dashboard)
export function useCallLogsForTickets(ticketIds) {
  // Use a stable string key - create a sorted COPY to avoid mutating original array
  const ticketIdsKey = ticketIds.length > 0 ? [...ticketIds].sort().join(',') : '';
  
  return useQuery({
    queryKey: ['call_logs', 'dashboard', ticketIdsKey],
    queryFn: async () => {
      if (!ticketIds.length) return [];
      
      const { data, error } = await supabase
        .from('call_logs')
        .select('*')
        .in('ticket_id', ticketIds)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return _nullishCoalesce(data, () => ( []));
    },
    enabled: ticketIds.length > 0,
    staleTime: 0, // Always refetch when invalidated
    refetchOnMount: 'always',
  });
}

export function useCallLogsByCustomer(masterCustomerId) {
  return useQuery({
    queryKey: ['call_logs', 'by-customer', masterCustomerId],
    queryFn: async () => {
      if (!masterCustomerId) return [];

      const { data, error } = await supabase
        .from('call_logs')
        .select('*')
        .eq('master_customer_id', masterCustomerId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return _nullishCoalesce(data, () => ( []));
    },
    enabled: !!masterCustomerId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateCallLog() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (log) => {
      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .select('status')
        .eq('id', log.ticket_id)
        .single();

      if (ticketError) throw ticketError;

      const { data, error } = await supabase
        .from('call_logs')
        .insert({
          ...log,
          agent_id: _optionalChain([user, 'optionalAccess', _3 => _3.id]),
          ticket_status_at_save: _nullishCoalesce(_optionalChain([ticket, 'optionalAccess', _4 => _4.status]), () => ( null)),
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Invalidate all call_logs queries including the dashboard batch query
      queryClient.invalidateQueries({ queryKey: ['call_logs'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      // Force refetch immediately
      queryClient.refetchQueries({ queryKey: ['call_logs'] });
      toast({ title: 'Call logged successfully' });
    },
    onError: (error) => {
      toast({ title: 'Error logging call', description: error.message, variant: 'destructive' });
    },
  });
}

// Profiles hooks
export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name');
      
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }) => {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}

// User Roles hooks
export function useUserRoles() {
  return useQuery({
    queryKey: ['user_roles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('*');
      
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ userId, newRole }) => {
      const { data, error } = await supabase.rpc('update_user_role', {
        p_target_user_id: userId,
        p_new_role: newRole,
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['user_roles'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast({ 
        title: 'Role updated', 
        description: `User role changed from ${data.old_role} to ${data.new_role}` 
      });
    },
    onError: (error) => {
      toast({ title: 'Error updating role', description: error.message, variant: 'destructive' });
    },
  });
}

// Delete hooks
export function useDeletePayment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (paymentId) => {
      // Get payment details first
      const { data: payment, error: fetchError } = await supabase
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();
      
      if (fetchError) throw fetchError;

      // Delete the payment
      const { error } = await supabase
        .from('payments')
        .delete()
        .eq('id', paymentId);
      
      if (error) throw error;

      // Recalculate balances using the helper functions
      if (payment) {
        await updateMasterCustomerFromPayments(payment.master_customer_id);
        await updateTicketStatusFromPayments(payment.ticket_id, payment.master_customer_id);
      }

      return payment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast({ title: 'Payment deleted successfully' });
    },
    onError: (error) => {
      toast({ title: 'Error deleting payment', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeleteTicket() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (ticketId) => {
      // Use server-side RPC for transactional hard delete
      const { data, error } = await supabase.rpc('hard_delete_ticket', {
        p_ticket_id: ticketId
      });
      
      if (error) throw error;
      
      return data 





;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['call_logs'] });
      queryClient.invalidateQueries({ queryKey: ['batch_customers'] });
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      const msg = _optionalChain([data, 'optionalAccess', _5 => _5.master_customer_deleted]) 
        ? 'Ticket and customer fully removed from system' 
        : 'Ticket deleted (customer retained for other batches)';
      toast({ title: msg });
    },
    onError: (error) => {
      toast({ title: 'Error deleting ticket', description: error.message, variant: 'destructive' });
    },
  });
}

// Update an existing call log note
export function useUpdateCallLog() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, notes }) => {
      const { data, error } = await supabase
        .from('call_logs')
        .update({ notes })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['call_logs'] });
      queryClient.refetchQueries({ queryKey: ['call_logs'] });
      toast({ title: 'Note updated' });
    },
    onError: (error) => {
      toast({ title: 'Error updating note', description: error.message, variant: 'destructive' });
    },
  });
}

// Safe batch delete using RPC for chunked deletion
export function useDeleteBatch() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ batchId, archive = false }) => {
      const { data, error } = await supabase.rpc('safe_delete_batch', {
        p_batch_id: batchId,
        p_chunk_size: 500,
        p_archive: archive
      });
      
      if (error) throw error;
      return data 








;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['batch_customers'] });
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['call_logs'] });
      toast({ 
        title: 'Batch deleted successfully',
        description: `Deleted ${_optionalChain([(data ), 'optionalAccess', _6 => _6.deleted_tickets]) || 0} tickets, ${_optionalChain([(data ), 'optionalAccess', _7 => _7.deleted_customers]) || 0} customers`
      });
    },
    onError: (error) => {
      toast({ title: 'Error deleting batch', description: error.message, variant: 'destructive' });
    },
  });
}

// Combined data for dashboard
export function useDashboardStats() {
  const { data: customers } = useMasterCustomers();
  const { data: tickets } = useTickets();
  const { data: payments } = usePayments();
  const { data: profiles } = useProfiles();

  const stats = {
    totalCustomers: _nullishCoalesce(_optionalChain([customers, 'optionalAccess', _8 => _8.length]), () => ( 0)),
    totalOutstanding: _nullishCoalesce(_optionalChain([customers, 'optionalAccess', _9 => _9.reduce, 'call', _10 => _10((sum, c) => sum + Number(c.outstanding_balance), 0)]), () => ( 0)),
    totalCollected: _nullishCoalesce(_optionalChain([payments, 'optionalAccess', _11 => _11.reduce, 'call', _12 => _12((sum, p) => sum + Number(p.amount), 0)]), () => ( 0)),
    openTickets: _nullishCoalesce(_optionalChain([tickets, 'optionalAccess', _13 => _13.filter, 'call', _14 => _14(t => t.status !== 'Resolved'), 'access', _15 => _15.length]), () => ( 0)),
    resolvedTickets: _nullishCoalesce(_optionalChain([tickets, 'optionalAccess', _16 => _16.filter, 'call', _17 => _17(t => t.status === 'Resolved'), 'access', _18 => _18.length]), () => ( 0)),
    collectionsByAgent: _nullishCoalesce(_optionalChain([profiles, 'optionalAccess', _19 => _19.map, 'call', _20 => _20(profile => ({
      agent: profile.full_name,
      amount: _nullishCoalesce(_optionalChain([payments, 'optionalAccess', _21 => _21.filter, 'call', _22 => _22(p => p.recorded_by === profile.id), 'access', _23 => _23.reduce, 'call', _24 => _24((sum, p) => sum + Number(p.amount), 0)]), () => ( 0)),
    }))]), () => ( [])),
    ticketsByStatus: [
      { status: 'Open', count: _nullishCoalesce(_optionalChain([tickets, 'optionalAccess', _25 => _25.filter, 'call', _26 => _26(t => t.status === 'Open'), 'access', _27 => _27.length]), () => ( 0)) },
      { status: 'In Progress', count: _nullishCoalesce(_optionalChain([tickets, 'optionalAccess', _28 => _28.filter, 'call', _29 => _29(t => t.status === 'In Progress'), 'access', _30 => _30.length]), () => ( 0)) },
      { status: 'Resolved', count: _nullishCoalesce(_optionalChain([tickets, 'optionalAccess', _31 => _31.filter, 'call', _32 => _32(t => t.status === 'Resolved'), 'access', _33 => _33.length]), () => ( 0)) },
    ],
    ticketsByPriority: [
      { priority: 'High', count: _nullishCoalesce(_optionalChain([tickets, 'optionalAccess', _34 => _34.filter, 'call', _35 => _35(t => t.priority === 'High'), 'access', _36 => _36.length]), () => ( 0)) },
      { priority: 'Medium', count: _nullishCoalesce(_optionalChain([tickets, 'optionalAccess', _37 => _37.filter, 'call', _38 => _38(t => t.priority === 'Medium'), 'access', _39 => _39.length]), () => ( 0)) },
      { priority: 'Low', count: _nullishCoalesce(_optionalChain([tickets, 'optionalAccess', _40 => _40.filter, 'call', _41 => _41(t => t.priority === 'Low'), 'access', _42 => _42.length]), () => ( 0)) },
    ],
  };

  const collectionRate = stats.totalOutstanding > 0 
    ? (stats.totalCollected / (stats.totalOutstanding + stats.totalCollected)) * 100 
    : 0;

  return {
    ...stats,
    collectionRate,
    isLoading: !customers || !tickets || !payments,
  };
}

// Weekly Report Stats (server-side computed)
export function useWeeklyReportStats(agentId) {
  return useQuery({
    queryKey: ['weekly_report_stats', agentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_weekly_report_stats', {
        p_agent_id: agentId || null,
      });
      
      if (error) throw error;
      return data 








;
    },
  });
}

// Interaction Analytics (call notes + ticket status changes)
export function useInteractionAnalytics(agentId, startDate, endDate) {
  return useQuery({
    queryKey: ['interaction_analytics', agentId, _optionalChain([startDate, 'optionalAccess', _43 => _43.toISOString, 'call', _44 => _44()]), _optionalChain([endDate, 'optionalAccess', _45 => _45.toISOString, 'call', _46 => _46()])],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_interaction_analytics', {
        p_agent_id: agentId || null,
        p_start_date: _optionalChain([startDate, 'optionalAccess', _47 => _47.toISOString, 'call', _48 => _48(), 'access', _49 => _49.split, 'call', _50 => _50('T'), 'access', _51 => _51[0]]) || null,
        p_end_date: _optionalChain([endDate, 'optionalAccess', _52 => _52.toISOString, 'call', _53 => _53(), 'access', _54 => _54.split, 'call', _55 => _55('T'), 'access', _56 => _56[0]]) || null,
      });
      
      if (error) throw error;
      return data 












;
    },
  });
}

// Admin Agent Analytics
export function useAdminAgentAnalytics(agentId) {
  return useQuery({
    queryKey: ['admin_agent_analytics', agentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_admin_agent_analytics', {
        p_agent_id: agentId || null,
      });
      
      if (error) throw error;
      return data 

















;
    },
  });
}

// Admin delete user
export function useAdminDeleteUser() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (userId) => {
      const { data, error } = await supabase.rpc('admin_delete_user', {
        p_user_id: userId,
      });
      
      if (error) throw error;
      return data 







;
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['profiles'] });
        queryClient.invalidateQueries({ queryKey: ['user_roles'] });
        toast({ 
          title: 'User deleted', 
          description: `${data.deleted_user} has been removed from the team` 
        });
      } else if (data.blocked) {
        toast({ 
          title: 'Cannot delete user', 
          description: data.reason,
          variant: 'destructive'
        });
      }
    },
    onError: (error) => {
      toast({ title: 'Error deleting user', description: error.message, variant: 'destructive' });
    },
  });
}

// Tickets with server-side sorting by amount_owed
export function useTicketsSorted(sortOrder = 'high', batchId) {
  return useQuery({
    queryKey: ['tickets_sorted', sortOrder, batchId],
    queryFn: async () => {
      let query = supabase
        .from('tickets')
        .select('*')
        .order('amount_owed', { ascending: sortOrder === 'low' });
      
      if (batchId) {
        query = query.eq('batch_id', batchId);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      return data;
    },
  });
}

// Hook for admin batch transfer - move client between batches
export function useTransferClientToBatch() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      ticketId, 
      targetBatchId, 
      targetAgentId 
    }



) => {
      const { data, error } = await supabase.rpc('transfer_client_to_batch', {
        p_ticket_id: ticketId,
        p_target_batch_id: targetBatchId,
        p_target_agent_id: targetAgentId
      });
      
      if (error) throw error;
      return data 






;
    },
    onSuccess: (data) => {
      // Invalidate ALL affected queries for complete dashboard recalculation
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['tickets_sorted'] });
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['batch_customers'] });
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['call_logs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] });
      queryClient.invalidateQueries({ queryKey: ['collections_by_agent'] });
      queryClient.invalidateQueries({ queryKey: ['recent_tickets'] });
      queryClient.invalidateQueries({ queryKey: ['top_defaulters'] });
      queryClient.invalidateQueries({ queryKey: ['weekly_report_stats'] });
      queryClient.invalidateQueries({ queryKey: ['interaction_analytics'] });
      queryClient.invalidateQueries({ queryKey: ['admin_agent_analytics'] });
      
      toast({ 
        title: 'Client transferred successfully',
        description: data.message
      });
    },
    onError: (error) => {
      toast({ 
        title: 'Transfer failed', 
        description: error.message, 
        variant: 'destructive' 
      });
    },
  });
}

// Hook for admin bulk transfer - transfer multiple clients to a new agent
export function useBulkTransferClients() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      ticketIds, 
      targetAgentId 
    }


) => {
      const { data, error } = await supabase.rpc('bulk_transfer_clients', {
        p_ticket_ids: ticketIds,
        p_target_agent_id: targetAgentId
      });
      
      if (error) throw error;
      return data 






;
    },
    onSuccess: (data) => {
      // Invalidate ALL affected queries for complete dashboard recalculation
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['tickets_sorted'] });
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['batch_customers'] });
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['call_logs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] });
      queryClient.invalidateQueries({ queryKey: ['collections_by_agent'] });
      queryClient.invalidateQueries({ queryKey: ['recent_tickets'] });
      queryClient.invalidateQueries({ queryKey: ['top_defaulters'] });
      queryClient.invalidateQueries({ queryKey: ['weekly_report_stats'] });
      queryClient.invalidateQueries({ queryKey: ['interaction_analytics'] });
      queryClient.invalidateQueries({ queryKey: ['admin_agent_analytics'] });
      
      toast({ 
        title: 'Bulk transfer complete',
        description: `Successfully transferred ${data.transferred_count} of ${data.total_requested} clients`
      });
    },
    onError: (error) => {
      toast({ 
        title: 'Bulk transfer failed', 
        description: error.message, 
        variant: 'destructive' 
      });
    },
  });
}
