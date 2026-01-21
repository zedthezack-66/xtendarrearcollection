import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface UpdateAmountOwedParams {
  ticketId: string;
  newAmount: number;
  source?: string;
  notes?: string;
}

interface UpdateAmountOwedResult {
  success: boolean;
  old_amount?: number;
  new_amount?: number;
  new_balance?: number;
  new_status?: string;
  message?: string;
}

export function useUpdateAmountOwed() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ ticketId, newAmount, source = 'manual_edit', notes }: UpdateAmountOwedParams) => {
      const { data, error } = await supabase.rpc('update_amount_owed', {
        p_ticket_id: ticketId,
        p_new_amount: newAmount,
        p_source: source,
        p_notes: notes || null,
      });

      if (error) throw error;
      return data as unknown as UpdateAmountOwedResult;
    },
    onSuccess: (data) => {
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['recent-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['top-defaulters'] });
      queryClient.invalidateQueries({ queryKey: ['collections-by-agent'] });

      toast({
        title: "Amount Updated",
        description: `Amount changed from ${formatCurrency(data.old_amount || 0)} to ${formatCurrency(data.new_amount || 0)}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating amount",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 0,
  }).format(amount);
