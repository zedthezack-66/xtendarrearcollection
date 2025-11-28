import { Users, AlertTriangle, DollarSign, Ticket, CreditCard, CheckCircle } from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mockDashboardStats, mockTickets, mockCustomers } from "@/data/mockData";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 0,
  }).format(amount);
};

export default function Dashboard() {
  const openTickets = mockTickets.filter(t => t.status === 'open' || t.status === 'in_progress');
  const topDefaulters = mockCustomers
    .filter(c => c.status === 'defaulted')
    .sort((a, b) => b.arrearAmount - a.arrearAmount)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your loan collections</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Customers"
          value={mockDashboardStats.totalCustomers}
          icon={Users}
          variant="default"
        />
        <StatCard
          title="Defaulted Customers"
          value={mockDashboardStats.totalDefaulted}
          icon={AlertTriangle}
          variant="destructive"
        />
        <StatCard
          title="Total Arrears Outstanding"
          value={formatCurrency(mockDashboardStats.totalArrearsOutstanding)}
          icon={DollarSign}
          variant="warning"
        />
        <StatCard
          title="Open Tickets"
          value={mockDashboardStats.openTickets}
          icon={Ticket}
          variant="default"
        />
        <StatCard
          title="Payments This Month"
          value={formatCurrency(mockDashboardStats.paymentsThisMonth)}
          icon={CreditCard}
          variant="success"
        />
        <StatCard
          title="Tickets Resolved This Week"
          value={mockDashboardStats.ticketsResolvedThisWeek}
          icon={CheckCircle}
          variant="success"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Open Tickets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {openTickets.length === 0 ? (
                <p className="text-muted-foreground text-sm">No open tickets</p>
              ) : (
                openTickets.slice(0, 5).map((ticket) => (
                  <div key={ticket.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div>
                      <p className="font-medium text-foreground">{ticket.customerName}</p>
                      <p className="text-sm text-muted-foreground">{ticket.reference}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={ticket.priority === 'high' ? 'destructive' : ticket.priority === 'medium' ? 'secondary' : 'outline'}>
                        {ticket.priority}
                      </Badge>
                      <Badge variant={ticket.status === 'open' ? 'default' : 'secondary'}>
                        {ticket.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top Defaulters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topDefaulters.length === 0 ? (
                <p className="text-muted-foreground text-sm">No defaulters</p>
              ) : (
                topDefaulters.map((customer, index) => (
                  <div key={customer.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10 text-destructive font-semibold text-sm">
                        {index + 1}
                      </span>
                      <div>
                        <p className="font-medium text-foreground">{customer.name}</p>
                        <p className="text-sm text-muted-foreground">{customer.employerName}</p>
                      </div>
                    </div>
                    <p className="font-semibold text-destructive">
                      {formatCurrency(customer.arrearAmount)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
