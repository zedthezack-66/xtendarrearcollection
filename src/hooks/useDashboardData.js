import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';








































































// Hook for main dashboard stats - server-side calculated
export function useDashboardStats(batchId) {
  return useQuery({
    queryKey: ['dashboard_stats', batchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_dashboard_stats', {
        p_agent_id: null,
        p_batch_id: batchId,
      });
      
      if (error) throw error;
      return data ;
    },
    staleTime: 30000, // 30 seconds
  });
}

// Hook for collections by agent chart - server-side calculated
export function useCollectionsByAgent(batchId) {
  return useQuery({
    queryKey: ['collections_by_agent', batchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_collections_by_agent', {
        p_batch_id: batchId,
      });
      
      if (error) throw error;
      return (data ) || [];
    },
    staleTime: 30000,
  });
}

// Hook for recent tickets - paginated, server-side
export function useRecentTickets(batchId, status, limit = 5) {
  return useQuery({
    queryKey: ['recent_tickets', batchId, status, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_recent_tickets', {
        p_batch_id: batchId,
        p_status: status || null,
        p_limit: Math.min(limit, 500), // Enforce max 500
        p_offset: 0,
      });
      
      if (error) throw error;
      return (data ) || [];
    },
    staleTime: 30000,
  });
}

// Hook for top defaulters - paginated, server-side
export function useTopDefaulters(batchId, limit = 5) {
  return useQuery({
    queryKey: ['top_defaulters', batchId, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_top_defaulters', {
        p_batch_id: batchId,
        p_limit: Math.min(limit, 500), // Enforce max 500
        p_offset: 0,
      });
      
      if (error) throw error;
      return (data ) || [];
    },
    staleTime: 30000,
  });
}

// Hook for arrears movement analytics - admin only
export function useArrearsMovementAnalytics(startDate, endDate, agentId) {
  return useQuery({
    queryKey: ['arrears_movement_analytics', startDate, endDate, agentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_arrears_movement_analytics', {
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_agent_id: agentId || null,
      });
      
      if (error) throw error;
      return data ;
    },
    staleTime: 60000, // 1 minute
  });
}
