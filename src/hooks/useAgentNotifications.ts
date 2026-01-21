import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useEffect } from 'react';

export interface AgentNotification {
  id: string;
  agent_id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  related_ticket_id: string | null;
  related_customer_id: string | null;
  created_at: string;
}

export function useAgentNotifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['agent_notifications', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('agent_notifications')
        .select('*')
        .eq('agent_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as AgentNotification[];
    },
    enabled: !!user?.id,
    refetchInterval: 30000, // Refetch every 30 seconds as backup
  });

  // Real-time subscription for notifications
  useEffect(() => {
    if (!user?.id) return;

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
  }, [user?.id, queryClient]);

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
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('agent_notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent_notifications', user?.id] });
    },
    onError: (error: Error) => {
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
      if (!user?.id) throw new Error('User not authenticated');
      
      const { error } = await supabase
        .from('agent_notifications')
        .update({ is_read: true })
        .eq('agent_id', user.id)
        .eq('is_read', false);

      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent_notifications', user?.id] });
      toast({
        title: 'All notifications marked as read',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
