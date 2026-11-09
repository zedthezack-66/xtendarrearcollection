import { Users, Wallet, Ticket, TrendingUp, CheckCircle2, Loader2, Banknote, MessageSquare } from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LastSyncIndicator } from "@/components/LastSyncIndicator";
import { useUIStore } from "@/store/useUIStore";
import { useBatches, useProfiles } from "@/hooks/useSupabaseData";
import { useDashboardStats, useCollectionsByAgent, useRecentTickets, useTopDefaulters } from "@/hooks/useDashboardData";
import { useAuth } from "@/contexts/AuthContext";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

const STATUS_COLORS = {
  'Open': 'hsl(var(--warning))',
  'In Progress': 'hsl(var(--info))',
  'Resolved': 'hsl(var(--success))',
};

const tooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '0.75rem',
  boxShadow: '0 4px 12px -2px rgb(16 24 40 / 0.08)',
  fontSize: 12,
};

function ChartCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ChartPlaceholder({ loading, message }: { loading?: boolean; message?: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
      {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : message}
    </div>
  );
}

// Independent widget components that load their own data
function StatsWidget({ batchId }: { batchId: string | null }) {
  const { data: stats, isLoading } = useDashboardStats(batchId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-5">
              <Skeleton className="mb-4 h-3 w-24" />
              <Skeleton className="h-7 w-32" />
            </Card>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="p-5">
              <Skeleton className="mb-4 h-3 w-20" />
              <Skeleton className="h-7 w-16" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const openAndInProgress = (stats?.open_tickets || 0) + (stats?.in_progress_tickets || 0);
  // Interactions = In Progress + Resolved tickets
  const totalInteractions = (stats?.in_progress_tickets || 0) + (stats?.resolved_tickets || 0);
  const reportedPending = stats?.reported_pending || 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total Outstanding" value={formatCurrency(stats?.total_outstanding || 0)} icon={Wallet} variant="destructive" />
        <StatCard
          title="Total Collected"
          value={formatCurrency(stats?.total_collected || 0)}
          icon={Banknote}
          variant="success"
          subtitle={reportedPending > 0 ? `Includes ${formatCurrency(reportedPending)} recorded, not yet confirmed by the loan book` : undefined}
        />
        <StatCard title="Collection Rate" value={`${stats?.collection_rate || 0}%`} icon={TrendingUp} variant="brand" />
        <StatCard title="Customers" value={(stats?.total_customers || 0).toLocaleString()} icon={Users} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Open Tickets" value={openAndInProgress.toLocaleString()} icon={Ticket} variant="warning" />
        <StatCard title="Resolved Tickets" value={(stats?.resolved_tickets || 0).toLocaleString()} icon={CheckCircle2} variant="success" />
        <StatCard title="Interactions" value={totalInteractions.toLocaleString()} icon={MessageSquare} variant="info" />
      </div>
    </div>
  );
}

function TicketsPieChart({ batchId }: { batchId: string | null }) {
  const { data: stats, isLoading } = useDashboardStats(batchId);

  const ticketsByStatus = [
    { name: 'Open', value: stats?.open_tickets || 0, color: STATUS_COLORS['Open'] },
    { name: 'In Progress', value: stats?.in_progress_tickets || 0, color: STATUS_COLORS['In Progress'] },
    { name: 'Resolved', value: stats?.resolved_tickets || 0, color: STATUS_COLORS['Resolved'] },
  ];
  const total = ticketsByStatus.reduce((s, d) => s + d.value, 0);

  return (
    <ChartCard title="Tickets by status" description="Where every ticket stands right now">
      {isLoading ? (
        <ChartPlaceholder loading />
      ) : total === 0 ? (
        <ChartPlaceholder message="No ticket data available" />
      ) : (
        <div className="flex h-[260px] items-center gap-6">
          <div className="relative h-full flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={ticketsByStatus.filter((d) => d.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius="62%"
                  outerRadius="88%"
                  paddingAngle={2}
                  dataKey="value"
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                >
                  {ticketsByStatus.filter((d) => d.value > 0).map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="num text-2xl font-semibold tracking-tight">{total.toLocaleString()}</span>
              <span className="text-xs text-muted-foreground">tickets</span>
            </div>
          </div>
          <ul className="w-40 space-y-3">
            {ticketsByStatus.map((d) => (
              <li key={d.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  {d.name}
                </span>
                <span className="num font-medium">{d.value.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}

function CollectionsByAgentChart({ batchId }: { batchId: string | null }) {
  const { data: collectionsByAgent, isLoading } = useCollectionsByAgent(batchId);

  return (
    <ChartCard title="Collections by agent" description="Confirmed and recorded payments">
      {isLoading ? (
        <ChartPlaceholder loading />
      ) : !collectionsByAgent || collectionsByAgent.length === 0 ? (
        <ChartPlaceholder message="No agent data available" />
      ) : (
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={collectionsByAgent} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 4" />
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                interval={0}
              />
              <YAxis
                tickFormatter={(value) => `K${(value / 1000).toFixed(0)}k`}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted))' }}
                formatter={(value: number) => [formatCurrency(value), 'Collected']}
                labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                contentStyle={tooltipStyle}
              />
              <Bar dataKey="collected" fill="hsl(var(--brand))" radius={[6, 6, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-border/70">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-center justify-between py-3">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

function RecentTicketsWidget({ batchId }: { batchId: string | null }) {
  const { data: recentTickets, isLoading } = useRecentTickets(batchId, undefined, 5);
  const openTickets = recentTickets?.filter(t => t.status !== 'Resolved') || [];

  return (
    <ChartCard title="Recent open tickets" description="The latest tickets still in arrears">
      {isLoading ? (
        <ListSkeleton />
      ) : openTickets.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No open tickets</p>
      ) : (
        <div className="divide-y divide-border/70">
          {openTickets.map((ticket) => (
            <div key={ticket.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{ticket.customer_name}</p>
                <p className="num text-xs text-muted-foreground">{formatCurrency(Number(ticket.amount_owed))}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {ticket.priority === 'High' && <Badge variant="destructive">High</Badge>}
                <Badge
                  variant="outline"
                  className={ticket.status === 'Open' ? 'border-warning/30 bg-warning/10 text-warning' : 'border-info/30 bg-info/10 text-info'}
                >
                  {ticket.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

function TopDefaultersWidget({ batchId }: { batchId: string | null }) {
  const { data: topDefaulters, isLoading } = useTopDefaulters(batchId, 5);

  return (
    <ChartCard title="Top defaulters" description="Largest outstanding balances">
      {isLoading ? (
        <ListSkeleton />
      ) : !topDefaulters || topDefaulters.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No defaulters</p>
      ) : (
        <div className="divide-y divide-border/70">
          {topDefaulters.map((customer, index) => (
            <div key={customer.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{customer.name}</p>
                  <p className="text-xs text-muted-foreground">{customer.nrc_number}</p>
                </div>
              </div>
              <p className="num shrink-0 text-sm font-semibold text-destructive">
                {formatCurrency(Number(customer.outstanding_balance))}
              </p>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
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
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`${greeting}, ${displayName}`}
        title={isAdmin ? 'Collections overview' : 'Your collections'}
        description={
          activeBatch ? `Viewing batch: ${activeBatch.name}` :
          isAdmin ? 'All batches, all agents.' : 'The customers assigned to you.'
        }
        actions={<LastSyncIndicator />}
      />

      {/* Each widget loads independently - no blocking */}
      <StatsWidget batchId={activeBatchId} />

      <div className="grid gap-6 lg:grid-cols-2">
        <CollectionsByAgentChart batchId={activeBatchId} />
        <TicketsPieChart batchId={activeBatchId} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentTicketsWidget batchId={activeBatchId} />
        <TopDefaultersWidget batchId={activeBatchId} />
      </div>
    </div>
  );
}
