import { useState } from "react";
import { ArrowRightLeft, Loader2, Users } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { useProfiles, useBulkTransferClients } from "@/hooks/useSupabaseData";
import { useToast } from "@/hooks/use-toast";

interface BulkTransferDialogProps {
  selectedTicketIds: string[];
  onTransferComplete?: () => void;
  disabled?: boolean;
}

export function BulkTransferDialog({
  selectedTicketIds,
  onTransferComplete,
  disabled = false,
}: BulkTransferDialogProps) {
  const [open, setOpen] = useState(false);
  const [targetAgentId, setTargetAgentId] = useState<string>("");
  
  const { data: profiles = [] } = useProfiles();
  const bulkTransfer = useBulkTransferClients();
  const { toast } = useToast();

  const handleTransfer = async () => {
    if (!targetAgentId) {
      toast({ 
        title: "Agent required", 
        description: "Please select a target agent",
        variant: "destructive"
      });
      return;
    }

    if (selectedTicketIds.length === 0) {
      toast({ 
        title: "No tickets selected", 
        description: "Please select at least one ticket to transfer",
        variant: "destructive"
      });
      return;
    }

    try {
      await bulkTransfer.mutateAsync({
        ticketIds: selectedTicketIds,
        targetAgentId,
      });
      setOpen(false);
      setTargetAgentId("");
      onTransferComplete?.();
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
          disabled={disabled || selectedTicketIds.length === 0}
        >
          <ArrowRightLeft className="h-4 w-4" />
          Bulk Transfer
          {selectedTicketIds.length > 0 && (
            <Badge variant="secondary" className="ml-1">
              {selectedTicketIds.length}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Bulk Transfer Clients
          </DialogTitle>
          <DialogDescription>
            Transfer <span className="font-semibold">{selectedTicketIds.length} client(s)</span> to a different agent.
            This will reassign all selected tickets and update ownership.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
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
          <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
            <p className="font-medium mb-1">What will happen:</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>All {selectedTicketIds.length} tickets will be assigned to the selected agent</li>
              <li>Batch customer records will be updated</li>
              <li>Master customer ownership will be transferred</li>
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleTransfer} 
            disabled={bulkTransfer.isPending || !targetAgentId || selectedTicketIds.length === 0}
          >
            {bulkTransfer.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Transferring...
              </>
            ) : (
              <>
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                Transfer {selectedTicketIds.length} Client(s)
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
