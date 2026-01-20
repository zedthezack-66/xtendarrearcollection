import { useState } from "react";
import { Download, FileSpreadsheet, Users, Database, FileText, CalendarIcon, AlertCircle, CheckCircle2 } from "lucide-react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useMasterCustomers, useBatches, useBatchCustomers, useTickets, usePayments, useProfiles, useCallLogs } from "@/hooks/useSupabaseData";
import { useAdminExport, ExportFilter as AdminExportFilter } from "@/hooks/useAdminExport";
import { useAuth } from "@/contexts/AuthContext";
import { format, isWithinInterval, startOfDay, endOfDay, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import XLSX from "xlsx-js-style";

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
  
  const adminExport = useAdminExport();
  
  const [exportFilter, setExportFilter] = useState<ExportFilter>('all');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('all');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');
  const [exportAll, setExportAll] = useState(false);
  const [lastExportStats, setLastExportStats] = useState<{ expected: number; exported: number } | null>(null);
  
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

  const downloadStyledExcel = (data: any[][], headers: string[], filename: string, resolvedRows: number[]) => {
    const wb = XLSX.utils.book_new();
    const wsData = [headers, ...data];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set generous column widths
    const colWidths = headers.map((header) => {
      const headerLen = header.length;
      if (header.includes('Amount') || header.includes('Balance') || header.includes('Paid') || header.includes('Collected')) {
        return { wch: 24 };
      }
      if (header.includes('Notes')) {
        return { wch: 50 };
      }
      if (header.includes('Name') || header.includes('Agent')) {
        return { wch: 28 };
      }
      if (header.includes('NRC') || header.includes('Number')) {
        return { wch: 20 };
      }
      return { wch: Math.max(headerLen + 6, 18) };
    });
    ws['!cols'] = colWidths;

    // Style header row
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
      if (ws[cellRef]) {
        ws[cellRef].s = {
          font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "4472C4" } },
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
          border: {
            top: { style: "thin", color: { rgb: "000000" } },
            bottom: { style: "thin", color: { rgb: "000000" } },
            left: { style: "thin", color: { rgb: "000000" } },
            right: { style: "thin", color: { rgb: "000000" } }
          }
        };
      }
    }

    // Style data rows
    for (let row = 1; row <= range.e.r; row++) {
      const isResolved = resolvedRows.includes(row);
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
        if (ws[cellRef]) {
          ws[cellRef].s = {
            font: { sz: 10 },
            fill: isResolved ? { fgColor: { rgb: "C6EFCE" } } : { fgColor: { rgb: "FFFFFF" } },
            alignment: { vertical: "center", wrapText: true },
            border: {
              top: { style: "thin", color: { rgb: "D9D9D9" } },
              bottom: { style: "thin", color: { rgb: "D9D9D9" } },
              left: { style: "thin", color: { rgb: "D9D9D9" } },
              right: { style: "thin", color: { rgb: "D9D9D9" } }
            }
          };
        }
      }
    }

    ws['!rows'] = [{ hpt: 28 }];

    XLSX.utils.book_append_sheet(wb, ws, 'Export');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}-${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getLastPaymentDate = (customerId: string, storedDate?: string | null) => {
    if (storedDate) {
      return format(new Date(storedDate), 'yyyy-MM-dd');
    }
    const customerPayments = payments.filter(p => p.master_customer_id === customerId);
    if (customerPayments.length === 0) return '';
    const latestPayment = customerPayments.reduce((latest, p) => {
      const pDate = new Date(p.payment_date);
      return pDate > new Date(latest.payment_date) ? p : latest;
    });
    return format(new Date(latestPayment.payment_date), 'yyyy-MM-dd');
  };

  // Admin export using server-side RPC - guarantees ALL data
  const handleAdminExportTickets = async () => {
    try {
      const result = await adminExport.mutateAsync({
        exportType: 'tickets',
        filter: exportFilter as AdminExportFilter,
        batchId: selectedBatchId !== 'all' ? selectedBatchId : null,
        agentId: selectedAgentId !== 'all' ? selectedAgentId : null,
        startDate: startDate ? format(startDate, 'yyyy-MM-dd') : null,
        endDate: endDate ? format(endDate, 'yyyy-MM-dd') : null,
        workedOnly: !exportAll,
      });

      if (!result.data || result.data.length === 0) {
        toast({ title: "No Data", description: "No tickets match the selected filters", variant: "destructive" });
        return;
      }

      setLastExportStats({ expected: result.rows_expected, exported: result.rows_exported });

      const headers = [
        'Ticket ID', 'Customer Name', 'NRC Number', 'Mobile Number', 'Amount Owed', 
        'Status', 'Priority', 'Batch Name', 'Agent Name', 'Call Notes',
        'Total Owed', 'Total Paid', 'Outstanding Balance', 'Payment Status',
        'Branch Name', 'Employer Name', 'Employer Subdivision', 'Loan Consultant',
        'Tenure', 'Arrear Status', 'Last Payment Date', 'Loan Book Payment Date',
        'Next of Kin Name', 'Next of Kin Contact', 'Workplace Contact', 'Workplace Destination',
        'Ticket Arrear Status', 'Ticket Payment Status', 'Employer Reason',
        'Total Collected', 'Created At', 'Resolved Date'
      ];

      const resolvedRows: number[] = [];
      const rows = result.data.map((t: any, index: number) => {
        const isResolved = t.status === 'Resolved';
        if (isResolved) resolvedRows.push(index + 1);

        return [
          t.id || '',
          t.customer_name || '',
          t.nrc_number || '',
          t.mobile_number || '',
          Number(t.amount_owed || 0).toFixed(2),
          t.status || '',
          t.priority || '',
          t.batch_name || '',
          t.agent_name || '',
          t.call_notes || '',
          Number(t.total_owed || 0).toFixed(2),
          Number(t.total_paid || 0).toFixed(2),
          Number(t.outstanding_balance || 0).toFixed(2),
          t.payment_status || '',
          t.branch_name || '',
          t.employer_name || '',
          t.employer_subdivision || '',
          t.loan_consultant || '',
          t.tenure || '',
          t.master_arrear_status || '',
          t.last_payment_date || '',
          t.loan_book_last_payment_date || '',
          t.next_of_kin_name || '',
          t.next_of_kin_contact || '',
          t.workplace_contact || '',
          t.workplace_destination || '',
          t.ticket_arrear_status || '',
          t.ticket_payment_status || '',
          t.employer_reason_for_arrears || '',
          Number(t.total_collected || 0).toFixed(2),
          t.created_at ? format(new Date(t.created_at), 'yyyy-MM-dd HH:mm') : '',
          t.resolved_date ? format(new Date(t.resolved_date), 'yyyy-MM-dd') : ''
        ];
      });

      downloadStyledExcel(rows, headers, `tickets-export-${exportFilter}${exportAll ? '-all' : '-worked'}`, resolvedRows);
      toast({ 
        title: "Export Complete", 
        description: `Successfully exported ${result.rows_exported} tickets (validated: ${result.rows_expected} expected)` 
      });
    } catch (error) {
      console.error('Export error:', error);
    }
  };

  const handleAdminExportMaster = async () => {
    try {
      const result = await adminExport.mutateAsync({
        exportType: 'master_customers',
        filter: exportFilter as AdminExportFilter,
        agentId: selectedAgentId !== 'all' ? selectedAgentId : null,
        startDate: startDate ? format(startDate, 'yyyy-MM-dd') : null,
        endDate: endDate ? format(endDate, 'yyyy-MM-dd') : null,
        workedOnly: !exportAll,
      });

      if (!result.data || result.data.length === 0) {
        toast({ title: "No Data", description: "No customers match the selected filters", variant: "destructive" });
        return;
      }

      setLastExportStats({ expected: result.rows_expected, exported: result.rows_exported });

      const headers = [
        'Customer Name', 'NRC Number', 'Mobile Number', 'Total Owed', 'Total Paid',
        'Outstanding Balance', 'Payment Status', 'Agent Name', 'Call Notes', 'Ticket Status',
        'Total Collected', 'Branch Name', 'Arrear Status', 'Employer Name', 'Employer Subdivision',
        'Loan Consultant', 'Tenure', 'Last Payment Date', 'Loan Book Payment Date',
        'Next of Kin Name', 'Next of Kin Contact', 'Workplace Contact', 'Workplace Destination',
        'Ticket Arrear Status', 'Ticket Payment Status', 'Employer Reason'
      ];

      const resolvedRows: number[] = [];
      const rows = result.data.map((c: any, index: number) => {
        const isResolved = c.payment_status === 'Fully Paid' || c.ticket_status === 'Resolved';
        if (isResolved) resolvedRows.push(index + 1);

        return [
          c.name || '',
          c.nrc_number || '',
          c.mobile_number || '',
          Number(c.total_owed || 0).toFixed(2),
          Number(c.total_paid || 0).toFixed(2),
          Number(c.outstanding_balance || 0).toFixed(2),
          c.payment_status || '',
          c.agent_name || '',
          c.call_notes || '',
          c.ticket_status || '',
          Number(c.total_collected || 0).toFixed(2),
          c.branch_name || '',
          c.arrear_status || '',
          c.employer_name || '',
          c.employer_subdivision || '',
          c.loan_consultant || '',
          c.tenure || '',
          c.last_payment_date || '',
          c.loan_book_last_payment_date || '',
          c.next_of_kin_name || '',
          c.next_of_kin_contact || '',
          c.workplace_contact || '',
          c.workplace_destination || '',
          c.ticket_arrear_status || '',
          c.ticket_payment_status || '',
          c.employer_reason_for_arrears || ''
        ];
      });

      downloadStyledExcel(rows, headers, `master-customers-${exportFilter}${exportAll ? '-all' : '-worked'}`, resolvedRows);
      toast({ 
        title: "Export Complete", 
        description: `Successfully exported ${result.rows_exported} customers (validated: ${result.rows_expected} expected)` 
      });
    } catch (error) {
      console.error('Export error:', error);
    }
  };

  const handleAdminExportBatch = async () => {
    try {
      const result = await adminExport.mutateAsync({
        exportType: 'batch_customers',
        filter: exportFilter as AdminExportFilter,
        batchId: selectedBatchId !== 'all' ? selectedBatchId : null,
        agentId: selectedAgentId !== 'all' ? selectedAgentId : null,
        startDate: startDate ? format(startDate, 'yyyy-MM-dd') : null,
        endDate: endDate ? format(endDate, 'yyyy-MM-dd') : null,
        workedOnly: !exportAll,
      });

      if (!result.data || result.data.length === 0) {
        toast({ title: "No Data", description: "No batch customers match the selected filters", variant: "destructive" });
        return;
      }

      setLastExportStats({ expected: result.rows_expected, exported: result.rows_exported });

      const headers = [
        'Batch Name', 'Customer Name', 'NRC Number', 'Mobile Number', 'Batch Amount Owed',
        'Total Paid (Global)', 'Outstanding Balance (Global)', 'Payment Status', 'Agent Name',
        'Call Notes', 'Ticket Status', 'Total Collected',
        'Branch Name', 'Arrear Status', 'Employer Name', 'Employer Subdivision',
        'Loan Consultant', 'Tenure', 'Last Payment Date', 'Loan Book Payment Date',
        'Next of Kin Name', 'Next of Kin Contact', 'Workplace Contact', 'Workplace Destination',
        'Ticket Arrear Status', 'Ticket Payment Status', 'Employer Reason'
      ];

      const resolvedRows: number[] = [];
      const rows = result.data.map((bc: any, index: number) => {
        const isResolved = bc.payment_status === 'Fully Paid' || bc.ticket_status === 'Resolved';
        if (isResolved) resolvedRows.push(index + 1);

        return [
          bc.batch_name || '',
          bc.name || '',
          bc.nrc_number || '',
          bc.mobile_number || '',
          Number(bc.amount_owed || 0).toFixed(2),
          Number(bc.total_paid || 0).toFixed(2),
          Number(bc.outstanding_balance || 0).toFixed(2),
          bc.payment_status || '',
          bc.agent_name || '',
          bc.master_call_notes || '',
          bc.ticket_status || '',
          Number(bc.total_collected || 0).toFixed(2),
          bc.branch_name || '',
          bc.arrear_status || '',
          bc.employer_name || '',
          bc.employer_subdivision || '',
          bc.loan_consultant || '',
          bc.tenure || '',
          bc.last_payment_date || '',
          bc.loan_book_last_payment_date || '',
          bc.next_of_kin_name || '',
          bc.next_of_kin_contact || '',
          bc.workplace_contact || '',
          bc.workplace_destination || '',
          bc.ticket_arrear_status || '',
          bc.ticket_payment_status || '',
          bc.employer_reason_for_arrears || ''
        ];
      });

      const batchSuffix = selectedBatchId === 'all' ? 'all-batches' : batches.find(b => b.id === selectedBatchId)?.name || 'batch';
      downloadStyledExcel(rows, headers, `batch-export-${batchSuffix}-${exportFilter}${exportAll ? '-all' : '-worked'}`, resolvedRows);
      toast({ 
        title: "Export Complete", 
        description: `Successfully exported ${result.rows_exported} batch customers (validated: ${result.rows_expected} expected)` 
      });
    } catch (error) {
      console.error('Export error:', error);
    }
  };

  // Keep legacy export for non-admin users (agent-scoped via RLS)
  const getFilteredMasterCustomers = () => {
    let filtered = masterCustomers;
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

  const handleExportMaster = () => {
    // For admin, use server-side export to get ALL data
    if (isAdmin) {
      handleAdminExportMaster();
      return;
    }

    const filteredCustomers = getFilteredMasterCustomers();
    if (filteredCustomers.length === 0) {
      toast({ title: "No Data", description: exportAll ? "There are no customers to export" : "No worked-on tickets to export. Enable 'Export All' to include all.", variant: "destructive" });
      return;
    }

    const headers = [
      'Customer Name', 'NRC Number', 'Mobile Number', 'Total Amount Owed', 'Total Amount Paid', 
      'Outstanding Balance', 'Payment Status', 'Assigned Agent', 'Call Notes', 'Ticket Status', 'Total Collected',
      'Branch Name', 'Arrear Status', 'Employer Name', 'Employer Subdivision', 
      'Loan Consultant', 'Tenure', 'Last Payment Date',
      'Next of Kin Name', 'Next of Kin Contact', 'Workplace Contact', 'Workplace Destination',
      'Ticket Arrear Status', 'Ticket Payment Status', 'Employer Reason for Arrears'
    ];
    
    const resolvedRows: number[] = [];
    const rows = filteredCustomers.map((customer: any, index: number) => {
      const ticket = tickets.find((t) => t.master_customer_id === customer.id);
      const totalCollected = payments
        .filter(p => p.master_customer_id === customer.id)
        .reduce((sum, p) => sum + Number(p.amount), 0);
      const callNotesStr = customer.call_notes || '';
      const lastPaymentDate = getLastPaymentDate(customer.id, customer.last_payment_date);
      
      const isResolved = customer.payment_status === 'Fully Paid' || ticket?.status === 'Resolved';
      if (isResolved) {
        resolvedRows.push(index + 1);
      }
      
      const totalOwed = Number(customer.total_owed) || 0;
      const totalPaid = Number(customer.total_paid) || 0;
      const outstandingBalance = Math.max(totalOwed - totalPaid, 0);
      
      return [
        customer.name || '',
        customer.nrc_number || '',
        customer.mobile_number || '',
        totalOwed.toFixed(2),
        totalPaid.toFixed(2),
        outstandingBalance.toFixed(2),
        customer.payment_status || '',
        getAgentName(customer.assigned_agent),
        callNotesStr,
        ticket?.status || 'N/A',
        totalCollected.toFixed(2),
        customer.branch_name || '',
        customer.arrear_status || '',
        customer.employer_name || '',
        customer.employer_subdivision || '',
        customer.loan_consultant || '',
        customer.tenure || '',
        lastPaymentDate,
        (customer as any).next_of_kin_name || '',
        (customer as any).next_of_kin_contact || '',
        (customer as any).workplace_contact || '',
        (customer as any).workplace_destination || '',
        (ticket as any)?.ticket_arrear_status || '',
        (ticket as any)?.ticket_payment_status || '',
        (ticket as any)?.employer_reason_for_arrears || ''
      ];
    });

    downloadStyledExcel(rows, headers, `master-customers-${exportFilter}${exportAll ? '-all' : '-worked'}`, resolvedRows);
    toast({ title: "Export Complete", description: `Successfully exported ${filteredCustomers.length} master customers to Excel` });
  };

  const handleExportBatch = () => {
    // For admin, use server-side export to get ALL data
    if (isAdmin) {
      handleAdminExportBatch();
      return;
    }

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
      'Loan Consultant', 'Tenure', 'Last Payment Date',
      'Next of Kin Name', 'Next of Kin Contact', 'Workplace Contact', 'Workplace Destination',
      'Ticket Arrear Status', 'Ticket Payment Status', 'Employer Reason for Arrears'
    ];
    
    const resolvedRows: number[] = [];
    const rows = filteredCustomers.map((bc: any, index: number) => {
      const master = masterCustomers.find(mc => mc.id === bc.master_customer_id) as any;
      const batch = batches.find(b => b.id === bc.batch_id);
      const ticket = tickets.find((t) => t.master_customer_id === bc.master_customer_id);
      const totalCollected = payments
        .filter(p => p.master_customer_id === bc.master_customer_id)
        .reduce((sum, p) => sum + Number(p.amount), 0);
      const callNotesStr = master?.call_notes || '';
      const lastPaymentDate = getLastPaymentDate(bc.master_customer_id, bc.last_payment_date || master?.last_payment_date);
      
      const isResolved = master?.payment_status === 'Fully Paid' || ticket?.status === 'Resolved';
      if (isResolved) {
        resolvedRows.push(index + 1);
      }
      
      const batchAmountOwed = Number(bc.amount_owed) || 0;
      const totalPaid = Number(master?.total_paid) || 0;
      const outstandingBalance = Math.max(batchAmountOwed - totalPaid, 0);
      
      return [
        batch?.name || 'Unknown',
        bc.name || '',
        bc.nrc_number || '',
        bc.mobile_number || '',
        batchAmountOwed.toFixed(2),
        totalPaid.toFixed(2),
        outstandingBalance.toFixed(2),
        master?.payment_status || 'N/A',
        getAgentName(master?.assigned_agent || null),
        callNotesStr,
        ticket?.status || 'N/A',
        totalCollected.toFixed(2),
        master?.branch_name || '',
        bc.arrear_status || master?.arrear_status || '',
        master?.employer_name || '',
        master?.employer_subdivision || '',
        master?.loan_consultant || '',
        master?.tenure || '',
        lastPaymentDate,
        master?.next_of_kin_name || '',
        master?.next_of_kin_contact || '',
        master?.workplace_contact || '',
        master?.workplace_destination || '',
        (ticket as any)?.ticket_arrear_status || '',
        (ticket as any)?.ticket_payment_status || '',
        (ticket as any)?.employer_reason_for_arrears || ''
      ];
    });

    const batchSuffix = selectedBatchId === 'all' ? 'all-batches' : batches.find(b => b.id === selectedBatchId)?.name || selectedBatchId;
    downloadStyledExcel(rows, headers, `batch-export-${batchSuffix}-${exportFilter}${exportAll ? '-all' : '-worked'}`, resolvedRows);
    toast({ title: "Export Complete", description: `Successfully exported ${filteredCustomers.length} batch customers to Excel` });
  };

  const masterFilteredCount = isAdmin ? masterCustomers.length : getFilteredMasterCustomers().length;
  const batchFilteredCount = isAdmin ? batchCustomers.length : getFilteredBatchCustomers().length;
  const workedOnCount = tickets.filter(t => isTicketWorkedOn(t.id, t.master_customer_id)).length;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Export Data</h1>
        <p className="text-muted-foreground">Download customer and collection data as Excel</p>
      </div>

      {isAdmin && (
        <Alert className="bg-success/10 border-success/30">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertDescription className="text-success">
            <strong>Admin Mode:</strong> Exports will include ALL data system-wide, regardless of who uploaded it. 
            Row count validation ensures complete exports.
          </AlertDescription>
        </Alert>
      )}

      {lastExportStats && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Last export: {lastExportStats.exported} rows exported ({lastExportStats.expected} expected)
            {lastExportStats.expected === lastExportStats.exported ? (
              <Badge className="ml-2 bg-success">Validated</Badge>
            ) : (
              <Badge className="ml-2" variant="destructive">Mismatch</Badge>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="export-all" className="font-medium">Export All Tickets</Label>
              <p className="text-sm text-muted-foreground">
                {exportAll ? "Exporting all tickets regardless of activity" : `Exporting only worked-on tickets (${workedOnCount} of ${tickets.length})`}
              </p>
            </div>
            <Switch id="export-all" checked={exportAll} onCheckedChange={setExportAll} />
          </div>
          {!exportAll && (
            <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground">
              <p className="font-medium mb-1">Worked-on tickets include:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Status changed from Open</li>
                <li>Call notes added</li>
                <li>Payments recorded</li>
                <li>Synced via daily loan book sync</li>
              </ul>
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
                      className={cn("w-[200px] justify-start text-left font-normal", !startDate && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
              
              <div className="space-y-2">
                <Label>End Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-[200px] justify-start text-left font-normal", !endDate && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={endDate} onSelect={setEndDate} initialFocus />
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

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Agent Filter
            </CardTitle>
            <CardDescription>Filter exports by assigned agent</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {(p as any).display_name || p.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="tickets" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="tickets" className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />Tickets
          </TabsTrigger>
          <TabsTrigger value="master" className="flex items-center gap-2">
            <Database className="h-4 w-4" />Master Registry
          </TabsTrigger>
          <TabsTrigger value="batch" className="flex items-center gap-2">
            <Users className="h-4 w-4" />Batch Export
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tickets">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />Export All Tickets
              </CardTitle>
              <CardDescription>
                {isAdmin ? 'Export ALL tickets system-wide with validation' : 'Export tickets assigned to you'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <RadioGroup value={exportFilter} onValueChange={(v) => setExportFilter(v as ExportFilter)}>
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="all" id="ticket-all" />
                  <Label htmlFor="ticket-all" className="flex-1 cursor-pointer">
                    <span className="font-medium">All Tickets</span>
                    <p className="text-sm text-muted-foreground">Export complete ticket list</p>
                  </Label>
                  <span className="text-sm text-muted-foreground">{tickets.length} records</span>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="outstanding" id="ticket-outstanding" />
                  <Label htmlFor="ticket-outstanding" className="flex-1 cursor-pointer">
                    <span className="font-medium">Active (Open + In Progress)</span>
                    <p className="text-sm text-muted-foreground">Tickets not yet resolved</p>
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    {tickets.filter((t) => t.status !== 'Resolved').length} records
                  </span>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="resolved" id="ticket-resolved" />
                  <Label htmlFor="ticket-resolved" className="flex-1 cursor-pointer">
                    <span className="font-medium">Resolved Only</span>
                    <p className="text-sm text-muted-foreground">Completed tickets</p>
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    {tickets.filter((t) => t.status === 'Resolved').length} records
                  </span>
                </div>
              </RadioGroup>
              
              {isAdmin && (
                <div className="space-y-2">
                  <Label>Filter by Batch</Label>
                  <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a batch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Batches</SelectItem>
                      {batches.map((batch) => (
                        <SelectItem key={batch.id} value={batch.id}>
                          {batch.name} ({batch.customer_count} customers)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              <Button 
                onClick={isAdmin ? handleAdminExportTickets : handleExportMaster} 
                disabled={adminExport.isPending}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                {adminExport.isPending ? 'Exporting...' : `Export Tickets (${isAdmin ? 'All' : tickets.length})`}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="master">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />Export Master Customer List
              </CardTitle>
              <CardDescription>
                {isAdmin ? 'Export ALL customers system-wide' : 'Export global customer data with payment history'}
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
                    {masterCustomers.filter((c) => c.payment_status !== 'Fully Paid').length} records
                  </span>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="resolved" id="master-resolved" />
                  <Label htmlFor="master-resolved" className="flex-1 cursor-pointer">
                    <span className="font-medium">Fully Paid Only</span>
                    <p className="text-sm text-muted-foreground">Customers who have paid in full</p>
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    {masterCustomers.filter((c) => c.payment_status === 'Fully Paid').length} records
                  </span>
                </div>
              </RadioGroup>
              <Button 
                onClick={handleExportMaster} 
                disabled={masterFilteredCount === 0 || adminExport.isPending}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                {adminExport.isPending ? 'Exporting...' : `Export Customers (${masterFilteredCount})`}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="batch">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />Export Batch Data
              </CardTitle>
              <CardDescription>
                {isAdmin ? 'Export ALL batch data system-wide' : 'Export customer data per batch'}
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
                        {batch.name} ({batch.customer_count} customers)
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
              <Button 
                onClick={handleExportBatch} 
                disabled={batchFilteredCount === 0 || adminExport.isPending}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                {adminExport.isPending ? 'Exporting...' : `Export Batch Data (${batchFilteredCount})`}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
