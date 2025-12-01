import { Users, AlertTriangle, DollarSign, Ticket, TrendingUp, CheckCircle } from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/useAppStore";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 0,
  }).format(amount);
};

const STATUS_COLORS = {
  'Open': 'hsl(38, 92%, 50%)',
  'In Progress': 'hsl(199, 89%, 48%)',
  'Resolved': 'hsl(142, 76%, 36%)',
};

const PRIORITY_COLORS = {
  'High': 'hsl(0, 84%, 60%)',
  'Medium': 'hsl(38, 92%, 50%)',
  'Low': 'hsl(215, 16%, 47%)',
};

export default function Dashboard() {
  const { masterCustomers, tickets, payments, settings, activeBatchId, batchCustomers, batches } = useAppStore();

  // Get customers based on active batch
  const getDisplayCustomers = () => {
    if (!activeBatchId) {
      return masterCustomers;
    }
    const batchCustomerIds = batchCustomers
      .filter(bc => bc.batchId === activeBatchId)
      .map(bc => bc.masterCustomerId);
    return masterCustomers.filter(mc => batchCustomerIds.includes(mc.id));
  };

  const displayCustomers = getDisplayCustomers();
  const activeBatch = batches.find(b => b.id === activeBatchId);

  // Calculate stats
  const totalCustomers = displayCustomers.length;
  const totalOutstanding = displayCustomers.reduce((sum, c) => sum + c.outstandingBalance, 0);
  const totalCollected = displayCustomers.reduce((sum, c) => sum + c.totalPaid, 0);
  const totalOwed = displayCustomers.reduce((sum, c) => sum + c.totalOwed, 0);
  const collectionRate = totalOwed > 0 ? (totalCollected / totalOwed) * 100 : 0;

  // Get relevant tickets
  const displayCustomerIds = displayCustomers.map(c => c.id);
  const relevantTickets = activeBatchId 
    ? tickets.filter(t => displayCustomerIds.includes(t.masterCustomerId))
    : tickets;

  const openTickets = relevantTickets.filter((t) => t.status === 'Open').length;
  const inProgressTickets = relevantTickets.filter((t) => t.status === 'In Progress').length;
  const resolvedTickets = relevantTickets.filter((t) => t.status === 'Resolved').length;

  // Tickets by status for pie chart
  const ticketsByStatus = [
    { name: 'Open', value: openTickets, color: STATUS_COLORS['Open'] },
    { name: 'In Progress', value: inProgressTickets, color: STATUS_COLORS['In Progress'] },
    { name: 'Resolved', value: resolvedTickets, color: STATUS_COLORS['Resolved'] },
  ].filter((d) => d.value > 0);

  // Tickets by priority
  const highPriority = relevantTickets.filter((t) => t.priority === 'High').length;
  const mediumPriority = relevantTickets.filter((t) => t.priority === 'Medium').length;
  const lowPriority = relevantTickets.filter((t) => t.priority === 'Low').length;

  // Collections by agent
  const agent1Name = settings.agent1Name;
  const agent2Name = settings.agent2Name;
  
  const agent1Customers = displayCustomers.filter((c) => c.assignedAgent === agent1Name);
  const agent2Customers = displayCustomers.filter((c) => c.assignedAgent === agent2Name);
  
  const agent1Collections = agent1Customers.reduce((sum, c) => sum + c.totalPaid, 0);
  const agent2Collections = agent2Customers.reduce((sum, c) => sum + c.totalPaid, 0);

  const collectionsByAgent = [
    { name: agent1Name, collected: agent1Collections, tickets: agent1Customers.length },
    { name: agent2Name, collected: agent2Collections, tickets: agent2Customers.length },
  ];

  // Recent open tickets
  const recentOpenTickets = relevantTickets
    .filter((t) => t.status !== 'Resolved')
    .sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime())
    .slice(0, 5);

  // Top defaulters (highest outstanding)
  const topDefaulters = displayCustomers
    .filter((c) => c.paymentStatus !== 'Fully Paid')
    .sort((a, b) => b.outstandingBalance - a.outstandingBalance)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">
          {activeBatch ? `Viewing batch: ${activeBatch.name}` : 'Overview of all loan collections'}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          title="Total Customers"
          value={totalCustomers}
          icon={Users}
          variant="default"
        />
        <StatCard
          title="Total Outstanding"
          value={formatCurrency(totalOutstanding)}
          icon={AlertTriangle}
          variant="destructive"
        />
        <StatCard
          title="Total Collected"
          value={formatCurrency(totalCollected)}
          icon={DollarSign}
          variant="success"
        />
        <StatCard
          title="Collection Rate"
          value={`${collectionRate.toFixed(1)}%`}
          icon={TrendingUp}
          variant="info"
        />
        <StatCard
          title="Open Tickets"
          value={openTickets + inProgressTickets}
          icon={Ticket}
          variant="warning"
        />
        <StatCard
          title="Resolved Tickets"
          value={resolvedTickets}
          icon={CheckCircle}
          variant="success"
        />
      </div>

      {relevantTickets.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Tickets by Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Tickets by Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={ticketsByStatus}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {ticketsByStatus.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Collections by Agent */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Collections by Agent</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={collectionsByAgent}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" className="text-xs" />
                    <YAxis 
                      tickFormatter={(value) => `K${(value / 1000).toFixed(0)}`}
                      className="text-xs"
                    />
                    <Tooltip 
                      formatter={(value: number) => formatCurrency(value)}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '0.5rem',
                      }}
                    />
                    <Bar dataKey="collected" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Open Tickets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentOpenTickets.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-4">No open tickets</p>
              ) : (
                recentOpenTickets.map((ticket) => (
                  <div key={ticket.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div>
                      <p className="font-medium text-foreground">{ticket.customerName}</p>
                      <p className="text-sm text-muted-foreground">{formatCurrency(ticket.amountOwed)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={ticket.priority === 'High' ? 'destructive' : 'secondary'}>
                        {ticket.priority}
                      </Badge>
                      <Badge 
                        className={
                          ticket.status === 'Open' ? 'bg-warning/10 text-warning border-warning/20' :
                          'bg-info/10 text-info border-info/20'
                        }
                      >
                        {ticket.status}
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
                <p className="text-muted-foreground text-sm text-center py-4">No defaulters</p>
              ) : (
                topDefaulters.map((customer, index) => (
                  <div key={customer.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10 text-destructive font-semibold text-sm">
                        {index + 1}
                      </span>
                      <div>
                        <p className="font-medium text-foreground">{customer.name}</p>
                        <p className="text-sm text-muted-foreground">{customer.nrcNumber}</p>
                      </div>
                    </div>
                    <p className="font-semibold text-destructive">
                      {formatCurrency(customer.outstandingBalance)}
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
