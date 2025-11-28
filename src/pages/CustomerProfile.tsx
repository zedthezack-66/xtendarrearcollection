import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Phone, Mail, Building, CreditCard, Ticket, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockCustomers, mockTickets, mockPayments } from "@/data/mockData";
import { CustomerStatus } from "@/types";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const getStatusBadge = (status: CustomerStatus) => {
  switch (status) {
    case 'active':
      return <Badge className="bg-success/10 text-success border-success/20">Active</Badge>;
    case 'defaulted':
      return <Badge variant="destructive">Defaulted</Badge>;
    case 'paid_off':
      return <Badge variant="secondary">Paid Off</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

export default function CustomerProfile() {
  const { id } = useParams();
  const customer = mockCustomers.find(c => c.id === id);
  
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

  const customerTickets = mockTickets.filter(t => t.customerId === customer.id);
  const customerPayments = mockPayments.filter(p => p.customerId === customer.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/customers" className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-input bg-background hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">
            {customer.title} {customer.name}
          </h1>
          <p className="text-muted-foreground">Customer Profile</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to={`/tickets/new?customerId=${customer.id}`}>
              <Ticket className="h-4 w-4 mr-2" />
              Create Ticket
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
              <CardTitle className="text-lg">Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Phone Number</p>
                  <p className="font-medium">{customer.phoneNumber}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">NRC ID</p>
                  <p className="font-medium font-mono">{customer.nrcId}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <Building className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Employer</p>
                  <p className="font-medium">{customer.employerName}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Added On</p>
                  <p className="font-medium">{formatDate(customer.createdAt)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Tickets</CardTitle>
            </CardHeader>
            <CardContent>
              {customerTickets.length === 0 ? (
                <p className="text-muted-foreground text-sm">No tickets found</p>
              ) : (
                <div className="space-y-3">
                  {customerTickets.slice(0, 5).map((ticket) => (
                    <div key={ticket.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{ticket.reference}</p>
                        <p className="text-sm text-muted-foreground">{formatDate(ticket.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={ticket.priority === 'high' ? 'destructive' : 'secondary'}>
                          {ticket.priority}
                        </Badge>
                        <Badge variant={ticket.status === 'open' ? 'default' : 'outline'}>
                          {ticket.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
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
                  {customerPayments.slice(0, 5).map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{payment.referenceNumber}</p>
                        <p className="text-sm text-muted-foreground">{formatDate(payment.paymentDate)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-success">{formatCurrency(payment.amount)}</p>
                        <p className="text-sm text-muted-foreground capitalize">{payment.paymentMethod.replace('_', ' ')}</p>
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
                {getStatusBadge(customer.status)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Arrear Amount</span>
                <span className={`font-bold text-lg ${customer.arrearAmount > 0 ? 'text-destructive' : 'text-success'}`}>
                  {formatCurrency(customer.arrearAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Payment Method</span>
                <span className="font-medium capitalize">{customer.paymentMethod.replace('_', ' ')}</span>
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
                <Link to={`/tickets/new?customerId=${customer.id}`}>
                  <Ticket className="h-4 w-4 mr-2" />
                  Create Ticket
                </Link>
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
