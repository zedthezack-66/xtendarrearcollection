 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';







/**
 * Hook to fetch the last loan book sync timestamp.
 * - Admin: sees last global sync time
 * - Agent: sees last sync time affecting their tickets (via sync logs for their customers)
 */
export function useLastSyncTime() {
  const { user, isAdmin } = useAuth();

  return useQuery({
    queryKey: ['last_sync_time', _optionalChain([user, 'optionalAccess', _ => _.id]), isAdmin],
    queryFn: async () => {
      if (!_optionalChain([user, 'optionalAccess', _2 => _2.id])) return null;

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
    enabled: !!_optionalChain([user, 'optionalAccess', _3 => _3.id]),
    staleTime: 60000, // 1 minute
  });
}

/**
 * Format the last sync time for display
 */
export function formatSyncTime(timestamp) {
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
