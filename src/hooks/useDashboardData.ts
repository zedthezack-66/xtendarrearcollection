import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface DashboardStats {
  total_customers: number;
  total_outstanding: number;
  total_collected: number;
  collection_rate: number;
  open_tickets: number;
  in_progress_tickets: number;
  resolved_tickets: number;
}

interface ArrearsMovementSummary {
  cleared: number;
  reduced: number;
  increased: number;
  maintained: number;
  total_tickets_resolved: number;
  total_change_amount: number;
  total_previous_arrears: number;
  total_current_arrears: number;
}

interface AgentArrearsBreakdown {
  agent_id: string;
  agent_name: string;
  cleared: number;
  reduced: number;
  increased: number;
  maintained: number;
  tickets_resolved: number;
  total_recovered: number;
  previous_arrears_total: number;
  current_arrears_total: number;
  arrears_at_date_a: number;
  arrears_at_date_b: number;
}

interface AgentSnapshot {
  agent_id: string;
  agent_name: string;
  arrears_date_a: number;
  arrears_date_b: number;
  net_movement: number;
  movement_classification: string;
}

interface RecentSync {
  sync_batch_id: string;
  sync_date: string;
  admin_user_id: string;
  records_processed: number;
}

interface ArrearsMovementAnalytics {
  summary: ArrearsMovementSummary;
  by_agent: AgentArrearsBreakdown[];
  agent_snapshots: AgentSnapshot[];
  recent_syncs: RecentSync[];
  date_range: {
    start_date: string;
    end_date: string;
  };
}

interface AgentCollection {
  agent_id: string;
  name: string;
  collected: number;
  tickets: number;
}

interface RecentTicket {
  id: string;
  customer_name: string;
  amount_owed: number;
  status: string;
  priority: string;
  created_at: string;
}

interface TopDefaulter {
  id: string;
  name: string;
  nrc_number: string;
  outstanding_balance: number;
}

// Hook for main dashboard stats - server-side calculated
export function useDashboardStats(batchId: string | null) {
  return useQuery({
    queryKey: ['dashboard_stats', batchId],
    queryFn: async (): Promise<DashboardStats> => {
      const { data, error } = await supabase.rpc('get_dashboard_stats', {
        p_agent_id: null,
        p_batch_id: batchId,
      });
      
      if (error) throw error;
      return data as unknown as DashboardStats;
    },
    staleTime: 30000, // 30 seconds
  });
}

// Hook for collections by agent chart - server-side calculated
export function useCollectionsByAgent(batchId: string | null) {
  return useQuery({
    queryKey: ['collections_by_agent', batchId],
    queryFn: async (): Promise<AgentCollection[]> => {
      const { data, error } = await supabase.rpc('get_collections_by_agent', {
        p_batch_id: batchId,
      });
      
      if (error) throw error;
      return (data as unknown as AgentCollection[]) || [];
    },
    staleTime: 30000,
  });
}

// Hook for recent tickets - paginated, server-side
export function useRecentTickets(batchId: string | null, status?: string, limit = 5) {
  return useQuery({
    queryKey: ['recent_tickets', batchId, status, limit],
    queryFn: async (): Promise<RecentTicket[]> => {
      const { data, error } = await supabase.rpc('get_recent_tickets', {
        p_batch_id: batchId,
        p_status: status || null,
        p_limit: Math.min(limit, 500), // Enforce max 500
        p_offset: 0,
      });
      
      if (error) throw error;
      return (data as unknown as RecentTicket[]) || [];
    },
    staleTime: 30000,
  });
}

// Hook for top defaulters - paginated, server-side
export function useTopDefaulters(batchId: string | null, limit = 5) {
  return useQuery({
    queryKey: ['top_defaulters', batchId, limit],
    queryFn: async (): Promise<TopDefaulter[]> => {
      const { data, error } = await supabase.rpc('get_top_defaulters', {
        p_batch_id: batchId,
        p_limit: Math.min(limit, 500), // Enforce max 500
        p_offset: 0,
      });
      
      if (error) throw error;
      return (data as unknown as TopDefaulter[]) || [];
    },
    staleTime: 30000,
  });
}

// Hook for arrears movement analytics - admin only
export function useArrearsMovementAnalytics(startDate?: string, endDate?: string, agentId?: string) {
  return useQuery({
    queryKey: ['arrears_movement_analytics', startDate, endDate, agentId],
    queryFn: async (): Promise<ArrearsMovementAnalytics> => {
      const { data, error } = await supabase.rpc('get_arrears_movement_analytics', {
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_agent_id: agentId || null,
      });
      
      if (error) throw error;
      return data as unknown as ArrearsMovementAnalytics;
    },
    staleTime: 60000, // 1 minute
  });
}
