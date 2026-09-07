 function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useEffect } from 'react';













export function useAgentNotifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['agent_notifications', _optionalChain([user, 'optionalAccess', _ => _.id])],
    queryFn: async () => {
      if (!_optionalChain([user, 'optionalAccess', _2 => _2.id])) return [];
      
      const { data, error } = await supabase
        .from('agent_notifications')
        .select('*')
        .eq('agent_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data ;
    },
    enabled: !!_optionalChain([user, 'optionalAccess', _3 => _3.id]),
    refetchInterval: 30000, // Refetch every 30 seconds as backup
  });

  // Real-time subscription for notifications
  useEffect(() => {
    if (!_optionalChain([user, 'optionalAccess', _4 => _4.id])) return;

    const channel = supabase
      .channel('agent-notifications-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_notifications',
          filter: `agent_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['agent_notifications', user.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [_optionalChain([user, 'optionalAccess', _5 => _5.id]), queryClient]);

  return query;
}

export function useUnreadNotificationCount() {
  const { data: notifications = [] } = useAgentNotifications();
  
  const unreadCount = notifications.filter(n => !n.is_read).length;
  const clearedCount = notifications.filter(n => !n.is_read && n.type === 'arrears_cleared').length;
  const increasedCount = notifications.filter(n => !n.is_read && n.type === 'arrears_increased').length;
  const reducedCount = notifications.filter(n => !n.is_read && n.type === 'arrears_reduced').length;

  return {
    total: unreadCount,
    cleared: clearedCount,
    increased: increasedCount,
    reduced: reducedCount,
  };
}

export function useMarkNotificationRead() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (notificationId) => {
      const { error } = await supabase
        .from('agent_notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent_notifications', _optionalChain([user, 'optionalAccess', _6 => _6.id])] });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!_optionalChain([user, 'optionalAccess', _7 => _7.id])) throw new Error('User not authenticated');
      
      const { error } = await supabase
        .from('agent_notifications')
        .update({ is_read: true })
        .eq('agent_id', user.id)
        .eq('is_read', false);

      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent_notifications', _optionalChain([user, 'optionalAccess', _8 => _8.id])] });
      toast({
        title: 'All notifications marked as read',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
