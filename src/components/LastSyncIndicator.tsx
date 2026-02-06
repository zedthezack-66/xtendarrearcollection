import { RefreshCw } from 'lucide-react';
import { useLastSyncTime, formatSyncTime } from '@/hooks/useLastSyncTime';
import { Skeleton } from '@/components/ui/skeleton';

interface LastSyncIndicatorProps {
  className?: string;
}

export function LastSyncIndicator({ className = '' }: LastSyncIndicatorProps) {
  const { data: syncInfo, isLoading } = useLastSyncTime();

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-xs text-muted-foreground ${className}`}>
        <RefreshCw className="h-3 w-3" />
        <Skeleton className="h-3 w-32" />
      </div>
    );
  }

  const syncTimeText = formatSyncTime(syncInfo?.created_at);

  return (
    <div className={`flex items-center gap-2 text-xs text-muted-foreground ${className}`}>
      <RefreshCw className="h-3 w-3" />
      <span>Last sync: {syncTimeText}</span>
    </div>
  );
}
