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

export function useUpdateTicket() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<{
      status: string;
      priority: string;
      call_notes: string;
      resolved_date: string | null;
      amount_owed: number;
      mobile_number: string;
    }>) => {
      const { data, error } = await supabase
        .from('tickets')
        .update(updates)
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
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      toast({ title: 'Payment recorded successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error recording payment', description: error.message, variant: 'destructive' });
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

// Delete hooks
export function useDeletePayment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (paymentId: string) => {
      // Get payment details first to update customer balance
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

      // Update customer totals
      if (payment) {
        const { data: customer } = await supabase
          .from('master_customers')
          .select('total_paid, outstanding_balance')
          .eq('id', payment.master_customer_id)
          .single();
        
        if (customer) {
          await supabase
            .from('master_customers')
            .update({
              total_paid: Math.max(0, Number(customer.total_paid) - Number(payment.amount)),
              outstanding_balance: Number(customer.outstanding_balance) + Number(payment.amount),
              payment_status: Number(customer.total_paid) - Number(payment.amount) <= 0 ? 'Not Paid' : 'Partially Paid',
            })
            .eq('id', payment.master_customer_id);
        }
      }

      return payment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
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
      const { error } = await supabase
        .from('tickets')
        .delete()
        .eq('id', ticketId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast({ title: 'Ticket deleted successfully' });
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
    mutationFn: async (batchId: string) => {
      const { data, error } = await supabase.rpc('safe_delete_batch', {
        p_batch_id: batchId,
        p_chunk_size: 500
      });
      
      if (error) throw error;
      return data;
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