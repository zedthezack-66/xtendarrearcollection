import { useState } from "react";
import { TrendingUp, TrendingDown, Minus, CheckCircle, AlertCircle, Calendar, Users, ChevronDown, ChevronRight, Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/contexts/AuthContext";
import { useArrearsMovementAnalytics } from "@/hooks/useDashboardData";
import { useProfiles } from "@/hooks/useSupabaseData";
import XLSX from "xlsx-js-style";

const formatCurrency = (amount: number) => 
  new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);

const formatDate = (date: string) => 
  new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

type DatePreset = 'week' | 'month' | 'quarter' | 'custom';

export default function ArrearsAnalytics() {
  const { isAdmin } = useAuth();
  const [datePreset, setDatePreset] = useState<DatePreset>('week');
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>("all");
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  
  const { data: profiles = [] } = useProfiles();
  
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
  const agentFilter = selectedAgentFilter === "all" ? undefined : selectedAgentFilter;
  const { data: analytics, isLoading, error } = useArrearsMovementAnalytics(dateRange.start, dateRange.end, agentFilter);

  const toggleAgentExpand = (agentId: string) => {
    const next = new Set(expandedAgents);
    if (next.has(agentId)) {
      next.delete(agentId);
    } else {
      next.add(agentId);
    }
    setExpandedAgents(next);
  };

  const exportPivotReport = () => {
    if (!analytics?.by_agent) return;

    const headers = ['Agent', 'Movement Type', 'Sum of Previous Arrears', 'Sum of Current Arrears', 'Sum of Movement', 'Count'];
    const rows: any[][] = [];
    
    let grandTotalPrevious = 0;
    let grandTotalCurrent = 0;
    let grandTotalMovement = 0;
    let grandTotalCount = 0;

    analytics.by_agent.forEach((agent: any) => {
      // Agent summary row
      const agentMovement = -agent.total_recovered || 0;
      const agentCount = agent.cleared + agent.reduced + agent.increased + agent.maintained;
      grandTotalCount += agentCount;
      grandTotalMovement += agentMovement;
      
      rows.push([agent.agent_name, '', '', '', formatCurrency(agentMovement), agentCount]);
      
      // Movement type breakdown
      if (agent.cleared > 0) {
        rows.push(['  ', 'Arrears Cleared', '', '', '', agent.cleared]);
      }
      if (agent.increased > 0) {
        rows.push(['  ', 'Arrears Increased', '', '', '', agent.increased]);
      }
      if (agent.maintained > 0) {
        rows.push(['  ', 'Arrears Maintained', '', '', '', agent.maintained]);
      }
      if (agent.reduced > 0) {
        rows.push(['  ', 'Arrears Reduced', '', '', '', agent.reduced]);
      }
    });

    // Grand total
    rows.push(['Grand Total', '', '', '', formatCurrency(grandTotalMovement), grandTotalCount]);

    const wb = XLSX.utils.book_new();
    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Style header
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
      if (ws[cellRef]) {
        ws[cellRef].s = {
          font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "4472C4" } },
          alignment: { horizontal: "center" }
        };
      }
    }

    // Column widths
    ws['!cols'] = [
      { wch: 25 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 12 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Arrears Movement');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arrears_movement_${dateRange.start}_${dateRange.end}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Arrears Movement Analytics</h1>
          <p className="text-muted-foreground">Track arrears changes from loan book syncs (pivot-style breakdown)</p>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedAgentFilter} onValueChange={setSelectedAgentFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter Agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents</SelectItem>
              {profiles.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {(p as any).display_name || p.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
            <SelectTrigger className="w-40">
              <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Last 7 Days</SelectItem>
              <SelectItem value="month">Last Month</SelectItem>
              <SelectItem value="quarter">Last Quarter</SelectItem>
            </SelectContent>
          </Select>
          
          <Button variant="outline" onClick={exportPivotReport} disabled={isLoading || !analytics?.by_agent?.length}>
            <Download className="h-4 w-4 mr-2" />
            Export Excel
          </Button>
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

      {/* Pivot-Style Agent Breakdown (matches Excel sample) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Arrears Movement by Agent (Pivot View)
          </CardTitle>
          <CardDescription>Click agent rows to expand movement breakdown (matches manual Excel reports)</CardDescription>
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
                <TableRow className="bg-primary text-primary-foreground">
                  <TableHead className="text-primary-foreground font-bold">Row Labels</TableHead>
                  <TableHead className="text-right text-primary-foreground font-bold">Sum of Movement</TableHead>
                  <TableHead className="text-right text-primary-foreground font-bold">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.by_agent.map((agent: any) => {
                  const isExpanded = expandedAgents.has(agent.agent_id);
                  const agentMovement = -agent.total_recovered || 0;
                  const agentCount = agent.cleared + agent.reduced + agent.increased + agent.maintained;
                  
                  return (
                    <Collapsible key={agent.agent_id} open={isExpanded} onOpenChange={() => toggleAgentExpand(agent.agent_id)}>
                      <CollapsibleTrigger asChild>
                        <TableRow className="cursor-pointer hover:bg-muted/50 font-semibold bg-success/5">
                          <TableCell className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            {agent.agent_name}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            <span className={agentMovement < 0 ? 'text-destructive' : agentMovement > 0 ? 'text-success' : ''}>
                              ({formatCurrency(Math.abs(agentMovement))})
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono">{agentCount}</TableCell>
                        </TableRow>
                      </CollapsibleTrigger>
                      <CollapsibleContent asChild>
                        <>
                          {agent.cleared > 0 && (
                            <TableRow className="bg-muted/20">
                              <TableCell className="pl-10">Arrears Cleared</TableCell>
                              <TableCell className="text-right font-mono text-success">-</TableCell>
                              <TableCell className="text-right font-mono">{agent.cleared}</TableCell>
                            </TableRow>
                          )}
                          {agent.increased > 0 && (
                            <TableRow className="bg-muted/20">
                              <TableCell className="pl-10">Arrears Increased</TableCell>
                              <TableCell className="text-right font-mono text-destructive">-</TableCell>
                              <TableCell className="text-right font-mono">{agent.increased}</TableCell>
                            </TableRow>
                          )}
                          {agent.maintained > 0 && (
                            <TableRow className="bg-muted/20">
                              <TableCell className="pl-10">Arrears Maintained</TableCell>
                              <TableCell className="text-right font-mono">-</TableCell>
                              <TableCell className="text-right font-mono">{agent.maintained}</TableCell>
                            </TableRow>
                          )}
                          {agent.reduced > 0 && (
                            <TableRow className="bg-muted/20">
                              <TableCell className="pl-10">Arrears Reduced</TableCell>
                              <TableCell className="text-right font-mono text-info">-</TableCell>
                              <TableCell className="text-right font-mono">{agent.reduced}</TableCell>
                            </TableRow>
                          )}
                        </>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
                {/* Grand Total Row */}
                <TableRow className="bg-success/10 font-bold border-t-2">
                  <TableCell>Grand Total</TableCell>
                  <TableCell className="text-right font-mono">
                    ({formatCurrency(Math.abs(analytics.summary?.total_change_amount || 0))})
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {(analytics.summary?.cleared || 0) + (analytics.summary?.reduced || 0) + 
                     (analytics.summary?.increased || 0) + (analytics.summary?.maintained || 0)}
                  </TableCell>
                </TableRow>
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
