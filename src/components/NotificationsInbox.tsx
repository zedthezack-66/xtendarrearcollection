import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCircle, AlertTriangle, TrendingUp, TrendingDown, ChevronRight, CheckCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  useAgentNotifications,
  useUnreadNotificationCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  AgentNotification,
} from '@/hooks/useAgentNotifications';
import { formatDistanceToNow } from 'date-fns';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);
};

function NotificationIcon({ type }: { type: string }) {
  switch (type) {
    case 'arrears_cleared':
      return <CheckCircle className="h-5 w-5 text-warning" />;
    case 'arrears_increased':
      return <TrendingUp className="h-5 w-5 text-destructive" />;
    case 'arrears_reduced':
      return <TrendingDown className="h-5 w-5 text-success" />;
    default:
      return <Bell className="h-5 w-5 text-muted-foreground" />;
  }
}

function NotificationBadge({ type }: { type: string }) {
  switch (type) {
    case 'arrears_cleared':
      return <Badge className="bg-warning/10 text-warning border-warning/20">Pending Confirmation</Badge>;
    case 'arrears_increased':
      return <Badge className="bg-destructive/10 text-destructive border-destructive/20">Increased</Badge>;
    case 'arrears_reduced':
      return <Badge className="bg-success/10 text-success border-success/20">Reduced</Badge>;
    default:
      return <Badge variant="outline">Info</Badge>;
  }
}

function NotificationItem({ 
  notification, 
  onMarkRead, 
  onNavigate 
}: { 
  notification: AgentNotification;
  onMarkRead: (id: string) => void;
  onNavigate: (ticketId: string | null) => void;
}) {
  const handleClick = () => {
    if (!notification.is_read) {
      onMarkRead(notification.id);
    }
    if (notification.related_ticket_id) {
      onNavigate(notification.related_ticket_id);
    }
  };

  return (
    <div
      className={`p-3 border-b last:border-b-0 cursor-pointer transition-colors hover:bg-muted/50 ${
        !notification.is_read ? 'bg-primary/5 border-l-2 border-l-primary' : ''
      }`}
      onClick={handleClick}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <NotificationIcon type={notification.type} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <NotificationBadge type={notification.type} />
            {!notification.is_read && (
              <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0 animate-pulse" />
            )}
          </div>
          {/* Unread notifications have bold title */}
          <p className={`text-sm text-foreground truncate ${!notification.is_read ? 'font-bold' : 'font-medium'}`}>
            {notification.title}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {notification.message}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
          </p>
        </div>
        {notification.related_ticket_id && (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
      </div>
    </div>
  );
}

export function NotificationsInbox() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: notifications = [], isLoading } = useAgentNotifications();
  const { total: unreadCount, cleared, increased, reduced } = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const handleNavigate = (ticketId: string | null) => {
    setOpen(false);
    if (ticketId) {
      // Navigate directly to ticket detail page
      navigate(`/tickets/${ticketId}`);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="relative h-9 w-9"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs font-medium flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="end" sideOffset={8}>
        <div className="p-3 border-b flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-sm">Notifications</h4>
            <div className="flex items-center gap-2 mt-1">
              {cleared > 0 && (
                <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/20">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {cleared} Pending
                </Badge>
              )}
              {increased > 0 && (
                <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/20">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  {increased}
                </Badge>
              )}
              {reduced > 0 && (
                <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/20">
                  <TrendingDown className="h-3 w-3 mr-1" />
                  {reduced}
                </Badge>
              )}
            </div>
          </div>
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-xs h-7"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              {markAllRead.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <CheckCheck className="h-3 w-3 mr-1" />
              )}
              Mark all read
            </Button>
          )}
        </div>
        
        <ScrollArea className="h-[400px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bell className="h-10 w-10 mb-2 opacity-50" />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkRead={(id) => markRead.mutate(id)}
                onNavigate={handleNavigate}
              />
            ))
          )}
        </ScrollArea>
        
        {notifications.length > 0 && (
          <>
            <Separator />
            <div className="p-2">
              <Button 
                variant="ghost" 
                className="w-full text-xs h-8 text-muted-foreground"
                onClick={() => {
                  setOpen(false);
                  navigate('/tickets?status=Pending+Confirmation');
                }}
              >
                View all pending confirmations
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
