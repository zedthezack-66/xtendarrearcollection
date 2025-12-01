import { useAppStore } from "@/store/useAppStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Layers, Calendar } from "lucide-react";

const formatDate = (date: Date) => {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

export function BatchSelector() {
  const { batches, activeBatchId, setActiveBatch } = useAppStore();

  if (batches.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-sm text-muted-foreground">
        <Layers className="h-4 w-4" />
        <span>No batches yet</span>
      </div>
    );
  }

  const activeBatch = batches.find(b => b.id === activeBatchId);

  return (
    <div className="space-y-2">
      <Select
        value={activeBatchId || "all"}
        onValueChange={(value) => setActiveBatch(value === "all" ? null : value)}
      >
        <SelectTrigger className="w-full bg-background">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <SelectValue placeholder="Select batch" />
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            <div className="flex items-center justify-between w-full gap-4">
              <span>All Batches (Global View)</span>
              <Badge variant="outline" className="ml-2">
                {batches.reduce((sum, b) => sum + b.customerCount, 0)} total
              </Badge>
            </div>
          </SelectItem>
          {batches.map((batch) => (
            <SelectItem key={batch.id} value={batch.id}>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{batch.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {batch.customerCount}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{batch.institutionName}</span>
                  <span>•</span>
                  <span>{formatDate(batch.uploadDate)}</span>
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {activeBatch && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <Calendar className="h-3 w-3" />
          <span>Uploaded: {formatDate(activeBatch.uploadDate)}</span>
        </div>
      )}
    </div>
  );
}
