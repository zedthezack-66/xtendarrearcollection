import { useRef } from "react";
import { FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { useMasterCustomers, useTickets, usePayments, useBatches, useProfiles } from "@/hooks/useSupabaseData";

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
  const openTickets = tickets.filter(t => t.status !== 'Resolved').length;
  const resolvedTickets = tickets.filter(t => t.status === 'Resolved').length;

  const statusData = [
    { name: 'Open', value: tickets.filter(t => t.status === 'Open').length, color: '#f59e0b' },
    { name: 'In Progress', value: tickets.filter(t => t.status === 'In Progress').length, color: '#0ea5e9' },
    { name: 'Resolved', value: resolvedTickets, color: '#22c55e' },
  ].filter(d => d.value > 0);

  const agentData = profiles.map(profile => ({
    name: profile.full_name,
    collected: payments.filter(p => p.recorded_by === profile.id).reduce((s, p) => s + Number(p.amount), 0),
  })).filter(a => a.collected > 0);

  const generatePDF = async () => {
    if (!reportRef.current) return;
    const canvas = await html2canvas(reportRef.current, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`weekly_report_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="h-6 w-6" />Weekly Report</h1>
          <p className="text-muted-foreground">Dashboard breakdown with visuals</p>
        </div>
        <Button onClick={generatePDF}><Download className="h-4 w-4 mr-2" />Download PDF</Button>
      </div>
      <div ref={reportRef} className="space-y-6 bg-background p-6">
        <div className="text-center border-b pb-4">
          <h2 className="text-xl font-bold">LoanCollect Weekly Report</h2>
          <p className="text-muted-foreground">{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <Card><CardContent className="pt-6 text-center"><p className="text-3xl font-bold">{masterCustomers.length}</p><p className="text-muted-foreground">Total Customers</p></CardContent></Card>
          <Card><CardContent className="pt-6 text-center"><p className="text-3xl font-bold text-destructive">{formatCurrency(outstanding)}</p><p className="text-muted-foreground">Outstanding</p></CardContent></Card>
          <Card><CardContent className="pt-6 text-center"><p className="text-3xl font-bold text-success">{formatCurrency(totalCollected)}</p><p className="text-muted-foreground">Collected</p></CardContent></Card>
          <Card><CardContent className="pt-6 text-center"><p className="text-3xl font-bold text-primary">{collectionRate.toFixed(1)}%</p><p className="text-muted-foreground">Collection Rate</p></CardContent></Card>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Tickets by Status</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={70} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                      {statusData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Collections by Agent</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agentData}>
                    <XAxis dataKey="name" />
                    <YAxis tickFormatter={v => `K${(v/1000).toFixed(0)}`} />
                    <Bar dataKey="collected" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>• Total Batches: {batches.length}</p>
            <p>• Open Tickets: {openTickets} | Resolved: {resolvedTickets}</p>
            <p>• Total Payments Recorded: {payments.length}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
