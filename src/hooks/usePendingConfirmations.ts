import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface PendingConfirmationTicket {
  id: string;
  customer_name: string;
  nrc_number: string;
  amount_owed: number;
  status: string;
  arrears_cleared_pending_confirmation: boolean;
  assigned_agent: string | null;
  agent_name: string | null;
  previous_arrears: number | null;
  created_at: string;
  updated_at: string;
}

// Hook for fetching pending confirmation tickets
export function usePendingConfirmationTickets(agentId?: string) {
  return useQuery({
    queryKey: ['pending_confirmation_tickets', agentId],
    queryFn: async (): Promise<PendingConfirmationTicket[]> => {
      const { data, error } = await supabase.rpc('get_pending_confirmation_tickets', {
        p_agent_id: agentId || null,
      });
      
      if (error) throw error;
      return (data as unknown as PendingConfirmationTicket[]) || [];
    },
    staleTime: 30000,
  });
}

// Hook for confirming ticket resolution
export function useConfirmTicketResolution() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (ticketId: string) => {
      const { data, error } = await supabase.rpc('confirm_ticket_resolution', {
        p_ticket_id: ticketId,
      });
      
      if (error) throw error;
      
      const result = data as { success: boolean; error?: string; customer_name?: string };
      if (!result.success) {
        throw new Error(result.error || 'Failed to confirm resolution');
      }
      
      return result;
    },
    onSuccess: (data) => {
      toast({
        title: "Resolution Confirmed",
        description: `Ticket for ${data.customer_name} has been resolved.`,
      });
      
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['pending_confirmation_tickets'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] });
      queryClient.invalidateQueries({ queryKey: ['agent_notifications'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Confirmation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Hook for reopening a ticket
export function useReopenTicket() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ ticketId, newAmountOwed }: { ticketId: string; newAmountOwed?: number }) => {
      const { data, error } = await supabase.rpc('reopen_ticket', {
        p_ticket_id: ticketId,
        p_new_amount_owed: newAmountOwed || null,
      });
      
      if (error) throw error;
      
      const result = data as { success: boolean; error?: string; customer_name?: string };
      if (!result.success) {
        throw new Error(result.error || 'Failed to reopen ticket');
      }
      
      return result;
    },
    onSuccess: (data) => {
      toast({
        title: "Ticket Reopened",
        description: `Ticket for ${data.customer_name} has been reopened.`,
      });
      
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] });
      queryClient.invalidateQueries({ queryKey: ['pending_confirmation_tickets'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Reopen Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
