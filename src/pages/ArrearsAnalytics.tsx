import { useState } from "react";
import { TrendingUp, TrendingDown, Minus, CheckCircle, AlertCircle, Calendar, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useArrearsMovementAnalytics } from "@/hooks/useDashboardData";

const formatCurrency = (amount: number) => 
  new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);

const formatDate = (date: string) => 
  new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

type DatePreset = 'week' | 'month' | 'quarter' | 'custom';

export default function ArrearsAnalytics() {
  const { isAdmin } = useAuth();
  const [datePreset, setDatePreset] = useState<DatePreset>('week');
  
  const getDateRange = () => {
    const end = new Date();
    const start = new Date();
    
    switch (datePreset) {
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        break;
      case 'quarter':
        start.setMonth(start.getMonth() - 3);
        break;
      default:
        start.setDate(start.getDate() - 7);
    }
    
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
    };
  };

  const dateRange = getDateRange();
  const { data: analytics, isLoading, error } = useArrearsMovementAnalytics(dateRange.start, dateRange.end);

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-96">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Only administrators can access Arrears Analytics.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Arrears Movement Analytics</h1>
          <p className="text-muted-foreground">Track arrears changes from loan book syncs</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Last 7 Days</SelectItem>
              <SelectItem value="month">Last Month</SelectItem>
              <SelectItem value="quarter">Last Quarter</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-success" />
              Cleared
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-2xl font-bold text-success">{analytics?.summary?.cleared || 0}</p>
            )}
            <p className="text-xs text-muted-foreground">Arrears fully cleared</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-info" />
              Reduced
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-2xl font-bold text-info">{analytics?.summary?.reduced || 0}</p>
            )}
            <p className="text-xs text-muted-foreground">Arrears decreased</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-destructive" />
              Increased
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-2xl font-bold text-destructive">{analytics?.summary?.increased || 0}</p>
            )}
            <p className="text-xs text-muted-foreground">Arrears increased</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Minus className="h-4 w-4 text-muted-foreground" />
              Maintained
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-2xl font-bold">{analytics?.summary?.maintained || 0}</p>
            )}
            <p className="text-xs text-muted-foreground">No change</p>
          </CardContent>
        </Card>
      </div>

      {/* Additional Stats */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tickets Auto-Resolved
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <p className="text-3xl font-bold text-success">{analytics?.summary?.total_tickets_resolved || 0}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Movement Amount
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <p className="text-3xl font-bold">{formatCurrency(analytics?.summary?.total_change_amount || 0)}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agent Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Performance by Agent
          </CardTitle>
          <CardDescription>Arrears movement breakdown per agent</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : analytics?.by_agent && analytics.by_agent.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-center">Cleared</TableHead>
                  <TableHead className="text-center">Reduced</TableHead>
                  <TableHead className="text-center">Increased</TableHead>
                  <TableHead className="text-center">Maintained</TableHead>
                  <TableHead className="text-center">Resolved</TableHead>
                  <TableHead className="text-right">Recovered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.by_agent.map((agent: any) => (
                  <TableRow key={agent.agent_id}>
                    <TableCell className="font-medium">{agent.agent_name}</TableCell>
                    <TableCell className="text-center">
                      <Badge className="bg-success/10 text-success">{agent.cleared}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className="bg-info/10 text-info">{agent.reduced}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className="bg-destructive/10 text-destructive">{agent.increased}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{agent.maintained}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className="bg-success/10 text-success">{agent.tickets_resolved}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-success">
                      {formatCurrency(agent.total_recovered || 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center py-8 text-muted-foreground">No data for selected period</p>
          )}
        </CardContent>
      </Card>

      {/* Recent Syncs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Sync Operations</CardTitle>
          <CardDescription>Latest loan book sync history</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : analytics?.recent_syncs && analytics.recent_syncs.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sync Date</TableHead>
                  <TableHead>Batch ID</TableHead>
                  <TableHead className="text-right">Records Processed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.recent_syncs.map((sync: any) => (
                  <TableRow key={sync.sync_batch_id}>
                    <TableCell>{formatDate(sync.sync_date)}</TableCell>
                    <TableCell className="font-mono text-xs">{sync.sync_batch_id.slice(0, 8)}...</TableCell>
                    <TableCell className="text-right">{sync.records_processed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center py-8 text-muted-foreground">No sync operations yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
