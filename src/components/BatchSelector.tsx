import { useAppStore } from "@/store/useAppStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Layers, Calendar, Building2 } from "lucide-react";

const formatDate = (date: Date) => {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 0,
  }).format(amount);
};

export function BatchSelector() {
  const { batches, activeBatchId, setActiveBatch } = useAppStore();

  if (batches.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 bg-muted/50 rounded-lg text-sm text-muted-foreground border border-dashed">
        <Layers className="h-4 w-4" />
        <span>No batches yet - Import CSV to create one</span>
      </div>
    );
  }

  const activeBatch = batches.find(b => b.id === activeBatchId);

  return (
    <div className="space-y-3">
      <Select
        value={activeBatchId || "all"}
        onValueChange={(value) => setActiveBatch(value === "all" ? null : value)}
      >
        <SelectTrigger className="w-full h-auto py-3 bg-background border-2">
          <div className="flex items-center gap-3 w-full min-w-0">
            <div className="flex-shrink-0 h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
              <Layers className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 text-left min-w-0">
              <SelectValue placeholder="Select batch">
                {activeBatch ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold truncate">{activeBatch.name}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {activeBatch.customerCount} customers • {formatCurrency(activeBatch.totalAmount)}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold">All Batches</span>
                    <span className="text-xs text-muted-foreground">
                      Global view • {batches.length} batches
                    </span>
                  </div>
                )}
              </SelectValue>
            </div>
          </div>
        </SelectTrigger>
        <SelectContent className="w-[280px]">
          <SelectItem value="all" className="py-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center">
                <Layers className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold">All Batches (Global View)</span>
                <span className="text-xs text-muted-foreground">
                  {batches.reduce((sum, b) => sum + b.customerCount, 0)} total customers
                </span>
              </div>
            </div>
          </SelectItem>
          
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1">
            Available Batches ({batches.length})
          </div>
          
          {batches.map((batch) => (
            <SelectItem key={batch.id} value={batch.id} className="py-3">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-4 w-4 text-primary" />
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{batch.name}</span>
                    <Badge variant="secondary" className="text-xs flex-shrink-0">
                      {batch.customerCount}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {batch.institutionName}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>{formatDate(batch.uploadDate)}</span>
                    <span className="mx-1">•</span>
                    <span>{formatCurrency(batch.totalAmount)}</span>
                  </div>
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {activeBatch && (
        <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="font-medium text-foreground">{activeBatch.institutionName}</span>
          </div>
          <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(activeBatch.uploadDate)}
            </span>
            <span>{activeBatch.customerCount} customers</span>
            <span className="font-medium text-foreground">{formatCurrency(activeBatch.totalAmount)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
