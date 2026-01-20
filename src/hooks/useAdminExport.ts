import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type ExportType = 'tickets' | 'master_customers' | 'batch_customers';
export type ExportFilter = 'all' | 'outstanding' | 'resolved' | 'open' | 'in_progress';

interface ExportParams {
  exportType: ExportType;
  filter?: ExportFilter;
  batchId?: string | null;
  agentId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  workedOnly?: boolean;
}

interface ExportResult {
  success: boolean;
  error?: string;
  export_type?: string;
  filter?: string;
  rows_expected: number;
  rows_exported: number;
  exported_at?: string;
  exported_by?: string;
  data?: any[];
}

export function useAdminExport() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: ExportParams): Promise<ExportResult> => {
      // Call the RPC function with proper parameters
      const { data, error } = await supabase.rpc('get_admin_full_export', {
        p_export_type: params.exportType,
        p_filter: params.filter || 'all',
        p_batch_id: params.batchId || null,
        p_agent_id: params.agentId || null,
        p_start_date: params.startDate || null,
        p_end_date: params.endDate || null,
        p_worked_only: params.workedOnly || false,
      });

      if (error) {
        console.error('Admin export RPC error:', error);
        throw new Error(error.message || 'Export failed');
      }
      
      // Parse the result - it's returned as JSON
      const result = data as unknown as ExportResult;
      
      if (!result || !result.success) {
        throw new Error(result?.error || 'Export failed - no data returned');
      }
      
      // Validate row count matches
      if (result.rows_expected !== result.rows_exported) {
        console.warn(`Export validation warning: expected ${result.rows_expected} rows but got ${result.rows_exported}`);
      }
      
      return result;
    },
    onError: (error: Error) => {
      toast({ 
        title: 'Export Failed', 
        description: error.message, 
        variant: 'destructive' 
      });
    },
  });
}

// Interface for arrears analytics with customer drill-down
export interface ArrearsMovementCustomer {
  nrc_number: string;
  customer_name: string;
  agent_id: string | null;
  agent_name: string;
  previous_arrears: number;
  current_arrears: number;
  movement_amount: number;
  movement_type: string;
  ticket_resolved: boolean;
  sync_date: string;
}

export interface ArrearsMovementAgent {
  agent_id: string | null;
  agent_name: string;
  cleared: number;
  reduced: number;
  increased: number;
  maintained: number;
  tickets_resolved: number;
  total_recovered: number;
  previous_arrears_total: number;
  current_arrears_total: number;
}

export interface ArrearsMovementSummary {
  cleared: number;
  reduced: number;
  increased: number;
  maintained: number;
  total_tickets_resolved: number;
  total_change_amount: number;
  total_previous_arrears: number;
  total_current_arrears: number;
}

export interface RecentSync {
  sync_batch_id: string;
  sync_date: string;
  admin_user_id: string;
  records_processed: number;
  cleared_count: number;
  reduced_count: number;
  increased_count: number;
  maintained_count: number;
}

export interface ArrearsMovementAnalytics {
  summary: ArrearsMovementSummary;
  by_agent: ArrearsMovementAgent[];
  by_customer: ArrearsMovementCustomer[];
  recent_syncs: RecentSync[];
  date_range: {
    start_date: string;
    end_date: string;
  };
}
