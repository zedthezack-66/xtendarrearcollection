import { useRef } from "react";
import { FileText, Download, Users, DollarSign, TrendingUp, Clock, Phone, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { useMasterCustomers, useTickets, usePayments, useBatches, useProfiles } from "@/hooks/useSupabaseData";
import { format } from "date-fns";

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);

export default function Reports() {
  const reportRef = useRef<HTMLDivElement>(null);
  const { data: masterCustomers = [] } = useMasterCustomers();
  const { data: tickets = [] } = useTickets();
  const { data: payments = [] } = usePayments();
  const { data: batches = [] } = useBatches();
  const { data: profiles = [] } = useProfiles();

  const totalOwed = masterCustomers.reduce((s, c) => s + Number(c.total_owed), 0);
  const totalCollected = masterCustomers.reduce((s, c) => s + Number(c.total_paid), 0);
  const outstanding = totalOwed - totalCollected;
  const collectionRate = totalOwed > 0 ? (totalCollected / totalOwed) * 100 : 0;
  
  const openTickets = tickets.filter(t => t.status === 'Open').length;
  const inProgressTickets = tickets.filter(t => t.status === 'In Progress').length;
  const resolvedTickets = tickets.filter(t => t.status === 'Resolved').length;

  const statusData = [
    { name: 'Open', value: openTickets, color: '#f59e0b' },
    { name: 'In Progress', value: inProgressTickets, color: '#0ea5e9' },
    { name: 'Resolved', value: resolvedTickets, color: '#22c55e' },
  ].filter(d => d.value > 0);

  const agentData = profiles.map(profile => ({
    name: profile.display_name || profile.full_name,
    collected: payments.filter(p => p.recorded_by === profile.id).reduce((s, p) => s + Number(p.amount), 0),
  })).filter(a => a.collected > 0);

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
        <Button onClick={generatePDF} className="gap-2">
          <Download className="h-4 w-4" />
          Download PDF
        </Button>
      </div>

      <div ref={reportRef} className="space-y-6 bg-background p-6 rounded-lg">
        {/* Report Header */}
        <div className="text-center border-b pb-4">
          <h2 className="text-xl font-bold">Xtenda Arrears Collection</h2>
          <p className="text-lg text-muted-foreground">Weekly Performance Report</p>
          <p className="text-sm text-muted-foreground">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
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
                  <p className="text-xs text-muted-foreground">Total Customers</p>
                  <p className="text-xl font-bold">{masterCustomers.length}</p>
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

        {/* Ticket Status Summary Cards */}
        <div className="grid grid-cols-3 gap-4">
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
                  {/* Custom Legend - No Overlap */}
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
            <CardHeader><CardTitle className="text-base">Collections by Agent</CardTitle></CardHeader>
            <CardContent>
              {agentData.length > 0 ? (
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={agentData} layout="vertical">
                      <XAxis type="number" tickFormatter={v => `K${(v/1000).toFixed(0)}`} />
                      <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="collected" fill="#22c55e" radius={[0, 4, 4, 0]} />
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

        {/* Summary */}
        <Card>
          <CardHeader><CardTitle className="text-base">Summary Statistics</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground">Active Batches</p>
                <p className="text-xl font-bold">{batches.length}</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground">Total Tickets</p>
                <p className="text-xl font-bold">{tickets.length}</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground">Total Payments</p>
                <p className="text-xl font-bold">{payments.length}</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground">Active Agents</p>
                <p className="text-xl font-bold">{profiles.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground pt-4 border-t">
          <p>Generated by Xtenda Arrears Collection System</p>
          <p>{format(new Date(), "EEEE, MMMM d, yyyy 'at' h:mm a")}</p>
        </div>
      </div>
    </div>
  );
}
