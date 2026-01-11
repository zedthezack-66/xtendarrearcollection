import { useState } from "react";
import { Download, FileSpreadsheet, Users, Database, FileText, CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useMasterCustomers, useBatches, useBatchCustomers, useTickets, usePayments, useProfiles, useCallLogs } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { format, isWithinInterval, startOfDay, endOfDay, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";

type ExportFilter = 'all' | 'outstanding' | 'resolved';
type DateRangePreset = 'all' | 'today' | 'week' | 'month' | 'custom';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 0,
  }).format(amount);
};

export default function Export() {
  const { toast } = useToast();
  const { profile, isAdmin } = useAuth();
  const { data: masterCustomers = [] } = useMasterCustomers();
  const { data: batches = [] } = useBatches();
  const { data: batchCustomers = [] } = useBatchCustomers();
  const { data: tickets = [] } = useTickets();
  const { data: payments = [] } = usePayments();
  const { data: profiles = [] } = useProfiles();
  const { data: callLogs = [] } = useCallLogs();
  
  const [exportFilter, setExportFilter] = useState<ExportFilter>('all');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('all');
  const [exportAll, setExportAll] = useState(false);
  
  // Date range state
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>('all');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);

  const handleDatePresetChange = (preset: DateRangePreset) => {
    setDateRangePreset(preset);
    const now = new Date();
    switch (preset) {
      case 'today':
        setStartDate(startOfDay(now));
        setEndDate(endOfDay(now));
        break;
      case 'week':
        setStartDate(startOfDay(subDays(now, 7)));
        setEndDate(endOfDay(now));
        break;
      case 'month':
        setStartDate(startOfDay(subDays(now, 30)));
        setEndDate(endOfDay(now));
        break;
      case 'custom':
        // Keep current dates or set to last week as default
        if (!startDate) setStartDate(startOfDay(subDays(now, 7)));
        if (!endDate) setEndDate(endOfDay(now));
        break;
      case 'all':
      default:
        setStartDate(undefined);
        setEndDate(undefined);
        break;
    }
  };

  const isInDateRange = (dateString: string) => {
    if (!startDate || !endDate) return true;
    const date = new Date(dateString);
    return isWithinInterval(date, { start: startDate, end: endDate });
  };

  const getDateRangeLabel = () => {
    if (dateRangePreset === 'all') return 'All Time';
    if (startDate && endDate) {
      return `${format(startDate, 'MMM d, yyyy')} - ${format(endDate, 'MMM d, yyyy')}`;
    }
    return 'Select dates';
  };

  const currentAgentName = profiles.find(p => p.id === profile?.id)?.display_name || profile?.full_name || 'Agent';

  const getAgentName = (agentId: string | null) => {
    if (!agentId) return '-';
    const prof = profiles.find(p => p.id === agentId);
    return prof?.display_name || prof?.full_name || '-';
  };

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
    
    // Apply date range filter based on created_at
    if (startDate && endDate) {
      filtered = filtered.filter(c => isInDateRange(c.created_at));
    }
    
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
    
    // Apply date range filter based on created_at
    if (startDate && endDate) {
      filtered = filtered.filter(bc => isInDateRange(bc.created_at));
    }
    
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

  // Helper to escape CSV values - wrap in quotes and escape internal quotes
  const escapeCSV = (value: string | null | undefined): string => {
    if (!value) return '';
    const str = String(value);
    // Always wrap in quotes and escape internal quotes
    return `"${str.replace(/"/g, '""')}"`;
  };

  // Helper to format last payment date - compute from payments if not stored
  const getLastPaymentDate = (customerId: string, storedDate?: string | null) => {
    // If stored date exists and is recent, use it
    if (storedDate) {
      return format(new Date(storedDate), 'yyyy-MM-dd');
    }
    // Otherwise compute from payments
    const customerPayments = payments.filter(p => p.master_customer_id === customerId);
    if (customerPayments.length === 0) return '';
    const latestPayment = customerPayments.reduce((latest, p) => {
      const pDate = new Date(p.payment_date);
      return pDate > new Date(latest.payment_date) ? p : latest;
    });
    return format(new Date(latestPayment.payment_date), 'yyyy-MM-dd');
  };

  const handleExportMaster = () => {
    const filteredCustomers = getFilteredMasterCustomers();
    if (filteredCustomers.length === 0) {
      toast({ title: "No Data", description: exportAll ? "There are no customers to export" : "No worked-on tickets to export. Enable 'Export All' to include all.", variant: "destructive" });
      return;
    }

    const headers = [
      'Customer Name', 'NRC Number', 'Mobile Number', 'Total Amount Owed', 'Total Amount Paid', 
      'Outstanding Balance', 'Payment Status', 'Assigned Agent', 'Call Notes', 'Ticket Status', 'Total Collected',
      'Branch Name', 'Arrear Status', 'Employer Name', 'Employer Subdivision', 
      'Loan Consultant', 'Tenure', 'Reason for Arrears', 'Last Payment Date'
    ];
    const rows = filteredCustomers.map((customer: any) => {
      const ticket = tickets.find((t) => t.master_customer_id === customer.id);
      // Calculate total collected from payments for this customer
      const totalCollected = payments
        .filter(p => p.master_customer_id === customer.id)
        .reduce((sum, p) => sum + Number(p.amount), 0);
      // Use customer.call_notes directly from master_customers
      const callNotesStr = customer.call_notes || '';
      // Get last payment date (computed or stored)
      const lastPaymentDate = getLastPaymentDate(customer.id, customer.last_payment_date);
      return [
        escapeCSV(customer.name),
        escapeCSV(customer.nrc_number),
        escapeCSV(customer.mobile_number),
        Number(customer.total_owed).toFixed(2),
        Number(customer.total_paid).toFixed(2),
        Number(customer.outstanding_balance).toFixed(2),
        escapeCSV(customer.payment_status),
        escapeCSV(getAgentName(customer.assigned_agent)),
        escapeCSV(callNotesStr),
        escapeCSV(ticket?.status || 'N/A'),
        totalCollected.toFixed(2),
        // New loan book fields
        escapeCSV(customer.branch_name || ''),
        escapeCSV(customer.arrear_status || ''),
        escapeCSV(customer.employer_name || ''),
        escapeCSV(customer.employer_subdivision || ''),
        escapeCSV(customer.loan_consultant || ''),
        escapeCSV(customer.tenure || ''),
        escapeCSV(customer.reason_for_arrears || ''),
        escapeCSV(lastPaymentDate)
      ].join(',');
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

    const headers = [
      'Batch Name', 'Customer Name', 'NRC Number', 'Mobile Number', 'Batch Amount Owed', 
      'Total Paid (Global)', 'Outstanding Balance (Global)', 'Payment Status', 'Assigned Agent', 
      'Call Notes', 'Ticket Status', 'Total Collected',
      'Branch Name', 'Arrear Status', 'Employer Name', 'Employer Subdivision', 
      'Loan Consultant', 'Tenure', 'Reason for Arrears', 'Last Payment Date'
    ];
    const rows = filteredCustomers.map((bc: any) => {
      const master = masterCustomers.find(mc => mc.id === bc.master_customer_id) as any;
      const batch = batches.find(b => b.id === bc.batch_id);
      const ticket = tickets.find((t) => t.master_customer_id === bc.master_customer_id);
      // Calculate total collected from payments for this customer
      const totalCollected = payments
        .filter(p => p.master_customer_id === bc.master_customer_id)
        .reduce((sum, p) => sum + Number(p.amount), 0);
      // Use master?.call_notes from master_customers
      const callNotesStr = master?.call_notes || '';
      // Get last payment date - prefer batch_customer, fallback to master, then compute
      const lastPaymentDate = getLastPaymentDate(bc.master_customer_id, bc.last_payment_date || master?.last_payment_date);
      return [
        escapeCSV(batch?.name || 'Unknown'),
        escapeCSV(bc.name),
        escapeCSV(bc.nrc_number),
        escapeCSV(bc.mobile_number),
        Number(bc.amount_owed).toFixed(2),
        Number(master?.total_paid || 0).toFixed(2),
        Number(master?.outstanding_balance || 0).toFixed(2),
        escapeCSV(master?.payment_status || 'N/A'),
        escapeCSV(getAgentName(master?.assigned_agent || null)),
        escapeCSV(callNotesStr),
        escapeCSV(ticket?.status || 'N/A'),
        totalCollected.toFixed(2),
        // New loan book fields - prefer batch_customer level, fallback to master
        escapeCSV(bc.branch_name || master?.branch_name || ''),
        escapeCSV(bc.arrear_status || master?.arrear_status || ''),
        escapeCSV(bc.employer_name || master?.employer_name || ''),
        escapeCSV(bc.employer_subdivision || master?.employer_subdivision || ''),
        escapeCSV(bc.loan_consultant || master?.loan_consultant || ''),
        escapeCSV(bc.tenure || master?.tenure || ''),
        escapeCSV(bc.reason_for_arrears || master?.reason_for_arrears || ''),
        escapeCSV(lastPaymentDate)
      ].join(',');
    });

    const batchSuffix = selectedBatchId === 'all' ? 'all-batches' : batches.find(b => b.id === selectedBatchId)?.name || selectedBatchId;
    downloadCSV([headers.join(','), ...rows].join('\n'), `batch-export-${batchSuffix}-${exportFilter}${exportAll ? '-all' : '-worked'}`);
    toast({ title: "Export Complete", description: `Successfully exported ${filteredCustomers.length} batch customers` });
  };

  const handleExportPDF = (type: 'master' | 'batch') => {
    const filteredCustomers = type === 'master' ? getFilteredMasterCustomers() : getFilteredBatchCustomers();
    if (filteredCustomers.length === 0) {
      toast({ title: "No Data", description: "No data to export to PDF", variant: "destructive" });
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;
    let yPos = 20;

    // Header
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Xtenda Loan Collections Report", margin, yPos);
    yPos += 10;

    // Report metadata with agent name
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated by: ${currentAgentName}`, margin, yPos);
    yPos += 5;
    doc.text(`Date: ${new Date().toLocaleDateString('en-ZM', { year: 'numeric', month: 'long', day: 'numeric' })}`, margin, yPos);
    yPos += 5;
    doc.text(`Report Type: ${type === 'master' ? 'Master Registry' : 'Batch Export'}`, margin, yPos);
    yPos += 5;
    doc.text(`Period: ${getDateRangeLabel()}`, margin, yPos);
    yPos += 5;
    doc.text(`Filter: ${exportFilter === 'all' ? 'All Customers' : exportFilter === 'outstanding' ? 'Outstanding Only' : 'Fully Paid Only'}`, margin, yPos);
    yPos += 5;
    doc.text(`Total Records: ${filteredCustomers.length}`, margin, yPos);
    yPos += 10;

    // Draw a line
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 10;

    // Customer details
    doc.setFontSize(9);
    const maxTextWidth = pageWidth - margin * 2 - 8;
    
    if (type === 'master') {
      const masterData = filteredCustomers as any[];
      masterData.forEach((customer, index) => {
        if (yPos > 220) {
          doc.addPage();
          yPos = 20;
        }

        const ticket = tickets.find((t) => t.master_customer_id === customer.id);
        const agentName = getAgentName(customer.assigned_agent);
        // Use customer.call_notes from master_customers
        const hasCallNotes = customer.call_notes && customer.call_notes.trim().length > 0;
        const lastPaymentDate = getLastPaymentDate(customer.id, customer.last_payment_date);

        doc.setFont("helvetica", "bold");
        doc.text(`${index + 1}. ${customer.name}`, margin, yPos);
        yPos += 5;

        doc.setFont("helvetica", "normal");
        doc.text(`NRC: ${customer.nrc_number}  |  Mobile: ${customer.mobile_number || 'N/A'}  |  Agent: ${agentName}`, margin + 4, yPos);
        yPos += 5;
        
        // Loan book fields - Branch, Employer, Arrear Status
        const branchInfo = customer.branch_name ? `Branch: ${customer.branch_name}` : '';
        const employerInfo = customer.employer_name ? `Employer: ${customer.employer_name}` : '';
        const arrearInfo = customer.arrear_status ? `Arrear Status: ${customer.arrear_status}` : '';
        const loanBookLine = [branchInfo, employerInfo, arrearInfo].filter(Boolean).join('  |  ');
        if (loanBookLine) {
          doc.text(loanBookLine, margin + 4, yPos);
          yPos += 5;
        }
        
        // Loan Consultant and Tenure
        const consultantInfo = customer.loan_consultant ? `Loan Consultant: ${customer.loan_consultant}` : '';
        const tenureInfo = customer.tenure ? `Tenure: ${customer.tenure}` : '';
        const lastPaymentInfo = lastPaymentDate ? `Last Payment: ${lastPaymentDate}` : '';
        const consultantLine = [consultantInfo, tenureInfo, lastPaymentInfo].filter(Boolean).join('  |  ');
        if (consultantLine) {
          doc.text(consultantLine, margin + 4, yPos);
          yPos += 5;
        }
        
        yPos += 1;
        
        // Financial amounts - emphasized and accurate
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text(`Total Owed: ${formatCurrency(Number(customer.total_owed))}`, margin + 4, yPos);
        yPos += 5;
        doc.text(`Total Paid: ${formatCurrency(Number(customer.total_paid))}`, margin + 4, yPos);
        yPos += 5;
        doc.text(`Outstanding Balance: ${formatCurrency(Number(customer.outstanding_balance))}`, margin + 4, yPos);
        yPos += 5;
        
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(`Status: ${customer.payment_status}  |  Ticket: ${ticket?.status || 'N/A'}`, margin + 4, yPos);
        yPos += 5;

        // Add reason for arrears if exists
        if (customer.reason_for_arrears) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.text(`Reason for Arrears: ${customer.reason_for_arrears}`, margin + 4, yPos);
          yPos += 4;
          doc.setFontSize(9);
          doc.setFont("helvetica", "normal");
        }

        // Add call notes if they exist
        if (hasCallNotes) {
          if (yPos > 260) {
            doc.addPage();
            yPos = 20;
          }
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text(`Call Notes:`, margin + 4, yPos);
          yPos += 4;
          
          doc.setFont("helvetica", "normal");
          const splitNotes = doc.splitTextToSize(customer.call_notes!, maxTextWidth);
          doc.text(splitNotes, margin + 8, yPos);
          yPos += splitNotes.length * 3 + 3;
          doc.setFontSize(9);
        }
        
        yPos += 4;
      });
    } else {
      const batchData = filteredCustomers as any[];
      batchData.forEach((bc, index) => {
        if (yPos > 220) {
          doc.addPage();
          yPos = 20;
        }

        const master = masterCustomers.find(mc => mc.id === bc.master_customer_id) as any;
        const batch = batches.find(b => b.id === bc.batch_id);
        const ticket = tickets.find((t) => t.master_customer_id === bc.master_customer_id);
        const agentName = getAgentName(master?.assigned_agent || null);
        // Use master?.call_notes from master_customers
        const hasCallNotes = master?.call_notes && master.call_notes.trim().length > 0;
        const lastPaymentDate = getLastPaymentDate(bc.master_customer_id, bc.last_payment_date || master?.last_payment_date);

        doc.setFont("helvetica", "bold");
        doc.text(`${index + 1}. ${bc.name}`, margin, yPos);
        yPos += 5;

        doc.setFont("helvetica", "normal");
        doc.text(`Batch: ${batch?.name || 'Unknown'}  |  NRC: ${bc.nrc_number}  |  Agent: ${agentName}`, margin + 4, yPos);
        yPos += 5;
        doc.text(`Mobile: ${bc.mobile_number || 'N/A'}`, margin + 4, yPos);
        yPos += 5;
        
        // Loan book fields - Branch, Employer, Arrear Status (prefer batch level, fallback to master)
        const branchName = bc.branch_name || master?.branch_name;
        const employerName = bc.employer_name || master?.employer_name;
        const arrearStatus = bc.arrear_status || master?.arrear_status;
        const branchInfo = branchName ? `Branch: ${branchName}` : '';
        const employerInfo = employerName ? `Employer: ${employerName}` : '';
        const arrearInfo = arrearStatus ? `Arrear Status: ${arrearStatus}` : '';
        const loanBookLine = [branchInfo, employerInfo, arrearInfo].filter(Boolean).join('  |  ');
        if (loanBookLine) {
          doc.text(loanBookLine, margin + 4, yPos);
          yPos += 5;
        }
        
        // Loan Consultant and Tenure
        const loanConsultant = bc.loan_consultant || master?.loan_consultant;
        const tenure = bc.tenure || master?.tenure;
        const consultantInfo = loanConsultant ? `Loan Consultant: ${loanConsultant}` : '';
        const tenureInfo = tenure ? `Tenure: ${tenure}` : '';
        const lastPaymentInfo = lastPaymentDate ? `Last Payment: ${lastPaymentDate}` : '';
        const consultantLine = [consultantInfo, tenureInfo, lastPaymentInfo].filter(Boolean).join('  |  ');
        if (consultantLine) {
          doc.text(consultantLine, margin + 4, yPos);
          yPos += 5;
        }
        
        yPos += 1;
        
        // Financial amounts - emphasized and accurate
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text(`Batch Amount Owed: ${formatCurrency(Number(bc.amount_owed))}`, margin + 4, yPos);
        yPos += 5;
        doc.text(`Global Total Paid: ${formatCurrency(Number(master?.total_paid || 0))}`, margin + 4, yPos);
        yPos += 5;
        doc.text(`Global Outstanding: ${formatCurrency(Number(master?.outstanding_balance || 0))}`, margin + 4, yPos);
        yPos += 5;
        
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(`Status: ${master?.payment_status || 'N/A'}  |  Ticket: ${ticket?.status || 'N/A'}`, margin + 4, yPos);
        yPos += 5;

        // Add reason for arrears if exists
        const reasonForArrears = bc.reason_for_arrears || master?.reason_for_arrears;
        if (reasonForArrears) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.text(`Reason for Arrears: ${reasonForArrears}`, margin + 4, yPos);
          yPos += 4;
          doc.setFontSize(9);
          doc.setFont("helvetica", "normal");
        }

        // Add call notes if they exist
        if (hasCallNotes) {
          if (yPos > 260) {
            doc.addPage();
            yPos = 20;
          }
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text(`Call Notes:`, margin + 4, yPos);
          yPos += 4;
          
          doc.setFont("helvetica", "normal");
          const splitNotes = doc.splitTextToSize(master!.call_notes!, maxTextWidth);
          doc.text(splitNotes, margin + 8, yPos);
          yPos += splitNotes.length * 3 + 3;
          doc.setFontSize(9);
        }
        
        yPos += 4;
      });
    }

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Page ${i} of ${pageCount}  |  Generated by ${currentAgentName}  |  Xtenda Collections`, pageWidth / 2, 290, { align: 'center' });
    }

    const prefix = type === 'master' ? 'master-report' : `batch-report-${selectedBatchId === 'all' ? 'all' : batches.find(b => b.id === selectedBatchId)?.name || 'batch'}`;
    doc.save(`${prefix}-${new Date().toISOString().split('T')[0]}.pdf`);
    toast({ title: "PDF Export Complete", description: `Successfully exported ${filteredCustomers.length} records to PDF` });
  };

  const masterFilteredCount = getFilteredMasterCustomers().length;
  const batchFilteredCount = getFilteredBatchCustomers().length;
  const workedOnCount = tickets.filter(t => isTicketWorkedOn(t.id, t.master_customer_id)).length;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Export Data</h1>
        <p className="text-muted-foreground">Download customer and collection data as CSV or PDF</p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="export-all" className="font-medium">Export All Tickets</Label>
              <p className="text-sm text-muted-foreground">{exportAll ? "Exporting all tickets regardless of activity" : `Exporting only worked-on tickets (${workedOnCount} of ${tickets.length})`}</p>
            </div>
            <Switch id="export-all" checked={exportAll} onCheckedChange={setExportAll} />
          </div>
          {!exportAll && (
            <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground">
              <p className="font-medium mb-1">Worked-on tickets include:</p>
              <ul className="list-disc list-inside space-y-0.5"><li>Status changed from Open</li><li>Call notes added</li><li>Payments recorded</li></ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Date Range Filter
          </CardTitle>
          <CardDescription>Filter exports by record creation date</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(['all', 'today', 'week', 'month', 'custom'] as DateRangePreset[]).map((preset) => (
              <Button
                key={preset}
                variant={dateRangePreset === preset ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleDatePresetChange(preset)}
              >
                {preset === 'all' ? 'All Time' : preset === 'week' ? 'Last 7 Days' : preset === 'month' ? 'Last 30 Days' : preset.charAt(0).toUpperCase() + preset.slice(1)}
              </Button>
            ))}
          </div>
          
          {dateRangePreset === 'custom' && (
            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-[200px] justify-start text-left font-normal",
                        !startDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={setStartDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              
              <div className="space-y-2">
                <Label>End Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-[200px] justify-start text-left font-normal",
                        !endDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={setEndDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}
          
          <div className="p-3 bg-muted/50 rounded-lg text-sm">
            <span className="font-medium">Selected Period:</span> {getDateRangeLabel()}
          </div>
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
              <div className="flex gap-2">
                <Button onClick={handleExportMaster} disabled={masterFilteredCount === 0} className="flex-1"><Download className="h-4 w-4 mr-2" />Export CSV ({masterFilteredCount})</Button>
                <Button onClick={() => handleExportPDF('master')} disabled={masterFilteredCount === 0} variant="outline" className="flex-1"><FileText className="h-4 w-4 mr-2" />Export PDF</Button>
              </div>
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
              <div className="flex gap-2">
                <Button onClick={handleExportBatch} disabled={batchFilteredCount === 0} className="flex-1"><Download className="h-4 w-4 mr-2" />Export CSV ({batchFilteredCount})</Button>
                <Button onClick={() => handleExportPDF('batch')} disabled={batchFilteredCount === 0} variant="outline" className="flex-1"><FileText className="h-4 w-4 mr-2" />Export PDF</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
