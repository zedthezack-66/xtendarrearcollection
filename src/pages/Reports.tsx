import { useRef, useState } from "react";
import { FileText, Download, Users, DollarSign, TrendingUp, Clock, Phone, CheckCircle, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { useWeeklyReportStats, useInteractionAnalytics, useAdminAgentAnalytics, useProfiles } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);

export default function Reports() {
  const reportRef = useRef<HTMLDivElement>(null);
  const { userRole } = useAuth();
  const isAdmin = userRole === 'admin';
  
  const [selectedAgent, setSelectedAgent] = useState<string>("all");
  
  const { data: profiles = [] } = useProfiles();
  
  // Server-side computed stats
  const agentFilter = selectedAgent === "all" ? undefined : selectedAgent;
  const { data: reportStats, isLoading: statsLoading } = useWeeklyReportStats(agentFilter);
  const { data: interactionStats, isLoading: interactionsLoading } = useInteractionAnalytics(agentFilter);
  const { data: adminStats, isLoading: adminLoading } = useAdminAgentAnalytics(isAdmin ? agentFilter : undefined);
  
  const isLoading = statsLoading || interactionsLoading || (isAdmin && adminLoading);

  const totalOwed = reportStats?.total_owed ?? 0;
  const totalCollected = reportStats?.total_collected ?? 0;
  const outstanding = reportStats?.outstanding_balance ?? 0;
  const collectionRate = reportStats?.collection_rate ?? 0;
  
  const openTickets = reportStats?.open_tickets ?? 0;
  const inProgressTickets = reportStats?.in_progress_tickets ?? 0;
  const resolvedTickets = reportStats?.resolved_tickets ?? 0;

  // Interactions = In Progress + Resolved tickets
  const totalInteractions = inProgressTickets + resolvedTickets;

  const statusData = [
    { name: 'Open', value: openTickets, color: '#f59e0b' },
    { name: 'In Progress', value: inProgressTickets, color: '#0ea5e9' },
    { name: 'Resolved', value: resolvedTickets, color: '#22c55e' },
  ].filter(d => d.value > 0);

  const agentData = (interactionStats?.by_agent || []).map(agent => ({
    name: agent.agent_name,
    collected: agent.collected_amount,
    interactions: agent.total_interactions,
  })).filter(a => a.collected > 0 || a.interactions > 0);

  const generatePDF = async () => {
    if (!reportRef.current) return;
    const canvas = await html2canvas(reportRef.current, { 
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`weekly_report_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  };

  const generateCSV = () => {
    const headers = ['Metric', 'Value'];
    const rows = [
      ['Total Outstanding', formatCurrency(outstanding)],
      ['Total Collected', formatCurrency(totalCollected)],
      ['Collection Rate', `${collectionRate.toFixed(1)}%`],
      ['Open Tickets', openTickets.toString()],
      ['In Progress Tickets', inProgressTickets.toString()],
      ['Resolved Tickets', resolvedTickets.toString()],
      ['Total Interactions', totalInteractions.toString()],
    ];
    
    // Add per-agent data
    if (interactionStats?.by_agent) {
      rows.push(['', '']);
      rows.push(['Agent', 'Collections', 'Interactions']);
      interactionStats.by_agent.forEach(agent => {
        rows.push([agent.agent_name, formatCurrency(agent.collected_amount), agent.total_interactions.toString()]);
      });
    }
    
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weekly_report_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" />
            Weekly Report
          </h1>
          <p className="text-muted-foreground">Generated on {format(new Date(), 'MMMM d, yyyy')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <Select value={selectedAgent} onValueChange={setSelectedAgent}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select Agent" />
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
          )}
          <Button variant="outline" onClick={generateCSV} className="gap-2">
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button onClick={generatePDF} className="gap-2">
            <Download className="h-4 w-4" />
            PDF
          </Button>
        </div>
      </div>

      <div ref={reportRef} className="space-y-6 bg-background p-6 rounded-lg">
        {/* Report Header */}
        <div className="text-center border-b pb-4">
          <h2 className="text-xl font-bold">Xtenda Arrears Collection</h2>
          <p className="text-lg text-muted-foreground">Weekly Performance Report</p>
          <p className="text-sm text-muted-foreground">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
          {selectedAgent !== "all" && (
            <p className="text-sm text-primary mt-1">
              Filtered by: {profiles.find(p => p.id === selectedAgent)?.full_name}
            </p>
          )}
        </div>

        {/* Key Metrics */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Tickets</p>
                  <p className="text-xl font-bold">{reportStats?.total_tickets ?? 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-destructive/10 rounded-lg">
                  <DollarSign className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Outstanding</p>
                  <p className="text-xl font-bold">{formatCurrency(outstanding)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-success/10 rounded-lg">
                  <DollarSign className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Collected</p>
                  <p className="text-xl font-bold">{formatCurrency(totalCollected)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-info/10 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-info" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Collection Rate</p>
                  <p className="text-xl font-bold">{collectionRate.toFixed(1)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Ticket Status + Interactions Summary */}
        <div className="grid grid-cols-4 gap-4">
          <Card className="bg-warning/5 border-warning/20">
            <CardContent className="p-4 text-center">
              <div className="flex justify-center mb-2">
                <Clock className="h-6 w-6 text-warning" />
              </div>
              <p className="text-2xl font-bold text-warning">{openTickets}</p>
              <p className="text-sm text-muted-foreground">Open</p>
            </CardContent>
          </Card>
          <Card className="bg-info/5 border-info/20">
            <CardContent className="p-4 text-center">
              <div className="flex justify-center mb-2">
                <Phone className="h-6 w-6 text-info" />
              </div>
              <p className="text-2xl font-bold text-info">{inProgressTickets}</p>
              <p className="text-sm text-muted-foreground whitespace-nowrap">In Progress</p>
            </CardContent>
          </Card>
          <Card className="bg-success/5 border-success/20">
            <CardContent className="p-4 text-center">
              <div className="flex justify-center mb-2">
                <CheckCircle className="h-6 w-6 text-success" />
              </div>
              <p className="text-2xl font-bold text-success">{resolvedTickets}</p>
              <p className="text-sm text-muted-foreground">Resolved</p>
            </CardContent>
          </Card>
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4 text-center">
              <div className="flex justify-center mb-2">
                <MessageSquare className="h-6 w-6 text-primary" />
              </div>
              <p className="text-2xl font-bold text-primary">{totalInteractions}</p>
              <p className="text-sm text-muted-foreground">Interactions</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Tickets by Status</CardTitle></CardHeader>
            <CardContent>
              {statusData.length > 0 ? (
                <>
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie 
                          data={statusData} 
                          cx="50%" 
                          cy="50%" 
                          innerRadius={45} 
                          outerRadius={70} 
                          dataKey="value"
                          paddingAngle={2}
                        >
                          {statusData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip formatter={(value) => [value, 'Tickets']} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Custom Legend */}
                  <div className="flex justify-center gap-4 mt-2 flex-wrap">
                    {statusData.map((entry) => (
                      <div key={entry.name} className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full flex-shrink-0" 
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-sm text-muted-foreground whitespace-nowrap">
                          {entry.name}: {entry.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-[180px] flex items-center justify-center text-muted-foreground">
                  No ticket data available
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Collections & Interactions by Agent</CardTitle></CardHeader>
            <CardContent>
              {agentData.length > 0 ? (
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={agentData} layout="vertical">
                      <XAxis type="number" tickFormatter={v => `K${(v/1000).toFixed(0)}`} />
                      <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
                      <Tooltip 
                        formatter={(value: number, name: string) => [
                          name === 'collected' ? formatCurrency(value) : value,
                          name === 'collected' ? 'Collected' : 'Interactions'
                        ]} 
                      />
                      <Bar dataKey="collected" fill="#22c55e" radius={[0, 4, 4, 0]} name="Collected" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                  No collection data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Admin Agent Analytics Table */}
        {isAdmin && adminStats?.agents && adminStats.agents.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agent Performance Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Agent</th>
                      <th className="text-right py-2 px-3">Tickets</th>
                      <th className="text-right py-2 px-3">Outstanding</th>
                      <th className="text-right py-2 px-3">Collected</th>
                      <th className="text-right py-2 px-3">Rate</th>
                      <th className="text-right py-2 px-3">Interactions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminStats.agents.map((agent) => (
                      <tr key={agent.agent_id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">{agent.agent_name}</td>
                        <td className="py-2 px-3 text-right">{agent.total_tickets}</td>
                        <td className="py-2 px-3 text-right text-destructive">{formatCurrency(agent.outstanding_balance)}</td>
                        <td className="py-2 px-3 text-right text-success">{formatCurrency(agent.total_collected)}</td>
                        <td className="py-2 px-3 text-right">{agent.collection_rate.toFixed(1)}%</td>
                        <td className="py-2 px-3 text-right text-primary">{agent.interaction_count}</td>
                      </tr>
                    ))}
                    {/* Totals Row */}
                    <tr className="bg-muted/30 font-semibold">
                      <td className="py-2 px-3">Total</td>
                      <td className="py-2 px-3 text-right">{adminStats.totals.total_tickets}</td>
                      <td className="py-2 px-3 text-right text-destructive">{formatCurrency(adminStats.totals.outstanding_balance)}</td>
                      <td className="py-2 px-3 text-right text-success">{formatCurrency(adminStats.totals.total_collected)}</td>
                      <td className="py-2 px-3 text-right">-</td>
                      <td className="py-2 px-3 text-right text-primary">{adminStats.totals.total_interactions}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground pt-4 border-t">
          <p>Generated by Xtenda Arrears Collection System</p>
          <p>{format(new Date(), "EEEE, MMMM d, yyyy 'at' h:mm a")}</p>
        </div>
      </div>
    </div>
  );
}