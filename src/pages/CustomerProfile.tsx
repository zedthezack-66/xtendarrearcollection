import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Phone, CreditCard, Ticket, Calendar, User, PlayCircle, CheckCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState, useCallback } from "react";
import { useMasterCustomers, useTickets, usePayments, useBatchCustomers, useBatches, useUpdateMasterCustomer, useUpdateTicket, useProfiles } from "@/hooks/useSupabaseData";
import { useToast } from "@/hooks/use-toast";
import { TicketStatusDropdowns } from "@/components/TicketStatusDropdowns";

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);
const formatDate = (date: string) => new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'Fully Paid': return <Badge className="bg-success/10 text-success border-success/20">Fully Paid</Badge>;
    case 'Partially Paid': return <Badge className="bg-warning/10 text-warning border-warning/20">Partially Paid</Badge>;
    case 'Not Paid': return <Badge variant="destructive">Not Paid</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
};

const getTicketStatusBadge = (status: string) => {
  switch (status) {
    case 'Open': return <Badge className="bg-warning/10 text-warning border-warning/20">Open</Badge>;
    case 'In Progress': return <Badge className="bg-info/10 text-info border-info/20">In Progress</Badge>;
    case 'Resolved': return <Badge className="bg-success/10 text-success border-success/20">Resolved</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
};

export default function CustomerProfile() {
  const { id } = useParams();
  const { toast } = useToast();
  const { data: masterCustomers = [] } = useMasterCustomers();
  const { data: tickets = [] } = useTickets();
  const { data: payments = [] } = usePayments();
  const { data: batchCustomers = [] } = useBatchCustomers();
  const { data: batches = [] } = useBatches();
  const { data: profiles = [] } = useProfiles();
  const updateCustomer = useUpdateMasterCustomer();
  const updateTicket = useUpdateTicket();
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  
  const getAgentName = (agentId: string | null) => {
    if (!agentId) return '-';
    const prof = profiles.find(p => p.id === agentId);
    return prof?.display_name || prof?.full_name || '-';
  };
  
  const customer = masterCustomers.find(c => c.id === id);
  const [callNotes, setCallNotes] = useState(customer?.call_notes || '');
  
  if (!customer) {
    return (
      <div className="space-y-6">
        <Link to="/customers" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to Customers</Link>
        <div className="text-center py-12"><p className="text-muted-foreground">Customer not found</p></div>
      </div>
    );
  }

  const customerTicket = tickets.find(t => t.master_customer_id === customer.id);
  const customerPayments = payments.filter(p => p.master_customer_id === customer.id);
  const customerBatches = batchCustomers
    .filter(bc => bc.master_customer_id === customer.id)
    .map(bc => {
      const batch = batches.find(b => b.id === bc.batch_id);
      return batch ? { ...batch, amount: Number(bc.amount_owed) } : null;
    })
    .filter(Boolean);

  // Compute financial summary from tickets + payments (no stored balances)
  const amountOwed = customerTicket ? Number(customerTicket.amount_owed) : 0;
  const totalPaid = customerPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  const remainingBalance = Math.max(0, amountOwed - totalPaid);
  const ticketStatus = customerTicket?.status || 'No Ticket';

  const handleSaveNotes = async () => {
    try {
      await updateCustomer.mutateAsync({ id: customer.id, call_notes: callNotes });
      toast({ title: "Notes saved successfully" });
    } catch (error: any) {
      toast({ title: "Error saving notes", description: error.message, variant: "destructive" });
    }
  };

  const handleUpdateTicketStatus = async (status: string) => {
    if (!customerTicket) return;
    
    // Block Resolved if balance outstanding
    if (status === 'Resolved' && remainingBalance > 0) {
      setShowBlockedModal(true);
      return;
    }
    
    try {
      await updateTicket.mutateAsync({
        id: customerTicket.id,
        status,
        resolved_date: status === 'Resolved' ? new Date().toISOString() : null,
      });
    } catch (error: any) {
      toast({ title: "Error updating ticket", description: error.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/customers" className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-input bg-background hover:bg-accent"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">{customer.name}</h1>
          <p className="text-muted-foreground">Customer Profile</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link to={`/tickets?customerId=${customer.id}`}><Ticket className="h-4 w-4 mr-2" />View Ticket</Link></Button>
          <Button asChild><Link to={`/payments/new?customerId=${customer.id}`}><CreditCard className="h-4 w-4 mr-2" />Record Payment</Link></Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-lg">Customer Information</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-muted"><User className="h-4 w-4 text-muted-foreground" /></div><div><p className="text-sm text-muted-foreground">NRC Number</p><p className="font-medium font-mono">{customer.nrc_number}</p></div></div>
              <div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-muted"><Phone className="h-4 w-4 text-muted-foreground" /></div><div><p className="text-sm text-muted-foreground">Mobile Number</p><p className="font-medium font-mono">{customer.mobile_number || '-'}</p></div></div>
              <div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-muted"><User className="h-4 w-4 text-muted-foreground" /></div><div><p className="text-sm text-muted-foreground">Assigned Agent</p><p className="font-medium">{getAgentName(customer.assigned_agent)}</p></div></div>
              <div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-muted"><Calendar className="h-4 w-4 text-muted-foreground" /></div><div><p className="text-sm text-muted-foreground">Created Date</p><p className="font-medium">{formatDate(customer.created_at)}</p></div></div>
            </CardContent>
          </Card>

          {/* Static Client Fields - Read-Only for agents, Editable for admins */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Customer Information</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div><p className="text-sm text-muted-foreground">Next of Kin Name</p><p className="font-medium">{(customer as any).next_of_kin_name || '-'}</p></div>
              <div><p className="text-sm text-muted-foreground">Next of Kin Contact</p><p className="font-medium">{(customer as any).next_of_kin_contact || '-'}</p></div>
            </CardContent>
          </Card>

          {/* Employment & Loan Details */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Employment & Loan Details</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div><p className="text-sm text-muted-foreground">Branch Name</p><p className="font-medium">{customer.branch_name || '-'}</p></div>
              <div><p className="text-sm text-muted-foreground">Employer Name</p><p className="font-medium">{customer.employer_name || '-'}</p></div>
              <div><p className="text-sm text-muted-foreground">Employer Subdivision</p><p className="font-medium">{customer.employer_subdivision || '-'}</p></div>
              <div><p className="text-sm text-muted-foreground">Loan Consultant</p><p className="font-medium">{customer.loan_consultant || '-'}</p></div>
              <div><p className="text-sm text-muted-foreground">Tenure</p><p className="font-medium">{customer.tenure || '-'}</p></div>
              <div><p className="text-sm text-muted-foreground">Last Payment Date</p><p className="font-medium">{customer.last_payment_date ? formatDate(customer.last_payment_date) : '-'}</p></div>
              <div><p className="text-sm text-muted-foreground">Workplace Contact</p><p className="font-medium">{(customer as any).workplace_contact || '-'}</p></div>
              <div><p className="text-sm text-muted-foreground">Workplace Destination</p><p className="font-medium">{(customer as any).workplace_destination || '-'}</p></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Call Notes</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Textarea placeholder="Enter notes from customer calls..." value={callNotes} onChange={(e) => setCallNotes(e.target.value)} rows={4} />
              <Button onClick={handleSaveNotes} size="sm" disabled={updateCustomer.isPending}>Save Notes</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Batch History</CardTitle></CardHeader>
            <CardContent>
              {customerBatches.length === 0 ? (
                <p className="text-muted-foreground text-sm">No batch associations</p>
              ) : (
                <div className="space-y-3">
                  {customerBatches.map((batch) => (
                    <div key={batch!.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div><p className="font-medium">{batch!.name}</p><p className="text-sm text-muted-foreground">{batch!.institution_name} • {formatDate(batch!.upload_date)}</p></div>
                      <div className="text-right"><p className="font-semibold text-destructive">{formatCurrency(batch!.amount)}</p></div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Ticket Information</CardTitle></CardHeader>
            <CardContent>
              {customerTicket ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                    <div><p className="font-medium">Ticket #{customerTicket.id.slice(0, 8)}</p><p className="text-sm text-muted-foreground">Created: {formatDate(customerTicket.created_at)}</p></div>
                    <div className="flex items-center gap-2">
                      <Badge variant={customerTicket.priority === 'High' ? 'destructive' : 'secondary'}>{customerTicket.priority}</Badge>
                      {getTicketStatusBadge(customerTicket.status)}
                    </div>
                  </div>
                  
                  {/* Ticket Status Dropdowns - Editable */}
                  <div className="p-4 bg-muted/30 rounded-lg border">
                    <p className="text-sm font-medium mb-3 text-muted-foreground">Interaction Outcomes</p>
                    <TicketStatusDropdowns
                      ticketArrearStatus={(customerTicket as any).ticket_arrear_status}
                      ticketPaymentStatus={(customerTicket as any).ticket_payment_status}
                      employerReasonForArrears={(customerTicket as any).employer_reason_for_arrears}
                      onArrearStatusChange={async (value) => {
                        try {
                          await updateTicket.mutateAsync({ id: customerTicket.id, ticket_arrear_status: value });
                          toast({ title: "Arrear status updated" });
                        } catch (error: any) {
                          toast({ title: "Error", description: error.message, variant: "destructive" });
                        }
                      }}
                      onPaymentStatusChange={async (value) => {
                        try {
                          await updateTicket.mutateAsync({ id: customerTicket.id, ticket_payment_status: value });
                          toast({ title: "Payment status updated" });
                        } catch (error: any) {
                          toast({ title: "Error", description: error.message, variant: "destructive" });
                        }
                      }}
                      onEmployerReasonChange={async (value) => {
                        try {
                          await updateTicket.mutateAsync({ id: customerTicket.id, employer_reason_for_arrears: value });
                          toast({ title: "Employer reason updated" });
                        } catch (error: any) {
                          toast({ title: "Error", description: error.message, variant: "destructive" });
                        }
                      }}
                      isLoading={updateTicket.isPending}
                    />
                  </div>
                  
                  <div className="flex gap-2">
                    {customerTicket.status === 'Open' && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleUpdateTicketStatus('In Progress')}
                        disabled={updateTicket.isPending}
                      >
                        <PlayCircle className="h-4 w-4 mr-2" />
                        Mark In Progress
                      </Button>
                    )}
                    {customerTicket.status !== 'Resolved' && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleUpdateTicketStatus('Resolved')}
                        disabled={updateTicket.isPending || remainingBalance > 0}
                        className={remainingBalance > 0 ? 'opacity-50' : ''}
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Mark Resolved {remainingBalance > 0 && <span className="text-xs text-destructive ml-1">(Blocked)</span>}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No ticket associated</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Payment History</CardTitle></CardHeader>
            <CardContent>
              {customerPayments.length === 0 ? (
                <p className="text-muted-foreground text-sm">No payments recorded</p>
              ) : (
                <div className="space-y-3">
                  {customerPayments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div><p className="font-medium">Payment #{payment.id.slice(0, 8)}</p><p className="text-sm text-muted-foreground">{formatDate(payment.payment_date)} • {payment.payment_method}</p></div>
                      <div className="text-right">
                        <p className="font-semibold text-success">{formatCurrency(Number(payment.amount))}</p>
                        {payment.notes && <p className="text-sm text-muted-foreground">{payment.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-lg">Financial Summary</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Ticket Status</span>{getTicketStatusBadge(ticketStatus)}</div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Amount Owed</span><span className="font-bold text-lg text-destructive">{formatCurrency(amountOwed)}</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Total Paid</span><span className="font-bold text-lg text-success">{formatCurrency(totalPaid)}</span></div>
              <div className="flex items-center justify-between border-t pt-4"><span className="text-muted-foreground">Remaining Balance</span><span className={`font-bold text-lg ${remainingBalance > 0 ? 'text-destructive' : 'text-success'}`}>{formatCurrency(remainingBalance)}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Quick Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start"><Phone className="h-4 w-4 mr-2" />Call Customer</Button>
              <Button variant="outline" className="w-full justify-start" asChild><Link to={`/payments/new?customerId=${customer.id}`}><CreditCard className="h-4 w-4 mr-2" />Record Payment</Link></Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Blocked Resolve Modal */}
      <Dialog open={showBlockedModal} onOpenChange={setShowBlockedModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Cannot Resolve Ticket
            </DialogTitle>
            <DialogDescription>
              Full payment is required to resolve this ticket.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-destructive/10 rounded-lg border border-destructive/20">
            <p className="text-sm text-muted-foreground">Outstanding Balance:</p>
            <p className="text-2xl font-bold text-destructive">
              {formatCurrency(remainingBalance)}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBlockedModal(false)}>
              Close
            </Button>
            <Button asChild>
              <Link to={`/payments/new?customerId=${customer.id}`}>
                Record Payment
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
