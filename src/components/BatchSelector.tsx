import { useState } from "react";
import { useUIStore } from "@/store/useUIStore";
import { useBatches } from "@/hooks/useSupabaseData";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Layers, Loader2, Check, Globe, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

const formatCurrency = (amount: number) => {
  if (amount >= 1000000) return `K${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `K${(amount / 1000).toFixed(0)}K`;
  return `K${amount}`;
};

// Compact picker for the batch every page is filtered by.
export function BatchSelector() {
  const { activeBatchId, setActiveBatch } = useUIStore();
  const { data: batches, isLoading } = useBatches();
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent px-3 py-2.5 text-sm text-sidebar-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading batches...</span>
      </div>
    );
  }

  if (!batches || batches.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-sidebar-border px-3 py-2.5 text-sm text-sidebar-foreground/60">
        <Layers className="h-4 w-4" />
        <span>No batches yet</span>
      </div>
    );
  }

  const active = batches.find((b) => b.id === activeBatchId) ?? null;
  const totalCustomers = batches.reduce((s, b) => s + (b.customer_count || 0), 0);

  const choose = (id: string | null) => {
    setActiveBatch(id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex w-full items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/60 px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          aria-label="Choose batch"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary/15 text-sidebar-primary">
            {active ? <Layers className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-white">{active ? active.name : "All batches"}</p>
            <p className="truncate text-xs text-sidebar-foreground/50">
              {active
                ? `${active.customer_count} customers · ${formatCurrency(Number(active.total_amount))}`
                : `${batches.length} batches · ${totalCustomers.toLocaleString()} customers`}
            </p>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-foreground/40" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" sideOffset={12} className="w-72 p-1.5">
        <p className="eyebrow px-2 pb-1.5 pt-1">Show data for</p>
        <button
          onClick={() => choose(null)}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
            !active && "bg-muted"
          )}
        >
          <Globe className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">All batches</p>
            <p className="text-xs text-muted-foreground">
              {batches.length} batches · {totalCustomers.toLocaleString()} customers
            </p>
          </div>
          {!active && <Check className="h-4 w-4 text-brand" />}
        </button>
        <div className="my-1 border-t" />
        <div className="max-h-80 overflow-y-auto">
          {batches.map((batch) => {
            const isSelected = activeBatchId === batch.id;
            return (
              <button
                key={batch.id}
                onClick={() => choose(batch.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
                  isSelected && "bg-muted"
                )}
              >
                <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{batch.name}</p>
                  <p className="num text-xs text-muted-foreground">
                    {formatDate(batch.upload_date)} · {batch.customer_count} customers · {formatCurrency(Number(batch.total_amount))}
                  </p>
                </div>
                {isSelected && <Check className="h-4 w-4 shrink-0 text-brand" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
