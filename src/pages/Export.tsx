import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/useAppStore";

type ExportFilter = 'all' | 'outstanding' | 'resolved';

export default function Export() {
  const { toast } = useToast();
  const { customers, tickets } = useAppStore();
  const [exportFilter, setExportFilter] = useState<ExportFilter>('all');

  const getFilteredCustomers = () => {
    switch (exportFilter) {
      case 'outstanding':
        return customers.filter((c) => c.paymentStatus !== 'Fully Paid');
      case 'resolved':
        return customers.filter((c) => c.paymentStatus === 'Fully Paid');
      default:
        return customers;
    }
  };

  const handleExport = () => {
    const filteredCustomers = getFilteredCustomers();
    
    if (filteredCustomers.length === 0) {
      toast({
        title: "No Data",
        description: "There are no customers to export with the selected filter",
        variant: "destructive",
      });
      return;
    }

    // Build CSV content
    const headers = [
      'Customer Name',
      'NRC Number',
      'Original Amount Owed',
      'Total Amount Paid',
      'Outstanding Balance',
      'Payment Status',
      'Will Pay Tomorrow',
      'No Call',
      'Call Notes',
      'Assigned Agent',
      'Ticket Status',
    ];

    const rows = filteredCustomers.map((customer) => {
      const ticket = tickets.find((t) => t.customerId === customer.id);
      const outstanding = customer.amountOwed - customer.totalPaid;
      
      return [
        customer.name,
        customer.nrcNumber,
        customer.amountOwed,
        customer.totalPaid,
        outstanding,
        customer.paymentStatus,
        customer.willPayTomorrow ? 'Yes' : 'No',
        customer.noCall ? 'Yes' : 'No',
        `"${(customer.callNotes || '').replace(/"/g, '""')}"`,
        customer.assignedAgent,
        ticket?.status || 'N/A',
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    
    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const date = new Date().toISOString().split('T')[0];
    link.download = `loan-collections-export-${exportFilter}-${date}.csv`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Export Complete",
      description: `Successfully exported ${filteredCustomers.length} customers`,
    });
  };

  const filteredCount = getFilteredCustomers().length;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Export Data</h1>
        <p className="text-muted-foreground">Download customer and collection data as CSV</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Export Options
          </CardTitle>
          <CardDescription>
            Select which customers to include in your export
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RadioGroup value={exportFilter} onValueChange={(v) => setExportFilter(v as ExportFilter)}>
            <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
              <RadioGroupItem value="all" id="all" />
              <Label htmlFor="all" className="flex-1 cursor-pointer">
                <span className="font-medium">All Customers</span>
                <p className="text-sm text-muted-foreground">Export complete customer list</p>
              </Label>
              <span className="text-sm text-muted-foreground">{customers.length} records</span>
            </div>
            
            <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
              <RadioGroupItem value="outstanding" id="outstanding" />
              <Label htmlFor="outstanding" className="flex-1 cursor-pointer">
                <span className="font-medium">Outstanding Only</span>
                <p className="text-sm text-muted-foreground">Customers with unpaid balances</p>
              </Label>
              <span className="text-sm text-muted-foreground">
                {customers.filter((c) => c.paymentStatus !== 'Fully Paid').length} records
              </span>
            </div>
            
            <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
              <RadioGroupItem value="resolved" id="resolved" />
              <Label htmlFor="resolved" className="flex-1 cursor-pointer">
                <span className="font-medium">Fully Paid Only</span>
                <p className="text-sm text-muted-foreground">Customers who have paid in full</p>
              </Label>
              <span className="text-sm text-muted-foreground">
                {customers.filter((c) => c.paymentStatus === 'Fully Paid').length} records
              </span>
            </div>
          </RadioGroup>

          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground mb-2">Export includes:</p>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>• Customer Name & NRC Number</li>
              <li>• Amount Owed, Total Paid, Outstanding Balance</li>
              <li>• Payment Status & Flags (Will Pay Tomorrow, No Call)</li>
              <li>• Call Notes & Assigned Agent</li>
              <li>• Ticket Status</li>
            </ul>
          </div>

          <Button 
            onClick={handleExport} 
            disabled={filteredCount === 0}
            className="w-full"
          >
            <Download className="h-4 w-4 mr-2" />
            Export {filteredCount} Customer{filteredCount !== 1 ? 's' : ''} to CSV
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
