import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

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
    mutationFn: async (ticket: TicketInsert) => {
      const { data, error } = await supabase
        .from('tickets')
        .insert(ticket)
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
export async function canTicketBeResolved(ticketId: string): Promise<{ canResolve: boolean; amountOwed: number; totalPaid: number; balance: number }> {
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
    mutationFn: async ({ id, ...updates }: { id: string; skipValidation?: boolean } & Partial<{
      status: string;
      priority: string;
      call_notes: string;
      resolved_date: string | null;
      amount_owed: number;
      mobile_number: string;
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
async function updateTicketStatusFromPayments(ticketId: string | null | undefined, masterCustomerId: string) {
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
  
  let newStatus: string;
  let resolvedDate: string | null = null;
  
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
async function updateMasterCustomerFromPayments(masterCustomerId: string) {
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
  
  let status: string;
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
      
      // Update master customer totals and ticket status
      await updateMasterCustomerFromPayments(payment.master_customer_id);
      await updateTicketStatusFromPayments(payment.ticket_id, payment.master_customer_id);
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
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

// Fetch call logs for multiple tickets (for In Progress tickets on dashboard)
export function useCallLogsForTickets(ticketIds: string[]) {
  return useQuery({
    queryKey: ['call_logs', 'batch', ticketIds],
    queryFn: async () => {
      if (!ticketIds.length) return [];
      
      const { data, error } = await supabase
        .from('call_logs')
        .select('*')
        .in('ticket_id', ticketIds)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: ticketIds.length > 0,
  });
}

export function useCreateCallLog() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (log: CallLogInsert) => {
      const { data, error } = await supabase
        .from('call_logs')
        .insert({
          ...log,
          agent_id: user?.id,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['call_logs'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
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
      // Get ticket details first for cleanup
      const { data: ticket, error: fetchError } = await supabase
        .from('tickets')
        .select('batch_id, master_customer_id')
        .eq('id', ticketId)
        .single();
      
      if (fetchError) throw fetchError;
      
      // HARD DELETE: Delete related payments first
      const { error: paymentsError } = await supabase
        .from('payments')
        .delete()
        .eq('ticket_id', ticketId);
      
      if (paymentsError) throw paymentsError;
      
      // Delete related call_logs
      const { error: callLogsError } = await supabase
        .from('call_logs')
        .delete()
        .eq('ticket_id', ticketId);
      
      if (callLogsError) throw callLogsError;
      
      // Delete the ticket
      const { error } = await supabase
        .from('tickets')
        .delete()
        .eq('id', ticketId);
      
      if (error) throw error;
      
      // Delete related batch_customer
      if (ticket?.batch_id && ticket?.master_customer_id) {
        const { error: batchCustError } = await supabase
          .from('batch_customers')
          .delete()
          .eq('batch_id', ticket.batch_id)
          .eq('master_customer_id', ticket.master_customer_id);
        
        if (batchCustError) {
          console.warn('Could not delete batch_customer:', batchCustError.message);
        }
      }
      
      // HARD DELETE: Delete master_customer (and any remaining payments/call_logs linked to it)
      if (ticket?.master_customer_id) {
        // Delete any remaining payments linked to this master customer
        await supabase
          .from('payments')
          .delete()
          .eq('master_customer_id', ticket.master_customer_id);
        
        // Delete any remaining call_logs linked to this master customer
        await supabase
          .from('call_logs')
          .delete()
          .eq('master_customer_id', ticket.master_customer_id);
        
        // Delete any remaining batch_customers linked to this master customer
        await supabase
          .from('batch_customers')
          .delete()
          .eq('master_customer_id', ticket.master_customer_id);
        
        // Delete any remaining tickets linked to this master customer
        await supabase
          .from('tickets')
          .delete()
          .eq('master_customer_id', ticket.master_customer_id);
        
        // Finally delete the master_customer
        const { error: masterCustError } = await supabase
          .from('master_customers')
          .delete()
          .eq('id', ticket.master_customer_id);
        
        if (masterCustError) {
          console.warn('Could not delete master_customer:', masterCustError.message);
        }
      }
      
      return ticket;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['call_logs'] });
      queryClient.invalidateQueries({ queryKey: ['batch_customers'] });
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      toast({ title: 'Ticket and all related data deleted permanently' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error deleting ticket', description: error.message, variant: 'destructive' });
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
        description: `Deleted ${(data as any)?.deleted_tickets || 0} tickets, ${(data as any)?.deleted_customers || 0} customers`
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