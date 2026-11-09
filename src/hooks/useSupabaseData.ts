import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { reportedTotal } from '@/lib/paymentTotals';
import { fetchAllRows, chunk } from '@/lib/fetchAllRows';

// Types for database operations
export interface BatchInsert {
  name: string;
  institution_name: string;
  customer_count?: number;
  total_amount?: number;
}

export interface MasterCustomerInsert {
  nrc_number: string;
  name: string;
  mobile_number?: string;
  loan_account_number?: string;
  total_owed?: number;
  assigned_agent?: string;
  next_of_kin_name?: string | null;
  next_of_kin_contact?: string | null;
  workplace_contact?: string | null;
  workplace_destination?: string | null;
}

export interface TicketInsert {
  master_customer_id: string;
  batch_id?: string;
  customer_name: string;
  nrc_number: string;
  mobile_number?: string;
  amount_owed?: number;
  priority?: string;
  assigned_agent?: string;
  loan_id?: string;
}

export interface PaymentInsert {
  ticket_id?: string;
  master_customer_id: string;
  customer_name: string;
  amount: number;
  payment_method: string;
  payment_date?: string;
  notes?: string;
}

export interface CallLogInsert {
  ticket_id: string;
  master_customer_id: string;
  call_outcome: string;
  notes?: string;
  promise_to_pay_date?: string;
  promise_to_pay_amount?: number;
}

// Batches hooks
export function useBatches() {
  return useQuery({
    queryKey: ['batches'],
    queryFn: async () => {
      return fetchAllRows((from, to) => supabase
        .from('batches')
        .select('*')
        .order('upload_date', { ascending: false })
        .order('id')
        .range(from, to));
    },
  });
}

export function useCreateBatch() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (batch: BatchInsert) => {
      const { data, error } = await supabase
        .from('batches')
        .insert({
          ...batch,
          uploaded_by: user?.id,
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
    onError: (error: Error) => {
      toast({ title: 'Error creating batch', description: error.message, variant: 'destructive' });
    },
  });
}

// Master Customers hooks - RLS will filter based on role
export function useMasterCustomers() {
  return useQuery({
    queryKey: ['master_customers'],
    queryFn: async () => {
      return fetchAllRows((from, to) => supabase
        .from('master_customers')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to));
    },
  });
}

export function useCreateMasterCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (customer: MasterCustomerInsert) => {
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
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<MasterCustomerInsert & { call_notes?: string }>) => {
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
export function useBatchCustomers(batchId?: string) {
  return useQuery({
    queryKey: ['batch_customers', batchId],
    queryFn: async () => {
      return fetchAllRows((from, to) => {
        let query = supabase.from('batch_customers').select('*');
        if (batchId) {
          query = query.eq('batch_id', batchId);
        }
        return query.order('created_at', { ascending: false }).order('id').range(from, to);
      });
    },
  });
}

export function useCreateBatchCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (customer: {
      batch_id: string;
      master_customer_id: string;
      nrc_number: string;
      name: string;
      mobile_number?: string;
      amount_owed?: number;
      assigned_agent_id?: string;
    }) => {
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
      return fetchAllRows((from, to) => supabase
        .from('tickets')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to));
    },
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ticket: TicketInsert) => {
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

// Helper to check if ticket can be resolved: payments recorded since the last sync must cover amount_owed
export async function canTicketBeResolved(ticketId: string): Promise<{ canResolve: boolean; amountOwed: number; totalPaid: number; balance: number }> {
  const { data: ticket } = await supabase
    .from('tickets')
    .select('amount_owed')
    .eq('id', ticketId)
    .single();

  const { data: ticketPayments } = await supabase
    .from('payments')
    .select('amount, verification_status')
    .eq('ticket_id', ticketId);

  const amountOwed = ticket ? Number(ticket.amount_owed) : 0;
  const totalPaid = reportedTotal(ticketPayments || []);
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
    mutationFn: async ({ id, ...updates }: { id: string; skipValidation?: boolean } & Partial<{
      status: string;
      priority: string;
      call_notes: string;
      resolved_date: string | null;
      amount_owed: number;
      mobile_number: string;
      ticket_arrear_status: string;
      ticket_payment_status: string;
      employer_reason_for_arrears: string;
    }>) => {
      const { skipValidation, ...cleanUpdates } = updates as any;
      
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
    onError: (error: Error) => {
      toast({ title: 'Error updating ticket', description: error.message, variant: 'destructive' });
    },
  });
}

// Payments hooks - RLS will filter based on recorded_by
export function usePayments() {
  return useQuery({
    queryKey: ['payments'],
    queryFn: async () => {
      return fetchAllRows((from, to) => supabase
        .from('payments')
        .select('*')
        .order('payment_date', { ascending: false })
        .order('id')
        .range(from, to));
    },
  });
}

// Balances and ticket status are recalculated by the database when a payment changes;
// these views show them, so refresh them after any payment change.
function invalidatePaymentViews(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of ['payments', 'master_customers', 'tickets', 'tickets_sorted', 'dashboard_stats', 'collections_by_agent', 'weekly_report_stats']) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useCreatePayment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (payment: PaymentInsert) => {
      const { data, error } = await supabase
        .from('payments')
        .insert({
          ...payment,
          recorded_by: user?.id,
        })
        .select()
        .single();
      
      if (error) throw error;

      await supabase
        .from('master_customers')
        .update({ last_payment_date: data.payment_date })
        .eq('id', payment.master_customer_id);

      return data;
    },
    onSuccess: () => {
      invalidatePaymentViews(queryClient);
      toast({ title: 'Payment recorded successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error recording payment', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdatePayment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { 
      id: string; 
      amount?: number; 
      payment_date?: string; 
      notes?: string;
      payment_method?: string;
    }) => {
      const { data, error } = await supabase
        .from('payments')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidatePaymentViews(queryClient);
      toast({ title: 'Payment updated successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error updating payment', description: error.message, variant: 'destructive' });
    },
  });
}

// Call Logs hooks
export function useCallLogs(ticketId?: string) {
  return useQuery({
    queryKey: ['call_logs', ticketId],
    queryFn: async () => {
      return fetchAllRows((from, to) => {
        let query = supabase.from('call_logs').select('*');
        if (ticketId) {
          query = query.eq('ticket_id', ticketId);
        }
        return query.order('created_at', { ascending: false }).order('id').range(from, to);
      });
    },
  });
}

// Fetch call logs for multiple tickets (all tickets on dashboard)
export function useCallLogsForTickets(ticketIds: string[]) {
  // Use a stable string key - create a sorted COPY to avoid mutating original array
  const ticketIdsKey = ticketIds.length > 0 ? [...ticketIds].sort().join(',') : '';
  
  return useQuery({
    queryKey: ['call_logs', 'dashboard', ticketIdsKey],
    queryFn: async () => {
      if (!ticketIds.length) return [];
      
      const pages = await Promise.all(chunk(ticketIds).map((ids) =>
        fetchAllRows((from, to) => supabase
          .from('call_logs')
          .select('*')
          .in('ticket_id', ids)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to))
      ));
      return pages.flat().sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    enabled: ticketIds.length > 0,
    // Reused for 30 seconds between visits; saving a note invalidates it, which refetches straight away.
    staleTime: 30_000,
  });
}

export function useCallLogsByCustomer(masterCustomerId?: string) {
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
      return data ?? [];
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
    mutationFn: async (log: CallLogInsert) => {
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
          agent_id: user?.id,
          ticket_status_at_save: ticket?.status ?? null,
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
    onError: (error: Error) => {
      toast({ title: 'Error logging call', description: error.message, variant: 'destructive' });
    },
  });
}

// Profiles hooks
export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      return fetchAllRows((from, to) => supabase
        .from('profiles')
        .select('*')
        .order('full_name')
        .order('id')
        .range(from, to));
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; full_name?: string; phone?: string | null; display_name?: string }) => {
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
      return fetchAllRows((from, to) => supabase
        .from('user_roles')
        .select('*')
        .order('id')
        .range(from, to));
    },
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: 'admin' | 'agent' }) => {
      const { data, error } = await supabase.rpc('update_user_role', {
        p_target_user_id: userId,
        p_new_role: newRole,
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['user_roles'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast({ 
        title: 'Role updated', 
        description: `User role changed from ${data.old_role} to ${data.new_role}` 
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error updating role', description: error.message, variant: 'destructive' });
    },
  });
}

// Delete hooks
export function useDeletePayment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (paymentId: string) => {
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
      return payment;
    },
    onSuccess: () => {
      invalidatePaymentViews(queryClient);
      toast({ title: 'Payment deleted successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error deleting payment', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeleteTicket() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (ticketId: string) => {
      // Use server-side RPC for transactional hard delete
      const { data, error } = await supabase.rpc('hard_delete_ticket', {
        p_ticket_id: ticketId
      });
      
      if (error) throw error;
      
      return data as {
        success: boolean;
        deleted_call_logs: number;
        detached_call_logs?: number;
        deleted_payments: number;
        master_customer_deleted: boolean;
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['call_logs'] });
      queryClient.invalidateQueries({ queryKey: ['batch_customers'] });
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      const msg = data?.master_customer_deleted 
        ? 'Ticket and customer fully removed from system' 
        : 'Ticket deleted (customer retained for other batches)';
      toast({ title: msg });
    },
    onError: (error: Error) => {
      toast({ title: 'Error deleting ticket', description: error.message, variant: 'destructive' });
    },
  });
}

// Update an existing call log note
export function useUpdateCallLog() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
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
    onError: (error: Error) => {
      toast({ title: 'Error updating note', description: error.message, variant: 'destructive' });
    },
  });
}

// Safe batch delete using RPC for chunked deletion
export function useDeleteBatch() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ batchId, archive = false }: { batchId: string; archive?: boolean }) => {
      const { data, error } = await supabase.rpc('safe_delete_batch', {
        p_batch_id: batchId,
        p_chunk_size: 500,
        p_archive: archive
      });
      
      if (error) throw error;
      return data as {
        success: boolean;
        deleted_call_logs: number;
        detached_call_logs?: number;
        deleted_payments: number;
        deleted_tickets: number;
        deleted_batch_customers: number;
        deleted_master_customers: number;
        archive_data: any | null;
      };
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
        description: `Deleted ${data?.deleted_tickets || 0} tickets, ${data?.deleted_master_customers || 0} customers`
      });
    },
    onError: (error: Error) => {
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
    totalCustomers: customers?.length ?? 0,
    totalOutstanding: customers?.reduce((sum, c) => sum + Number(c.outstanding_balance), 0) ?? 0,
    totalCollected: payments?.reduce((sum, p) => sum + Number(p.amount), 0) ?? 0,
    openTickets: tickets?.filter(t => t.status !== 'Resolved').length ?? 0,
    resolvedTickets: tickets?.filter(t => t.status === 'Resolved').length ?? 0,
    collectionsByAgent: profiles?.map(profile => ({
      agent: profile.full_name,
      amount: payments?.filter(p => p.recorded_by === profile.id).reduce((sum, p) => sum + Number(p.amount), 0) ?? 0,
    })) ?? [],
    ticketsByStatus: [
      { status: 'Open', count: tickets?.filter(t => t.status === 'Open').length ?? 0 },
      { status: 'In Progress', count: tickets?.filter(t => t.status === 'In Progress').length ?? 0 },
      { status: 'Resolved', count: tickets?.filter(t => t.status === 'Resolved').length ?? 0 },
    ],
    ticketsByPriority: [
      { priority: 'High', count: tickets?.filter(t => t.priority === 'High').length ?? 0 },
      { priority: 'Medium', count: tickets?.filter(t => t.priority === 'Medium').length ?? 0 },
      { priority: 'Low', count: tickets?.filter(t => t.priority === 'Low').length ?? 0 },
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
export function useWeeklyReportStats(agentId?: string) {
  return useQuery({
    queryKey: ['weekly_report_stats', agentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_weekly_report_stats', {
        p_agent_id: agentId || null,
      });
      
      if (error) throw error;
      return data as {
        total_tickets: number;
        total_owed: number;
        total_collected: number;
        outstanding_balance: number;
        collection_rate: number;
        open_tickets: number;
        in_progress_tickets: number;
        resolved_tickets: number;
      };
    },
  });
}

// Interaction Analytics (call notes + ticket status changes)
export function useInteractionAnalytics(agentId?: string, startDate?: Date, endDate?: Date) {
  return useQuery({
    queryKey: ['interaction_analytics', agentId, startDate?.toISOString(), endDate?.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_interaction_analytics', {
        p_agent_id: agentId || null,
        p_start_date: startDate?.toISOString().split('T')[0] || null,
        p_end_date: endDate?.toISOString().split('T')[0] || null,
      });
      
      if (error) throw error;
      return data as {
        total_interactions: number;
        total_tickets_resolved: number;
        total_collected: number;
        by_agent: Array<{
          agent_id: string;
          agent_name: string;
          total_calls: number;
          tickets_created: number;
          tickets_resolved: number;
          collected_amount: number;
          total_interactions: number;
        }>;
      };
    },
  });
}

// Admin Agent Analytics
export function useAdminAgentAnalytics(agentId?: string) {
  return useQuery({
    queryKey: ['admin_agent_analytics', agentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_admin_agent_analytics', {
        p_agent_id: agentId || null,
      });
      
      if (error) throw error;
      return data as {
        agents: Array<{
          agent_id: string;
          agent_name: string;
          total_tickets: number;
          total_owed: number;
          total_collected: number;
          outstanding_balance: number;
          collection_rate: number;
          interaction_count: number;
        }>;
        totals: {
          total_tickets: number;
          total_owed: number;
          total_collected: number;
          outstanding_balance: number;
          total_interactions: number;
        };
      };
    },
  });
}

// Admin delete user
export function useAdminDeleteUser() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.rpc('admin_delete_user', {
        p_user_id: userId,
      });
      
      if (error) throw error;
      return data as {
        success: boolean;
        blocked?: boolean;
        reason?: string;
        assigned_tickets?: number;
        assigned_customers?: number;
        deleted_user?: string;
        user_id?: string;
      };
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
    onError: (error: Error) => {
      toast({ title: 'Error deleting user', description: error.message, variant: 'destructive' });
    },
  });
}

// Tickets with server-side sorting by amount_owed
export function useTicketsSorted(sortOrder: 'high' | 'low' = 'high', batchId?: string) {
  return useQuery({
    queryKey: ['tickets_sorted', sortOrder, batchId],
    queryFn: async () => {
      return fetchAllRows((from, to) => {
        let query = supabase.from('tickets').select('*');
        if (batchId) {
          query = query.eq('batch_id', batchId);
        }
        return query.order('amount_owed', { ascending: sortOrder === 'low' }).order('id').range(from, to);
      });
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
    }: { 
      ticketId: string; 
      targetBatchId: string; 
      targetAgentId: string; 
    }) => {
      const { data, error } = await supabase.rpc('transfer_client_to_batch', {
        p_ticket_id: ticketId,
        p_target_batch_id: targetBatchId,
        p_target_agent_id: targetAgentId
      });
      
      if (error) throw error;
      return data as {
        success: boolean;
        message: string;
        ticket_id: string;
        from_batch_id: string;
        to_batch_id: string;
        new_agent_id: string;
      };
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
    onError: (error: Error) => {
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
    }: { 
      ticketIds: string[]; 
      targetAgentId: string; 
    }) => {
      const { data, error } = await supabase.rpc('bulk_transfer_clients', {
        p_ticket_ids: ticketIds,
        p_target_agent_id: targetAgentId
      });
      
      if (error) throw error;
      return data as {
        success: boolean;
        transferred_count: number;
        failed_count: number;
        total_requested: number;
        errors: string[];
        target_agent_id: string;
      };
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
    onError: (error: Error) => {
      toast({ 
        title: 'Bulk transfer failed', 
        description: error.message, 
        variant: 'destructive' 
      });
    },
  });
}
