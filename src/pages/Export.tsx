import { useState } from "react";
import { Download, FileSpreadsheet, Users, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMasterCustomers, useBatches, useBatchCustomers, useTickets, usePayments } from "@/hooks/useSupabaseData";

type ExportFilter = 'all' | 'outstanding' | 'resolved';

export default function Export() {
  const { toast } = useToast();
  const { data: masterCustomers = [] } = useMasterCustomers();
  const { data: batches = [] } = useBatches();
  const { data: batchCustomers = [] } = useBatchCustomers();
  const { data: tickets = [] } = useTickets();
  const { data: payments = [] } = usePayments();
  
  const [exportFilter, setExportFilter] = useState<ExportFilter>('all');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('all');
  const [exportAll, setExportAll] = useState(false);

  const isTicketWorkedOn = (ticketId: string, masterCustomerId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return false;
    const statusChanged = ticket.status !== 'Open';
    const hasNotes = ticket.call_notes && ticket.call_notes.trim().length > 0;
    const hasPayments = payments.some(p => p.master_customer_id === masterCustomerId);
    return statusChanged || hasNotes || hasPayments;
  };

  const getFilteredMasterCustomers = () => {
    let filtered = masterCustomers;
    switch (exportFilter) {
      case 'outstanding': filtered = filtered.filter((c) => c.payment_status !== 'Fully Paid'); break;
      case 'resolved': filtered = filtered.filter((c) => c.payment_status === 'Fully Paid'); break;
    }
    if (!exportAll) {
      filtered = filtered.filter((c) => {
        const ticket = tickets.find(t => t.master_customer_id === c.id);
        if (!ticket) return false;
        return isTicketWorkedOn(ticket.id, c.id);
      });
    }
    return filtered;
  };

  const getFilteredBatchCustomers = () => {
    let filtered = batchCustomers;
    if (selectedBatchId !== 'all') filtered = filtered.filter(bc => bc.batch_id === selectedBatchId);
    if (exportFilter !== 'all') {
      filtered = filtered.filter(bc => {
        const master = masterCustomers.find(mc => mc.id === bc.master_customer_id);
        if (!master) return false;
        return exportFilter === 'outstanding' ? master.payment_status !== 'Fully Paid' : master.payment_status === 'Fully Paid';
      });
    }
    if (!exportAll) {
      filtered = filtered.filter(bc => {
        const ticket = tickets.find(t => t.master_customer_id === bc.master_customer_id);
        if (!ticket) return false;
        return isTicketWorkedOn(ticket.id, bc.master_customer_id);
      });
    }
    return filtered;
  };

  const downloadCSV = (content: string, prefix: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${prefix}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportMaster = () => {
    const filteredCustomers = getFilteredMasterCustomers();
    if (filteredCustomers.length === 0) {
      toast({ title: "No Data", description: exportAll ? "There are no customers to export" : "No worked-on tickets to export. Enable 'Export All' to include all.", variant: "destructive" });
      return;
    }

    const headers = ['Customer Name', 'NRC Number', 'Mobile Number', 'Total Amount Owed', 'Total Amount Paid', 'Outstanding Balance', 'Payment Status', 'Call Notes', 'Ticket Status'];
    const rows = filteredCustomers.map((customer) => {
      const ticket = tickets.find((t) => t.master_customer_id === customer.id);
      return [customer.name, customer.nrc_number, customer.mobile_number || '', customer.total_owed, customer.total_paid, customer.outstanding_balance, customer.payment_status, `"${(customer.call_notes || '').replace(/"/g, '""')}"`, ticket?.status || 'N/A'].join(',');
    });

    downloadCSV([headers.join(','), ...rows].join('\n'), `master-customers-${exportFilter}${exportAll ? '-all' : '-worked'}`);
    toast({ title: "Export Complete", description: `Successfully exported ${filteredCustomers.length} master customers` });
  };

  const handleExportBatch = () => {
    const filteredCustomers = getFilteredBatchCustomers();
    if (filteredCustomers.length === 0) {
      toast({ title: "No Data", description: exportAll ? "There are no customers to export" : "No worked-on tickets to export. Enable 'Export All' to include all.", variant: "destructive" });
      return;
    }

    const headers = ['Batch Name', 'Customer Name', 'NRC Number', 'Mobile Number', 'Batch Amount Owed', 'Total Paid (Global)', 'Outstanding Balance (Global)', 'Payment Status', 'Call Notes', 'Ticket Status'];
    const rows = filteredCustomers.map((bc) => {
      const master = masterCustomers.find(mc => mc.id === bc.master_customer_id);
      const batch = batches.find(b => b.id === bc.batch_id);
      const ticket = tickets.find((t) => t.master_customer_id === bc.master_customer_id);
      return [batch?.name || 'Unknown', bc.name, bc.nrc_number, bc.mobile_number || '', bc.amount_owed, master?.total_paid || 0, master?.outstanding_balance || 0, master?.payment_status || 'N/A', `"${(master?.call_notes || '').replace(/"/g, '""')}"`, ticket?.status || 'N/A'].join(',');
    });

    const batchSuffix = selectedBatchId === 'all' ? 'all-batches' : batches.find(b => b.id === selectedBatchId)?.name || selectedBatchId;
    downloadCSV([headers.join(','), ...rows].join('\n'), `batch-export-${batchSuffix}-${exportFilter}${exportAll ? '-all' : '-worked'}`);
    toast({ title: "Export Complete", description: `Successfully exported ${filteredCustomers.length} batch customers` });
  };

  const masterFilteredCount = getFilteredMasterCustomers().length;
  const batchFilteredCount = getFilteredBatchCustomers().length;
  const workedOnCount = tickets.filter(t => isTicketWorkedOn(t.id, t.master_customer_id)).length;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Export Data</h1>
        <p className="text-muted-foreground">Download customer and collection data as CSV</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="export-all" className="font-medium">Export All Tickets</Label>
              <p className="text-sm text-muted-foreground">{exportAll ? "Exporting all tickets regardless of activity" : `Exporting only worked-on tickets (${workedOnCount} of ${tickets.length})`}</p>
            </div>
            <Switch id="export-all" checked={exportAll} onCheckedChange={setExportAll} />
          </div>
          {!exportAll && (
            <div className="mt-3 p-3 bg-muted rounded-lg text-sm text-muted-foreground">
              <p className="font-medium mb-1">Worked-on tickets include:</p>
              <ul className="list-disc list-inside space-y-0.5"><li>Status changed from Open</li><li>Call notes added</li><li>Payments recorded</li></ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="master" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="master" className="flex items-center gap-2"><Database className="h-4 w-4" />Master Registry</TabsTrigger>
          <TabsTrigger value="batch" className="flex items-center gap-2"><Users className="h-4 w-4" />Batch Export</TabsTrigger>
        </TabsList>

        <TabsContent value="master">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" />Export Master Customer List</CardTitle>
              <CardDescription>Export global customer data with all payment history</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <RadioGroup value={exportFilter} onValueChange={(v) => setExportFilter(v as ExportFilter)}>
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"><RadioGroupItem value="all" id="master-all" /><Label htmlFor="master-all" className="flex-1 cursor-pointer"><span className="font-medium">All Customers</span><p className="text-sm text-muted-foreground">Export complete master registry</p></Label><span className="text-sm text-muted-foreground">{masterCustomers.length} records</span></div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"><RadioGroupItem value="outstanding" id="master-outstanding" /><Label htmlFor="master-outstanding" className="flex-1 cursor-pointer"><span className="font-medium">Outstanding Only</span><p className="text-sm text-muted-foreground">Customers with unpaid balances</p></Label><span className="text-sm text-muted-foreground">{masterCustomers.filter((c) => c.payment_status !== 'Fully Paid').length} records</span></div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"><RadioGroupItem value="resolved" id="master-resolved" /><Label htmlFor="master-resolved" className="flex-1 cursor-pointer"><span className="font-medium">Fully Paid Only</span><p className="text-sm text-muted-foreground">Customers who have paid in full</p></Label><span className="text-sm text-muted-foreground">{masterCustomers.filter((c) => c.payment_status === 'Fully Paid').length} records</span></div>
              </RadioGroup>
              <Button onClick={handleExportMaster} disabled={masterFilteredCount === 0} className="w-full"><Download className="h-4 w-4 mr-2" />Export {masterFilteredCount} Customer{masterFilteredCount !== 1 ? 's' : ''} to CSV</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="batch">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" />Export Batch Data</CardTitle>
              <CardDescription>Export customer data per batch or all batches</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Select Batch</Label>
                <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
                  <SelectTrigger><SelectValue placeholder="Select a batch" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Batches</SelectItem>
                    {batches.map((batch) => (<SelectItem key={batch.id} value={batch.id}>{batch.name} ({batch.customer_count} customers)</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <RadioGroup value={exportFilter} onValueChange={(v) => setExportFilter(v as ExportFilter)}>
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"><RadioGroupItem value="all" id="batch-all" /><Label htmlFor="batch-all" className="flex-1 cursor-pointer"><span className="font-medium">All Customers</span><p className="text-sm text-muted-foreground">Export all customers in selected batch(es)</p></Label></div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"><RadioGroupItem value="outstanding" id="batch-outstanding" /><Label htmlFor="batch-outstanding" className="flex-1 cursor-pointer"><span className="font-medium">Outstanding Only</span><p className="text-sm text-muted-foreground">Customers with unpaid balances</p></Label></div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"><RadioGroupItem value="resolved" id="batch-resolved" /><Label htmlFor="batch-resolved" className="flex-1 cursor-pointer"><span className="font-medium">Fully Paid Only</span><p className="text-sm text-muted-foreground">Customers who have paid in full</p></Label></div>
              </RadioGroup>
              <Button onClick={handleExportBatch} disabled={batchFilteredCount === 0} className="w-full"><Download className="h-4 w-4 mr-2" />Export {batchFilteredCount} Customer{batchFilteredCount !== 1 ? 's' : ''} to CSV</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
