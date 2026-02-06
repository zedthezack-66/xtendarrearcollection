import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Phone, User, Building, Clock, AlertTriangle, CheckCircle, PlayCircle, Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useTickets, usePayments, useCallLogs, useProfiles, useMasterCustomers } from '@/hooks/useSupabaseData';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);
};

const formatDateTime = (date: string) => {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'Open': return <Badge className="bg-warning/10 text-warning border-warning/20">Open</Badge>;
    case 'In Progress': return <Badge className="bg-info/10 text-info border-info/20">In Progress</Badge>;
    case 'Resolved': return <Badge className="bg-success/10 text-success border-success/20">Resolved</Badge>;
    case 'Pending Confirmation': return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 animate-pulse">⚠️ Pending Confirmation</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
};

const getMovementIcon = (type: string) => {
  switch (type) {
    case 'CLEARED': return <CheckCircle className="h-4 w-4 text-success" />;
    case 'REDUCED': return <TrendingDown className="h-4 w-4 text-success" />;
    case 'INCREASED': return <TrendingUp className="h-4 w-4 text-destructive" />;
    case 'REOPENED': return <AlertTriangle className="h-4 w-4 text-warning" />;
    default: return <Minus className="h-4 w-4 text-muted-foreground" />;
  }
};

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const { data: tickets, isLoading: isLoadingTickets } = useTickets();
  const { data: payments = [] } = usePayments();
  const { data: callLogs = [] } = useCallLogs(id);
  const { data: profiles = [] } = useProfiles();
  const { data: masterCustomers = [] } = useMasterCustomers();

  const ticket = tickets?.find(t => t.id === id);
  const masterCustomer = masterCustomers.find(mc => mc.id === ticket?.master_customer_id);

  // Access control: agent can only see their own tickets
  useEffect(() => {
    if (!isLoadingTickets && tickets && id) {
      const foundTicket = tickets.find(t => t.id === id);
      if (!foundTicket) {
        // Ticket not found or not accessible
        navigate('/tickets', { replace: true });
      }
    }
  }, [isLoadingTickets, tickets, id, navigate]);

  if (isLoadingTickets) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <AlertTriangle className="h-12 w-12 text-warning" />
        <h2 className="text-xl font-semibold">Ticket Not Available</h2>
        <p className="text-muted-foreground">This ticket is no longer available or you don't have access to it.</p>
        <Button onClick={() => navigate('/tickets')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Tickets
        </Button>
      </div>
    );
  }

  const ticketPayments = payments.filter(p => p.ticket_id === id);
  const totalPaid = ticketPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  const amountOwed = Number(ticket.amount_owed);
  const balance = Math.max(0, amountOwed - totalPaid);

  const getAgentName = (agentId: string | null) => {
    if (!agentId) return '-';
    const p = profiles.find(p => p.id === agentId);
    return (p as any)?.display_name || p?.full_name || '-';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/tickets')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{ticket.customer_name}</h1>
            {getStatusBadge(ticket.status)}
          </div>
          <p className="text-muted-foreground">NRC: {ticket.nrc_number}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Ticket Details Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Ticket Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Amount Owed</p>
                <p className="text-lg font-bold text-destructive">{formatCurrency(amountOwed)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Paid</p>
                <p className="text-lg font-bold text-success">{formatCurrency(totalPaid)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Outstanding Balance</p>
                <p className="text-lg font-bold">{formatCurrency(balance)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Priority</p>
                <Badge variant={ticket.priority === 'High' ? 'destructive' : 'secondary'}>
                  {ticket.priority}
                </Badge>
              </div>
            </div>
            
            <Separator />
            
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{ticket.mobile_number || 'No phone'}</span>
              </div>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>Agent: {getAgentName(ticket.assigned_agent)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>Created: {formatDateTime(ticket.created_at)}</span>
              </div>
              {masterCustomer?.employer_name && (
                <div className="flex items-center gap-2">
                  <Building className="h-4 w-4 text-muted-foreground" />
                  <span>{masterCustomer.employer_name}</span>
                </div>
              )}
            </div>
            
            {/* Status Dropdowns */}
            {(ticket.ticket_arrear_status || ticket.ticket_payment_status || ticket.employer_reason_for_arrears) && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-sm font-medium">Interaction Status</p>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    {ticket.ticket_arrear_status && (
                      <div>
                        <p className="text-xs text-muted-foreground">Arrear Status</p>
                        <Badge variant="outline">{ticket.ticket_arrear_status}</Badge>
                      </div>
                    )}
                    {ticket.ticket_payment_status && (
                      <div>
                        <p className="text-xs text-muted-foreground">Payment Status</p>
                        <Badge variant="outline">{ticket.ticket_payment_status}</Badge>
                      </div>
                    )}
                    {ticket.employer_reason_for_arrears && (
                      <div>
                        <p className="text-xs text-muted-foreground">Employer Reason</p>
                        <Badge variant="outline">{ticket.employer_reason_for_arrears}</Badge>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Call History Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Call History & Notes</CardTitle>
          </CardHeader>
          <CardContent>
            {callLogs.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No call logs yet</p>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {callLogs.map((log) => (
                  <div key={log.id} className="p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline" className="text-xs">{log.call_outcome}</Badge>
                      <span className="text-xs text-muted-foreground">{formatDateTime(log.created_at)}</span>
                    </div>
                    {log.notes && (
                      <p className="text-sm mt-1">{log.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payments Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          {ticketPayments.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No payments recorded</p>
          ) : (
            <div className="space-y-3">
              {ticketPayments.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div>
                    <p className="font-medium text-success">{formatCurrency(Number(payment.amount))}</p>
                    <p className="text-xs text-muted-foreground">{payment.payment_method}</p>
                    {payment.source === 'loanbook_daily' && (
                      <Badge variant="outline" className="text-xs mt-1">Loan Book Sync</Badge>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm">{formatDateTime(payment.payment_date)}</p>
                    {payment.notes && (
                      <p className="text-xs text-muted-foreground">{payment.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-4">
        <Button variant="outline" asChild>
          <Link to="/tickets">Back to Tickets</Link>
        </Button>
        <Button asChild>
          <Link to={`/payments/new?ticket_id=${ticket.id}`}>Record Payment</Link>
        </Button>
      </div>
    </div>
  );
}
