import { Clock, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { usePendingConfirmationTickets, useConfirmTicketResolution } from "@/hooks/usePendingConfirmations";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface PendingConfirmationsWidgetProps {
  agentId?: string;
  isAdmin?: boolean;
}

export function PendingConfirmationsWidget({ agentId, isAdmin }: PendingConfirmationsWidgetProps) {
  const { data: pendingTickets, isLoading } = usePendingConfirmationTickets(isAdmin ? agentId : undefined);
  const confirmResolution = useConfirmTicketResolution();

  if (isLoading) {
    return (
      <Card className="border-warning/30 bg-warning/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5 text-warning" />
            Pending Confirmations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-8 w-24" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!pendingTickets || pendingTickets.length === 0) {
    return null; // Don't show widget if no pending confirmations
  }

  return (
    <Card className="border-warning/30 bg-warning/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Arrears Cleared - Pending Confirmation
          </CardTitle>
          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
            {pendingTickets.length} pending
          </Badge>
        </div>
        <CardDescription>
          These tickets have arrears cleared to K0. Please review and confirm resolution.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {pendingTickets.map((ticket) => (
            <div
              key={ticket.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-card rounded-lg border border-border shadow-sm"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{ticket.customer_name}</p>
                <p className="text-sm text-muted-foreground">{ticket.nrc_number}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-destructive line-through">
                    {formatCurrency(ticket.old_amount || 0)}
                  </span>
                  <span className="text-xs">→</span>
                  <span className="text-xs text-success font-semibold">K0</span>
                </div>
                {ticket.sync_date && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Synced: {formatDate(ticket.sync_date)}
                  </p>
                )}
                {isAdmin && ticket.agent_name && (
                  <p className="text-xs text-muted-foreground">
                    Agent: {ticket.agent_name}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                onClick={() => confirmResolution.mutate(ticket.id)}
                disabled={confirmResolution.isPending}
                className="bg-success hover:bg-success/90 text-success-foreground whitespace-nowrap"
              >
                {confirmResolution.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-1" />
                )}
                Confirm Resolution
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
