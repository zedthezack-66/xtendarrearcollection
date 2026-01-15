import { useState } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useBatches, useProfiles, useTransferClientToBatch } from "@/hooks/useSupabaseData";
import { useToast } from "@/hooks/use-toast";

interface BatchTransferDialogProps {
  ticketId: string;
  currentBatchId: string | null;
  currentAgentId: string | null;
  customerName: string;
  disabled?: boolean;
}

export function BatchTransferDialog({
  ticketId,
  currentBatchId,
  currentAgentId,
  customerName,
  disabled = false,
}: BatchTransferDialogProps) {
  const [open, setOpen] = useState(false);
  const [targetBatchId, setTargetBatchId] = useState<string>("");
  const [targetAgentId, setTargetAgentId] = useState<string>("");
  
  const { data: batches = [] } = useBatches();
  const { data: profiles = [] } = useProfiles();
  const transferClient = useTransferClientToBatch();
  const { toast } = useToast();

  // Filter out current batch from options
  const availableBatches = batches.filter(b => b.id !== currentBatchId);

  const handleTransfer = async () => {
    if (!targetBatchId || !targetAgentId) {
      toast({ 
        title: "Selection required", 
        description: "Please select both a target batch and agent",
        variant: "destructive"
      });
      return;
    }

    try {
      await transferClient.mutateAsync({
        ticketId,
        targetBatchId,
        targetAgentId,
      });
      setOpen(false);
      setTargetBatchId("");
      setTargetAgentId("");
    } catch (error) {
      // Error handled by hook
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className="gap-2"
          disabled={disabled}
        >
          <ArrowRightLeft className="h-4 w-4" />
          Transfer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Transfer Client to Another Batch</DialogTitle>
          <DialogDescription>
            Move <span className="font-semibold">{customerName}</span> to a different batch.
            This will reassign the ticket and recalculate all balances.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="targetBatch">Target Batch</Label>
            <Select value={targetBatchId} onValueChange={setTargetBatchId}>
              <SelectTrigger id="targetBatch">
                <SelectValue placeholder="Select batch" />
              </SelectTrigger>
              <SelectContent>
                {availableBatches.length === 0 ? (
                  <SelectItem value="none" disabled>No other batches available</SelectItem>
                ) : (
                  availableBatches.map(batch => (
                    <SelectItem key={batch.id} value={batch.id}>
                      {batch.name} ({batch.institution_name})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="targetAgent">Assign to Agent</Label>
            <Select value={targetAgentId} onValueChange={setTargetAgentId}>
              <SelectTrigger id="targetAgent">
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map(profile => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {(profile as any).display_name || profile.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleTransfer} 
            disabled={transferClient.isPending || !targetBatchId || !targetAgentId}
          >
            {transferClient.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Transferring...
              </>
            ) : (
              <>
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                Transfer Client
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}