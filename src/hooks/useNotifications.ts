import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface AgentNotification {
  id: string;
  agent_id: string;
  title: string;
  message: string;
  type: 'info' | 'payment' | 'resolved' | 'warning';
  is_read: boolean;
  related_ticket_id: string | null;
  related_customer_id: string | null;
  created_at: string;
}

export function useNotifications() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async (): Promise<AgentNotification[]> => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('agent_notifications')
        .select('*')
        .eq('agent_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return (data || []) as AgentNotification[];
    },
    enabled: !!user?.id,
    staleTime: 30000,
    refetchInterval: 60000, // Poll every minute
  });
}

export function useUnreadNotificationCount() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['notifications_unread_count', user?.id],
    queryFn: async (): Promise<number> => {
      if (!user?.id) return 0;
      
      const { count, error } = await supabase
        .from('agent_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', user.id)
        .eq('is_read', false);
      
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user?.id,
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('agent_notifications')
        .update({ is_read: true })
        .eq('id', notificationId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['notifications_unread_count', user?.id] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async () => {
      if (!user?.id) return;
      
      const { error } = await supabase
        .from('agent_notifications')
        .update({ is_read: true })
        .eq('agent_id', user.id)
        .eq('is_read', false);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['notifications_unread_count', user?.id] });
    },
  });
}
