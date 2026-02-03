import { Users, AlertTriangle, Ticket, TrendingUp, CheckCircle, Loader2, DollarSign, MessageSquare } from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useUIStore } from "@/store/useUIStore";
import { useBatches, useProfiles } from "@/hooks/useSupabaseData";
import { useDashboardStats, useCollectionsByAgent, useRecentTickets, useTopDefaulters } from "@/hooks/useDashboardData";
import { useAuth } from "@/contexts/AuthContext";
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

// Independent widget components that load their own data
function StatsWidget({ batchId }: { batchId: string | null }) {
  const { data: stats, isLoading } = useDashboardStats(batchId);

  if (isLoading) {
    return (
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8">
        {[...Array(8)].map((_, i) => (
          <Card key={i} className="animate-pulse min-h-[120px]">
            <CardContent className="p-4">
              <Skeleton className="h-3 w-16 mb-2" />
              <Skeleton className="h-6 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const openAndInProgress = (stats?.open_tickets || 0) + (stats?.in_progress_tickets || 0);
  // Interactions = In Progress + Resolved tickets
  const totalInteractions = (stats?.in_progress_tickets || 0) + (stats?.resolved_tickets || 0);

  // Build cards array - always show same number for layout stability
  const cards = [
    { title: "Total Customers", value: stats?.total_customers || 0, icon: Users, variant: "default" as const },
    { title: "Total Outstanding", value: formatCurrency(stats?.total_outstanding || 0), icon: AlertTriangle, variant: "destructive" as const },
    { title: "Total Collected", value: formatCurrency(stats?.total_collected || 0), icon: DollarSign, variant: "success" as const },
    { title: "Collection Rate", value: `${stats?.collection_rate || 0}%`, icon: TrendingUp, variant: "info" as const },
    { title: "Open Tickets", value: openAndInProgress, icon: Ticket, variant: "warning" as const },
    { title: "Resolved Tickets", value: stats?.resolved_tickets || 0, icon: CheckCircle, variant: "success" as const },
    { title: "Interactions", value: totalInteractions, icon: MessageSquare, variant: "default" as const },
  ];

  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8">
      {cards.map((card) => (
        <StatCard
          key={card.title}
          title={card.title}
          value={card.value}
          icon={card.icon}
          variant={card.variant}
        />
      ))}
    </div>
  );
}

function TicketsPieChart({ batchId }: { batchId: string | null }) {
  const { data: stats, isLoading } = useDashboardStats(batchId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tickets by Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px] flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const ticketsByStatus = [
    { name: 'Open', value: stats?.open_tickets || 0, color: STATUS_COLORS['Open'] },
    { name: 'In Progress', value: stats?.in_progress_tickets || 0, color: STATUS_COLORS['In Progress'] },
    { name: 'Resolved', value: stats?.resolved_tickets || 0, color: STATUS_COLORS['Resolved'] },
  ].filter((d) => d.value > 0);

  if (ticketsByStatus.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tickets by Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px] flex items-center justify-center text-muted-foreground">
            No ticket data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
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
  );
}

function CollectionsByAgentChart({ batchId }: { batchId: string | null }) {
  const { data: collectionsByAgent, isLoading } = useCollectionsByAgent(batchId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Collections by Agent</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px] flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!collectionsByAgent || collectionsByAgent.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Collections by Agent</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px] flex items-center justify-center text-muted-foreground">
            No agent data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
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
  );
}

function RecentTicketsWidget({ batchId }: { batchId: string | null }) {
  const { data: recentTickets, isLoading } = useRecentTickets(batchId, undefined, 5);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Open Tickets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <Skeleton className="h-4 w-32 mb-1" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const openTickets = recentTickets?.filter(t => t.status !== 'Resolved') || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recent Open Tickets</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {openTickets.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-4">No open tickets</p>
          ) : (
            openTickets.map((ticket) => (
              <div key={ticket.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium text-foreground">{ticket.customer_name}</p>
                  <p className="text-sm text-muted-foreground">{formatCurrency(Number(ticket.amount_owed))}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={ticket.priority === 'High' ? 'destructive' : 'secondary'}>
                    {ticket.priority}
                  </Badge>
                  <Badge 
                    className={`whitespace-nowrap ${
                      ticket.status === 'Open' ? 'bg-warning/10 text-warning border-warning/20' :
                      'bg-info/10 text-info border-info/20'
                    }`}
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
  );
}

function TopDefaultersWidget({ batchId }: { batchId: string | null }) {
  const { data: topDefaulters, isLoading } = useTopDefaulters(batchId, 5);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Top Defaulters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div>
                    <Skeleton className="h-4 w-32 mb-1" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Top Defaulters</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {(!topDefaulters || topDefaulters.length === 0) ? (
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
                    <p className="text-sm text-muted-foreground">{customer.nrc_number}</p>
                  </div>
                </div>
                <p className="font-semibold text-destructive">
                  {formatCurrency(Number(customer.outstanding_balance))}
                </p>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { activeBatchId } = useUIStore();
  const { profile, isAdmin } = useAuth();
  const { data: batches } = useBatches();
  const { data: profiles } = useProfiles();

  const activeBatch = batches?.find(b => b.id === activeBatchId);
  const currentProfile = profiles?.find(p => p.id === profile?.id);
  const displayName = currentProfile?.display_name || profile?.full_name?.split(' ')[0] || 'Agent';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {isAdmin ? 'Collections Dashboard' : `${displayName}'s Collection Dashboard`}
          {isAdmin && <Badge className="ml-2 align-middle">Admin</Badge>}
        </h1>
        <p className="text-muted-foreground">
          {activeBatch ? `Viewing batch: ${activeBatch.name}` : 
           isAdmin ? 'Overview of all loan collections' : 'Your assigned collections'}
        </p>
      </div>

      {/* Each widget loads independently - no blocking */}
      <StatsWidget batchId={activeBatchId} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TicketsPieChart batchId={activeBatchId} />
        <CollectionsByAgentChart batchId={activeBatchId} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentTicketsWidget batchId={activeBatchId} />
        <TopDefaultersWidget batchId={activeBatchId} />
      </div>
    </div>
  );
}
