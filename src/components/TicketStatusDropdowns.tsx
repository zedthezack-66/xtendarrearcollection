import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

// Locked dropdown values - no free text, no renaming
export const ARREAR_STATUS_OPTIONS = [
  "Non-paying – propose for write-off",
  "Non-paying",
  "Paying via DDACC/Counters",
  "Non-paying – salary locked",
  "Pay – partial installments",
  "Settled",
] as const;

export const PAYMENT_STATUS_OPTIONS = [
  "Non-paying",
  "Paying",
  "Partial payment",
  "Settled",
] as const;

export const EMPLOYER_REASON_OPTIONS = [
  "Dismissed",
  "Insufficient affordability",
  "On payroll",
  "Resignation",
  "Retired",
  "Salary Locked",
  "Settled",
  "FID",
] as const;

interface TicketStatusDropdownsProps {
  ticketArrearStatus: string | null;
  ticketPaymentStatus: string | null;
  employerReasonForArrears: string | null;
  onArrearStatusChange: (value: string) => void;
  onPaymentStatusChange: (value: string) => void;
  onEmployerReasonChange: (value: string) => void;
  isLoading?: boolean;
  compact?: boolean;
}

export function TicketStatusDropdowns({
  ticketArrearStatus,
  ticketPaymentStatus,
  employerReasonForArrears,
  onArrearStatusChange,
  onPaymentStatusChange,
  onEmployerReasonChange,
  isLoading = false,
  compact = false,
}: TicketStatusDropdownsProps) {
  const gridClass = compact 
    ? "grid gap-3 grid-cols-1 sm:grid-cols-3" 
    : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className={gridClass}>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Arrear Status</Label>
        <Select
          value={ticketArrearStatus || ""}
          onValueChange={onArrearStatusChange}
          disabled={isLoading}
        >
          <SelectTrigger className={compact ? "h-8 text-xs" : ""}>
            <SelectValue placeholder="Select status..." />
          </SelectTrigger>
          <SelectContent>
            {ARREAR_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option} value={option} className="text-xs">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Payment Status</Label>
        <Select
          value={ticketPaymentStatus || ""}
          onValueChange={onPaymentStatusChange}
          disabled={isLoading}
        >
          <SelectTrigger className={compact ? "h-8 text-xs" : ""}>
            <SelectValue placeholder="Select status..." />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option} value={option} className="text-xs">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Employer Reason for Arrears</Label>
        <Select
          value={employerReasonForArrears || ""}
          onValueChange={onEmployerReasonChange}
          disabled={isLoading}
        >
          <SelectTrigger className={compact ? "h-8 text-xs" : ""}>
            <SelectValue placeholder="Select reason..." />
          </SelectTrigger>
          <SelectContent>
            {EMPLOYER_REASON_OPTIONS.map((option) => (
              <SelectItem key={option} value={option} className="text-xs">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
