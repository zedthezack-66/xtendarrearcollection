import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Phone, CreditCard, Ticket, Calendar, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAppStore } from "@/store/useAppStore";
import { PaymentStatus, TicketStatus } from "@/types";
import { useState } from "react";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (date: Date) => {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const getStatusBadge = (status: PaymentStatus) => {
  switch (status) {
    case 'Fully Paid':
      return <Badge className="bg-success/10 text-success border-success/20">Fully Paid</Badge>;
    case 'Partially Paid':
      return <Badge className="bg-warning/10 text-warning border-warning/20">Partially Paid</Badge>;
    case 'Not Paid':
      return <Badge variant="destructive">Not Paid</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

const getTicketStatusBadge = (status: TicketStatus) => {
  switch (status) {
    case 'Open':
      return <Badge className="bg-warning/10 text-warning border-warning/20">Open</Badge>;
    case 'In Progress':
      return <Badge className="bg-info/10 text-info border-info/20">In Progress</Badge>;
    case 'Resolved':
      return <Badge className="bg-success/10 text-success border-success/20">Resolved</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

export default function CustomerProfile() {
  const { id } = useParams();
  const { masterCustomers, tickets, payments, batchCustomers, batches, updateMasterCustomer } = useAppStore();
  
  const customer = masterCustomers.find(c => c.id === id);
  const [callNotes, setCallNotes] = useState(customer?.callNotes || '');
  
  if (!customer) {
    return (
      <div className="space-y-6">
        <Link to="/customers" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to Customers
        </Link>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Customer not found</p>
        </div>
      </div>
    );
  }

  const customerTicket = tickets.find(t => t.masterCustomerId === customer.id);
  const customerPayments = payments.filter(p => p.masterCustomerId === customer.id);
  
  // Get batches this customer appears in
  const customerBatches = batchCustomers
    .filter(bc => bc.masterCustomerId === customer.id)
    .map(bc => {
      const batch = batches.find(b => b.id === bc.batchId);
      return batch ? { ...batch, amount: bc.amountOwed } : null;
    })
    .filter(Boolean);

  const handleSaveNotes = () => {
    updateMasterCustomer(customer.id, { callNotes });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/customers" className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-input bg-background hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">{customer.name}</h1>
          <p className="text-muted-foreground">Customer Profile</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to={`/tickets?customerId=${customer.id}`}>
              <Ticket className="h-4 w-4 mr-2" />
              View Ticket
            </Link>
          </Button>
          <Button asChild>
            <Link to={`/payments/new?customerId=${customer.id}`}>
              <CreditCard className="h-4 w-4 mr-2" />
              Record Payment
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Customer Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">NRC Number</p>
                  <p className="font-medium font-mono">{customer.nrcNumber}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Assigned Agent</p>
                  <p className="font-medium">{customer.assignedAgent}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created Date</p>
                  <p className="font-medium">{formatDate(customer.createdDate)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Last Updated</p>
                  <p className="font-medium">{formatDate(customer.lastUpdated)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Call Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder="Enter notes from customer calls..."
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                rows={4}
              />
              <Button onClick={handleSaveNotes} size="sm">
                Save Notes
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Batch History</CardTitle>
            </CardHeader>
            <CardContent>
              {customerBatches.length === 0 ? (
                <p className="text-muted-foreground text-sm">No batch associations</p>
              ) : (
                <div className="space-y-3">
                  {customerBatches.map((batch) => (
                    <div key={batch!.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{batch!.name}</p>
                        <p className="text-sm text-muted-foreground">{batch!.institutionName} • {formatDate(batch!.uploadDate)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-destructive">{formatCurrency(batch!.amount)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Ticket Information</CardTitle>
            </CardHeader>
            <CardContent>
              {customerTicket ? (
                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="font-medium">Ticket #{customerTicket.id.slice(0, 8)}</p>
                    <p className="text-sm text-muted-foreground">Created: {formatDate(customerTicket.createdDate)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={customerTicket.priority === 'High' ? 'destructive' : 'secondary'}>
                      {customerTicket.priority}
                    </Badge>
                    {getTicketStatusBadge(customerTicket.status)}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No ticket associated</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Payment History</CardTitle>
            </CardHeader>
            <CardContent>
              {customerPayments.length === 0 ? (
                <p className="text-muted-foreground text-sm">No payments recorded</p>
              ) : (
                <div className="space-y-3">
                  {customerPayments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">Payment #{payment.id.slice(0, 8)}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(payment.date)} • {payment.paymentMethod}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-success">{formatCurrency(payment.amount)}</p>
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
            <CardHeader>
              <CardTitle className="text-lg">Financial Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                {getStatusBadge(customer.paymentStatus)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total Owed</span>
                <span className="font-bold text-lg text-destructive">
                  {formatCurrency(customer.totalOwed)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total Paid</span>
                <span className="font-bold text-lg text-success">
                  {formatCurrency(customer.totalPaid)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t pt-4">
                <span className="text-muted-foreground">Outstanding Balance</span>
                <span className={`font-bold text-lg ${customer.outstandingBalance > 0 ? 'text-destructive' : 'text-success'}`}>
                  {formatCurrency(customer.outstandingBalance)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start">
                <Phone className="h-4 w-4 mr-2" />
                Call Customer
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link to={`/payments/new?customerId=${customer.id}`}>
                  <CreditCard className="h-4 w-4 mr-2" />
                  Record Payment
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
