import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface LastSyncInfo {
  sync_batch_id: string;
  created_at: string;
  admin_user_id: string;
}

/**
 * Hook to fetch the last loan book sync timestamp.
 * - Admin: sees last global sync time
 * - Agent: sees last sync time affecting their tickets (via sync logs for their customers)
 */
export function useLastSyncTime() {
  const { user, isAdmin } = useAuth();

  return useQuery({
    queryKey: ['last_sync_time', user?.id, isAdmin],
    queryFn: async (): Promise<LastSyncInfo | null> => {
      if (!user?.id) return null;

      // For all users, get the most recent sync log entry
      // For agents, we could filter by their tickets, but the global sync affects everyone
      // So we show the last global sync time
      const { data, error } = await supabase
        .from('arrears_sync_logs')
        .select('sync_batch_id, created_at, admin_user_id')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
    staleTime: 60000, // 1 minute
  });
}

/**
 * Format the last sync time for display
 */
export function formatSyncTime(timestamp: string | null | undefined): string {
  if (!timestamp) return 'Not yet run';
  
  const date = new Date(timestamp);
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(',', '');
}
