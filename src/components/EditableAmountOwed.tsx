import { useState } from "react";
import { Pencil, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateAmountOwed } from "@/hooks/useAmountOwedEdit";

interface EditableAmountOwedProps {
  ticketId: string;
  currentAmount: number;
  canEdit: boolean;
  source?: string;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 0,
  }).format(amount);

export function EditableAmountOwed({ ticketId, currentAmount, canEdit, source = 'manual_edit' }: EditableAmountOwedProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(currentAmount.toString());
  const updateAmount = useUpdateAmountOwed();

  const handleStartEdit = () => {
    setEditValue(currentAmount.toString());
    setIsEditing(true);
  };

  const handleCancel = () => {
    setEditValue(currentAmount.toString());
    setIsEditing(false);
  };

  const handleSave = async () => {
    const newAmount = parseFloat(editValue);
    
    if (isNaN(newAmount) || newAmount < 0) {
      return;
    }

    try {
      await updateAmount.mutateAsync({
        ticketId,
        newAmount,
        source,
      });
      setIsEditing(false);
    } catch {
      // Error handled by hook
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-32 h-8 text-right font-bold"
          min="0"
          step="0.01"
          autoFocus
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={handleSave}
          disabled={updateAmount.isPending}
        >
          {updateAmount.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4 text-success" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={handleCancel}
          disabled={updateAmount.isPending}
        >
          <X className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-bold text-lg text-destructive">
        {formatCurrency(currentAmount)}
      </span>
      {canEdit && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={handleStartEdit}
        >
          <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
        </Button>
      )}
    </div>
  );
}
