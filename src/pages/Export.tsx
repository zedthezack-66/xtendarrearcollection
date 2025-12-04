import { useState } from "react";
import { Download, FileSpreadsheet, Users, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/useAppStore";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ExportFilter = 'all' | 'outstanding' | 'resolved';

export default function Export() {
  const { toast } = useToast();
  const { masterCustomers, batches, batchCustomers, tickets, payments } = useAppStore();
  const [exportFilter, setExportFilter] = useState<ExportFilter>('all');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('all');
  const [exportAll, setExportAll] = useState(false);

  // Check if a ticket has been "worked on"
  const isTicketWorkedOn = (ticketId: string, masterCustomerId: string) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return false;

    // Check if status changed (not Open anymore)
    const statusChanged = ticket.status !== 'Open';
    
    // Check if notes were added
    const hasNotes = ticket.callNotes && ticket.callNotes.trim().length > 0;
    
    // Check if payments were made
    const hasPayments = payments.some(p => p.masterCustomerId === masterCustomerId);
    
    return statusChanged || hasNotes || hasPayments;
  };

  const getFilteredMasterCustomers = () => {
    let filtered = masterCustomers;

    // Apply payment status filter
    switch (exportFilter) {
      case 'outstanding':
        filtered = filtered.filter((c) => c.paymentStatus !== 'Fully Paid');
        break;
      case 'resolved':
        filtered = filtered.filter((c) => c.paymentStatus === 'Fully Paid');
        break;
    }

    // Apply "worked on" filter (unless exportAll is enabled)
    if (!exportAll) {
      filtered = filtered.filter((c) => {
        const ticket = tickets.find(t => t.masterCustomerId === c.id);
        if (!ticket) return false;
        return isTicketWorkedOn(ticket.id, c.id);
      });
    }

    return filtered;
  };

  const getFilteredBatchCustomers = () => {
    let filtered = batchCustomers;
    
    if (selectedBatchId !== 'all') {
      filtered = filtered.filter(bc => bc.batchId === selectedBatchId);
    }
    
    // Apply payment status filter based on master customer
    if (exportFilter !== 'all') {
      filtered = filtered.filter(bc => {
        const master = masterCustomers.find(mc => mc.id === bc.masterCustomerId);
        if (!master) return false;
        return exportFilter === 'outstanding' 
          ? master.paymentStatus !== 'Fully Paid'
          : master.paymentStatus === 'Fully Paid';
      });
    }

    // Apply "worked on" filter (unless exportAll is enabled)
    if (!exportAll) {
      filtered = filtered.filter(bc => {
        const ticket = tickets.find(t => t.masterCustomerId === bc.masterCustomerId);
        if (!ticket) return false;
        return isTicketWorkedOn(ticket.id, bc.masterCustomerId);
      });
    }
    
    return filtered;
  };

  const handleExportMaster = () => {
    const filteredCustomers = getFilteredMasterCustomers();
    
    if (filteredCustomers.length === 0) {
      toast({
        title: "No Data",
        description: exportAll 
          ? "There are no customers to export with the selected filter"
          : "There are no worked-on tickets to export. Enable 'Export All' to include all tickets.",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      'Customer Name',
      'NRC Number',
      'Mobile Number',
      'Total Amount Owed',
      'Total Amount Paid',
      'Outstanding Balance',
      'Payment Status',
      'Call Notes',
      'Assigned Agent',
      'Ticket Status',
    ];

    const rows = filteredCustomers.map((customer) => {
      const ticket = tickets.find((t) => t.masterCustomerId === customer.id);
      
      return [
        customer.name,
        customer.nrcNumber,
        customer.mobileNumber || '',
        customer.totalOwed,
        customer.totalPaid,
        customer.outstandingBalance,
        customer.paymentStatus,
        `"${(customer.callNotes || '').replace(/"/g, '""')}"`,
        customer.assignedAgent,
        ticket?.status || 'N/A',
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    downloadCSV(csvContent, `master-customers-${exportFilter}${exportAll ? '-all' : '-worked'}`);

    toast({
      title: "Export Complete",
      description: `Successfully exported ${filteredCustomers.length} master customers`,
    });
  };

  const handleExportBatch = () => {
    const filteredCustomers = getFilteredBatchCustomers();
    
    if (filteredCustomers.length === 0) {
      toast({
        title: "No Data",
        description: exportAll 
          ? "There are no customers to export with the selected filters"
          : "There are no worked-on tickets to export. Enable 'Export All' to include all tickets.",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      'Batch Name',
      'Customer Name',
      'NRC Number',
      'Mobile Number',
      'Batch Amount Owed',
      'Total Paid (Global)',
      'Outstanding Balance (Global)',
      'Payment Status',
      'Call Notes',
      'Assigned Agent',
      'Ticket Status',
    ];

    const rows = filteredCustomers.map((bc) => {
      const master = masterCustomers.find(mc => mc.id === bc.masterCustomerId);
      const batch = batches.find(b => b.id === bc.batchId);
      const ticket = tickets.find((t) => t.masterCustomerId === bc.masterCustomerId);
      
      return [
        batch?.name || 'Unknown',
        bc.name,
        bc.nrcNumber,
        bc.mobileNumber || '',
        bc.amountOwed,
        master?.totalPaid || 0,
        master?.outstandingBalance || 0,
        master?.paymentStatus || 'N/A',
        `"${(master?.callNotes || '').replace(/"/g, '""')}"`,
        master?.assignedAgent || 'N/A',
        ticket?.status || 'N/A',
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const batchSuffix = selectedBatchId === 'all' ? 'all-batches' : batches.find(b => b.id === selectedBatchId)?.name || selectedBatchId;
    downloadCSV(csvContent, `batch-export-${batchSuffix}-${exportFilter}${exportAll ? '-all' : '-worked'}`);

    toast({
      title: "Export Complete",
      description: `Successfully exported ${filteredCustomers.length} batch customers`,
    });
  };

  const downloadCSV = (content: string, prefix: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const date = new Date().toISOString().split('T')[0];
    link.download = `${prefix}-${date}.csv`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const masterFilteredCount = getFilteredMasterCustomers().length;
  const batchFilteredCount = getFilteredBatchCustomers().length;

  // Count worked-on tickets
  const workedOnCount = tickets.filter(t => isTicketWorkedOn(t.id, t.masterCustomerId)).length;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Export Data</h1>
        <p className="text-muted-foreground">Download customer and collection data as CSV</p>
      </div>

      {/* Export All Toggle */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="export-all" className="font-medium">Export All Tickets</Label>
              <p className="text-sm text-muted-foreground">
                {exportAll 
                  ? "Exporting all tickets regardless of activity"
                  : `Exporting only worked-on tickets (${workedOnCount} of ${tickets.length})`}
              </p>
            </div>
            <Switch
              id="export-all"
              checked={exportAll}
              onCheckedChange={setExportAll}
            />
          </div>
          {!exportAll && (
            <div className="mt-3 p-3 bg-muted rounded-lg text-sm text-muted-foreground">
              <p className="font-medium mb-1">Worked-on tickets include:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Status changed from Open</li>
                <li>Call notes added</li>
                <li>Payments recorded</li>
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="master" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="master" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Master Registry
          </TabsTrigger>
          <TabsTrigger value="batch" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Batch Export
          </TabsTrigger>
        </TabsList>

        <TabsContent value="master">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Export Master Customer List
              </CardTitle>
              <CardDescription>
                Export global customer data with all payment history
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <RadioGroup value={exportFilter} onValueChange={(v) => setExportFilter(v as ExportFilter)}>
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="all" id="master-all" />
                  <Label htmlFor="master-all" className="flex-1 cursor-pointer">
                    <span className="font-medium">All Customers</span>
                    <p className="text-sm text-muted-foreground">Export complete master registry</p>
                  </Label>
                  <span className="text-sm text-muted-foreground">{masterCustomers.length} records</span>
                </div>
                
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="outstanding" id="master-outstanding" />
                  <Label htmlFor="master-outstanding" className="flex-1 cursor-pointer">
                    <span className="font-medium">Outstanding Only</span>
                    <p className="text-sm text-muted-foreground">Customers with unpaid balances</p>
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    {masterCustomers.filter((c) => c.paymentStatus !== 'Fully Paid').length} records
                  </span>
                </div>
                
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="resolved" id="master-resolved" />
                  <Label htmlFor="master-resolved" className="flex-1 cursor-pointer">
                    <span className="font-medium">Fully Paid Only</span>
                    <p className="text-sm text-muted-foreground">Customers who have paid in full</p>
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    {masterCustomers.filter((c) => c.paymentStatus === 'Fully Paid').length} records
                  </span>
                </div>
              </RadioGroup>

              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground mb-2">Export includes:</p>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• Customer Name, NRC & Mobile Number</li>
                  <li>• Total Owed, Total Paid, Outstanding Balance</li>
                  <li>• Payment Status</li>
                  <li>• Call Notes & Assigned Agent</li>
                  <li>• Ticket Status</li>
                </ul>
              </div>

              <Button 
                onClick={handleExportMaster} 
                disabled={masterFilteredCount === 0}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Export {masterFilteredCount} Customer{masterFilteredCount !== 1 ? 's' : ''} to CSV
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="batch">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Export Batch Data
              </CardTitle>
              <CardDescription>
                Export customer data per batch or all batches
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Select Batch</Label>
                <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a batch" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Batches</SelectItem>
                    {batches.map((batch) => (
                      <SelectItem key={batch.id} value={batch.id}>
                        {batch.name} ({batch.customerCount} customers)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <RadioGroup value={exportFilter} onValueChange={(v) => setExportFilter(v as ExportFilter)}>
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="all" id="batch-all" />
                  <Label htmlFor="batch-all" className="flex-1 cursor-pointer">
                    <span className="font-medium">All Customers</span>
                    <p className="text-sm text-muted-foreground">Export all customers in selected batch(es)</p>
                  </Label>
                </div>
                
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="outstanding" id="batch-outstanding" />
                  <Label htmlFor="batch-outstanding" className="flex-1 cursor-pointer">
                    <span className="font-medium">Outstanding Only</span>
                    <p className="text-sm text-muted-foreground">Customers with unpaid balances</p>
                  </Label>
                </div>
                
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="resolved" id="batch-resolved" />
                  <Label htmlFor="batch-resolved" className="flex-1 cursor-pointer">
                    <span className="font-medium">Fully Paid Only</span>
                    <p className="text-sm text-muted-foreground">Customers who have paid in full</p>
                  </Label>
                </div>
              </RadioGroup>

              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground mb-2">Export includes:</p>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• Batch Name & Customer Details</li>
                  <li>• Mobile Number</li>
                  <li>• Batch-specific Amount Owed</li>
                  <li>• Global Payment Status & Totals</li>
                  <li>• Call Notes & Agent Assignment</li>
                  <li>• Ticket Status</li>
                </ul>
              </div>

              <Button 
                onClick={handleExportBatch} 
                disabled={batchFilteredCount === 0}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Export {batchFilteredCount} Customer{batchFilteredCount !== 1 ? 's' : ''} to CSV
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
