import { useUIStore } from "@/store/useUIStore";
import { useBatches } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Layers, Calendar, Building2, Loader2, Check, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
};

const formatCurrency = (amount: number) => {
  if (amount >= 1000000) return `K ${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `K ${(amount / 1000).toFixed(0)}K`;
  return `K ${amount}`;
};

export function BatchSelector() {
  const { activeBatchId, setActiveBatch } = useUIStore();
  const { data: batches, isLoading } = useBatches();
  const { isAdmin } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading batches...</span>
      </div>
    );
  }

  if (!batches || batches.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 bg-muted/50 rounded-lg text-sm text-muted-foreground border border-dashed">
        <Layers className="h-4 w-4" />
        <span>No batches yet</span>
      </div>
    );
  }

  const isAllSelected = !activeBatchId;

  return (
    <div className="space-y-1">
      {/* All Batches option */}
      <button
        onClick={() => setActiveBatch(null)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150",
          "hover:bg-sidebar-accent/80",
          isAllSelected
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
            : "text-sidebar-foreground/80"
        )}
      >
        <div className={cn(
          "flex-shrink-0 h-7 w-7 rounded-md flex items-center justify-center transition-colors",
          isAllSelected ? "bg-sidebar-primary-foreground/20" : "bg-muted"
        )}>
          <Globe className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">All Batches</span>
          <p className={cn(
            "text-xs truncate",
            isAllSelected ? "text-sidebar-primary-foreground/70" : "text-muted-foreground"
          )}>
            {batches.length} batches • {batches.reduce((s, b) => s + (b.customer_count || 0), 0)} customers
          </p>
        </div>
        {isAllSelected && <Check className="h-4 w-4 flex-shrink-0 opacity-80" />}
      </button>

      {/* Divider */}
      <div className="px-3 py-1">
        <div className="border-t border-sidebar-border" />
      </div>

      {/* Batch list */}
      <ScrollArea className="max-h-[240px]">
        <div className="space-y-0.5">
          {batches.map((batch) => {
            const isSelected = activeBatchId === batch.id;
            return (
              <button
                key={batch.id}
                onClick={() => setActiveBatch(batch.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150",
                  "hover:bg-sidebar-accent/80",
                  isSelected
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-foreground/80"
                )}
              >
                <div className={cn(
                  "flex-shrink-0 h-7 w-7 rounded-md flex items-center justify-center transition-colors",
                  isSelected ? "bg-sidebar-primary-foreground/20" : "bg-primary/10"
                )}>
                  <Building2 className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{batch.name}</span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px] px-1.5 py-0 h-4 flex-shrink-0",
                        isSelected && "bg-sidebar-primary-foreground/20 text-sidebar-primary-foreground border-0"
                      )}
                    >
                      {batch.customer_count}
                    </Badge>
                  </div>
                  <div className={cn(
                    "flex items-center gap-1.5 text-xs truncate",
                    isSelected ? "text-sidebar-primary-foreground/70" : "text-muted-foreground"
                  )}>
                    <span>{formatDate(batch.upload_date)}</span>
                    <span>•</span>
                    <span>{formatCurrency(Number(batch.total_amount))}</span>
                  </div>
                </div>
                {isSelected && <Check className="h-4 w-4 flex-shrink-0 opacity-80" />}
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
