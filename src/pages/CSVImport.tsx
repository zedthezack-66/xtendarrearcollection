import { useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import Papa from "papaparse";
import XLSX from "xlsx-js-style";
import { ArrowLeft, Upload, FileText, Check, X, Download, AlertCircle, RefreshCw, TrendingUp, TrendingDown, Bell, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMasterCustomers, useCreateBatch, useProfiles, useBatches } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CSVRow {
  'Customer Name'?: string;
  'NRC Number'?: string;
  'Amount Owed'?: string;
  'Mobile Number'?: string;
  'Assigned Agent'?: string;
  // New loan book fields (all optional)
  'Branch Name'?: string;
  'Arrear Status'?: string;
  'Employer Name'?: string;
  'Employer Subdivision'?: string;
  'Loan Consultant'?: string;
  'Tenure'?: string;
  'Last Payment Date'?: string;
  // New contact fields
  'Next of Kin Name'?: string;
  'Next of Kin Contact'?: string;
  'Workplace Contact'?: string;
  'Workplace Destination'?: string;
  [key: string]: string | undefined;
}

interface ParsedRow {
  rowNumber: number;
  name: string;
  nrcNumber: string;
  amountOwed: number;
  amountOwedIsEmpty: boolean; // true = cell was empty/N/A, false = explicit value (including 0)
  mobileNumber: string;
  assignedAgent: string;
  assignedAgentId: string | null;
  isValid: boolean;
  isValidForUpdate: boolean; // Tolerant validation for update mode (only NRC required)
  errors: string[];
  updateModeErrors: string[]; // Errors specific to update mode (only critical ones)
  existsInMaster: boolean;
  isDuplicateNrc: boolean;
  isDuplicateMobile: boolean;
  // New loan book fields (all nullable)
  branchName: string | null;
  arrearStatus: string | null;
  employerName: string | null;
  employerSubdivision: string | null;
  loanConsultant: string | null;
  tenure: string | null;
  lastPaymentDate: string | null;
  // New contact fields (all nullable)
  nextOfKinName: string | null;
  nextOfKinContact: string | null;
  workplaceContact: string | null;
  workplaceDestination: string | null;
}

const SAMPLE_CSV = `Customer Name,NRC Number,Amount Owed,Mobile Number,Assigned Agent,Next of Kin Name,Next of Kin Contact,Branch Name,Arrear Status,Employer Name,Employer Subdivision,Workplace Contact,Workplace Destination,Loan Consultant,Tenure,Last Payment Date
John Mwanza,123456/10/1,15000,260971234567,Ziba,Mary Mwanza,260977654321,Lusaka Main,60+ Days,Ministry of Health,Finance Dept,260211234567,Cairo Road HQ,Grace Tembo,24 months,2025-12-15
Jane Banda,234567/20/2,0,260972345678,Mary,Peter Banda,260978765432,Ndola Branch,Cleared,Zambia Airways,Operations,260212345678,Kenneth Kaunda Intl,Peter Sakala,12 months,
Peter Phiri,345678/30/3,22000,260973456789,Ziba,Susan Phiri,260979876543,Kitwe Branch,90+ Days,Zambia Sugar,Production,260213456789,Nakambala Estate,Mary Mulenga,36 months,2025-11-20`;

// Helper to detect "empty" values from Excel artifacts
const isEmptyValue = (value: string | undefined | null): boolean => {
  if (value === undefined || value === null) return true;
  const trimmed = value.toString().trim().toLowerCase();
  if (trimmed === '') return true;
  // Excel artifacts and common null representations
  const emptyPatterns = ['#n/a', 'n/a', 'null', '#ref!', '#value!', '#name?', '#div/0!', '-', '--'];
  return emptyPatterns.includes(trimmed);
};

// Helper to clean a string value - returns null if empty/N/A
const cleanString = (value: string | undefined | null): string | null => {
  if (isEmptyValue(value)) return null;
  return value!.toString().trim();
};

// Date validation helper - validates dates in 1900-2100 range, returns null for invalid/empty
const validateAndParseDate = (dateStr: string | undefined | null): string | null => {
  if (isEmptyValue(dateStr)) return null;
  
  const trimmed = dateStr!.toString().trim();
  
  // Try to parse the date
  const date = new Date(trimmed);
  
  // Check if date is valid
  if (isNaN(date.getTime())) return null;
  
  // Check if year is in valid range (1900-2100)
  const year = date.getFullYear();
  if (year < 1900 || year > 2100) return null;
  
  return date.toISOString();
};

// Parse amount - returns { value: number, isEmpty: boolean }
// isEmpty = true means the cell was empty/N/A (no change in update mode)
// isEmpty = false + value = 0 means explicit zero (valid override)
const parseAmount = (amountStr: string | undefined | null): { value: number; isEmpty: boolean } => {
  if (isEmptyValue(amountStr)) {
    return { value: 0, isEmpty: true };
  }
  const cleaned = amountStr!.toString().trim().replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) {
    return { value: 0, isEmpty: true };
  }
  return { value: parsed, isEmpty: false };
};

export default function CSVImport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const { data: masterCustomers = [] } = useMasterCustomers();
  const { data: profiles = [] } = useProfiles();
  const createBatch = useCreateBatch();
  
  const { data: batches = [] } = useBatches();
  
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [batchName, setBatchName] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [uploadMode, setUploadMode] = useState<"new" | "existing" | "update" | "daily">("new");
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [dailySyncResult, setDailySyncResult] = useState<{
    processed: number;
    updated: number;
    maintained: number;
    resolved: number;
    reopened: number;
    not_found: number;
    errors: string[];
  } | null>(null);

  const existingNrcNumbers = new Set(masterCustomers.map((c) => c.nrc_number));
  
  // Map display_name to agent ID
  const agentDisplayNameMap = new Map(
    profiles
      .filter(p => p.display_name)
      .map(p => [p.display_name!.toLowerCase(), p.id])
  );

  const processRows = (data: CSVRow[]) => {
    // First pass: collect all NRCs and mobile numbers to detect duplicates
    const nrcOccurrences = new Map<string, number[]>();
    const mobileOccurrences = new Map<string, number[]>();
    
    data.forEach((row, index) => {
      const nrc = row['NRC Number']?.toString().trim() || '';
      const mobile = row['Mobile Number']?.toString().trim() || '';
      
      if (nrc) {
        if (!nrcOccurrences.has(nrc)) nrcOccurrences.set(nrc, []);
        nrcOccurrences.get(nrc)!.push(index + 1);
      }
      if (mobile) {
        if (!mobileOccurrences.has(mobile)) mobileOccurrences.set(mobile, []);
        mobileOccurrences.get(mobile)!.push(index + 1);
      }
    });
    
    // Find duplicates
    const duplicateNrcs = new Set<string>();
    const duplicateMobiles = new Set<string>();
    
    nrcOccurrences.forEach((rows, nrc) => {
      if (rows.length > 1) duplicateNrcs.add(nrc);
    });
    mobileOccurrences.forEach((rows, mobile) => {
      if (rows.length > 1) duplicateMobiles.add(mobile);
    });
    
    // Second pass: build parsed rows with validation
    const parsed: ParsedRow[] = data.map((row, index) => {
      const rowNumber = index + 1;
      
      // Clean critical fields
      const name = cleanString(row['Customer Name']) || '';
      const nrcNumber = cleanString(row['NRC Number']) || '';
      const mobileNumber = cleanString(row['Mobile Number']) || '';
      const assignedAgent = cleanString(row['Assigned Agent']) || '';
      
      // Parse amount with isEmpty flag
      const amountResult = parseAmount(row['Amount Owed']);
      const amountOwed = amountResult.value;
      const amountOwedIsEmpty = amountResult.isEmpty;
      
      // Parse optional fields - all return null if empty/N/A
      const branchName = cleanString(row['Branch Name']);
      const arrearStatus = cleanString(row['Arrear Status']);
      const employerName = cleanString(row['Employer Name']);
      const employerSubdivision = cleanString(row['Employer Subdivision']);
      const loanConsultant = cleanString(row['Loan Consultant']);
      const tenure = cleanString(row['Tenure']);
      const lastPaymentDate = cleanString(row['Last Payment Date']);
      const nextOfKinName = cleanString(row['Next of Kin Name']);
      const nextOfKinContact = cleanString(row['Next of Kin Contact']);
      const workplaceContact = cleanString(row['Workplace Contact']);
      const workplaceDestination = cleanString(row['Workplace Destination']);
      
      const errors: string[] = [];
      const updateModeErrors: string[] = [];
      
      // CRITICAL: NRC is always required
      if (!nrcNumber) {
        errors.push('NRC Number is required');
        updateModeErrors.push('NRC Number is required');
      }
      
      // Duplicate detection (critical for all modes)
      const isDuplicateNrc = duplicateNrcs.has(nrcNumber);
      const isDuplicateMobile = mobileNumber && duplicateMobiles.has(mobileNumber);
      
      if (isDuplicateNrc) {
        const otherRows = nrcOccurrences.get(nrcNumber)!.filter(r => r !== rowNumber);
        const msg = `Duplicate NRC in file (also in row${otherRows.length > 1 ? 's' : ''} ${otherRows.join(', ')})`;
        errors.push(msg);
        updateModeErrors.push(msg);
      }
      
      // For new batch/add modes: name, agent are required
      if (!name) errors.push('Customer Name is required');
      if (!assignedAgent) errors.push('Assigned Agent is required');
      
      // Amount: if explicit value, must be 0 or positive
      if (!amountOwedIsEmpty && amountOwed < 0) {
        errors.push('Amount Owed cannot be negative');
        updateModeErrors.push('Amount Owed cannot be negative');
      }
      
      // Map agent display_name to ID
      const assignedAgentId = assignedAgent ? agentDisplayNameMap.get(assignedAgent.toLowerCase()) || null : null;
      if (assignedAgent && !assignedAgentId) {
        errors.push(`Agent "${assignedAgent}" not found in system`);
        // For update mode, unknown agent is non-critical - just won't update agent
      }
      
      // Duplicate mobile is a warning, not blocking
      if (isDuplicateMobile) {
        const otherRows = mobileOccurrences.get(mobileNumber)!.filter(r => r !== rowNumber);
        errors.push(`Duplicate mobile in file (also in row${otherRows.length > 1 ? 's' : ''} ${otherRows.join(', ')})`);
      }
      
      const existsInMaster = existingNrcNumbers.has(nrcNumber);
      
      return {
        rowNumber,
        name,
        nrcNumber,
        amountOwed,
        amountOwedIsEmpty,
        mobileNumber,
        assignedAgent,
        assignedAgentId,
        isValid: errors.length === 0,
        isValidForUpdate: updateModeErrors.length === 0,
        errors,
        updateModeErrors,
        existsInMaster,
        isDuplicateNrc,
        isDuplicateMobile: !!isDuplicateMobile,
        // Loan book fields (nullable)
        branchName,
        arrearStatus,
        employerName,
        employerSubdivision,
        loanConsultant,
        tenure,
        lastPaymentDate,
        // Contact fields (nullable)
        nextOfKinName,
        nextOfKinContact,
        workplaceContact,
        workplaceDestination,
      };
    });
    setParsedData(parsed);
  };

  const parseCSV = (file: File) => {
    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        processRows(results.data);
      },
      error: (error) => {
        toast({
          title: "Parse Error",
          description: error.message,
          variant: "destructive",
        });
      },
    });
  };

  const parseExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json<CSVRow>(worksheet);
        processRows(jsonData);
      } catch (error) {
        toast({
          title: "Parse Error",
          description: "Failed to parse Excel file",
          variant: "destructive",
        });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const parseFile = (file: File) => {
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    if (isExcel) {
      parseExcel(file);
    } else {
      parseCSV(file);
    }
  };

  const isValidFile = (file: File) => {
    return file.type === 'text/csv' || 
           file.name.endsWith('.csv') || 
           file.name.endsWith('.xlsx') || 
           file.name.endsWith('.xls');
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && isValidFile(droppedFile)) {
      setFile(droppedFile);
      parseFile(droppedFile);
    } else {
      toast({
        title: "Invalid File",
        description: "Please upload a CSV or Excel file",
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      parseFile(selectedFile);
      setDailySyncResult(null); // Reset daily sync result when new file selected
    }
  };

  // Handle Daily Update (Loan Book Reconciliation) mode
  const handleDailySync = async () => {
    // Parse the file for daily update format (NRC, Amount, Days, Date)
    const dailyData = parsedData
      .filter(r => r.nrcNumber) // Only rows with NRC
      .map(r => ({
        nrc_number: r.nrcNumber,
        arrears_amount: r.amountOwedIsEmpty ? null : r.amountOwed,
        days_in_arrears: null as number | null, // Will be parsed from CSV if available
        last_payment_date: r.lastPaymentDate,
      }));

    if (dailyData.length === 0) {
      toast({ title: "No Valid Data", description: "No valid NRC numbers found in file.", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    setImportProgress(10);
    setDailySyncResult(null);

    try {
      const CHUNK_SIZE = 500;
      let totalProcessed = 0;
      let totalUpdated = 0;
      let totalMaintained = 0;
      let totalNotFound = 0;
      let totalResolved = 0;
      let totalReopened = 0;
      let allErrors: string[] = [];

      for (let i = 0; i < dailyData.length; i += CHUNK_SIZE) {
        const chunk = dailyData.slice(i, i + CHUNK_SIZE);
        
        const { data, error } = await supabase.rpc('process_loan_book_sync', {
          p_sync_data: JSON.stringify(chunk),
        });
        
        if (error) throw error;
        
        const result = data as any;
        totalProcessed += result.processed || 0;
        totalUpdated += result.updated || 0;
        totalMaintained += result.maintained || 0;
        totalNotFound += result.not_found || 0;
        totalResolved += result.resolved || 0;
        totalReopened += result.reopened || 0;
        allErrors = [...allErrors, ...(result.errors || [])];
        
        setImportProgress(10 + ((i + chunk.length) / dailyData.length) * 80);
      }

      setImportProgress(100);
      
      setDailySyncResult({
        processed: totalProcessed,
        updated: totalUpdated,
        maintained: totalMaintained,
        resolved: totalResolved,
        reopened: totalReopened,
        not_found: totalNotFound,
        errors: allErrors,
      });

      toast({
        title: "Daily Update Completed",
        description: `${totalUpdated} updated, ${totalResolved} resolved, ${totalReopened} reopened, ${totalMaintained} maintained`,
      });
    } catch (error: any) {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleImport = async () => {
    // Daily mode has its own logic - no batch selection needed
    if (uploadMode === "daily") {
      await handleDailySync();
      return;
    }
    
    if (uploadMode === "new") {
      if (!batchName.trim()) {
        toast({ title: "Batch Name Required", description: "Please enter a name for this batch", variant: "destructive" });
        return;
      }
      if (!institutionName.trim()) {
        toast({ title: "Institution Name Required", description: "Please enter the institution name", variant: "destructive" });
        return;
      }
    } else {
      // Both "existing" and "update" modes require batch selection
      if (!selectedBatchId) {
        toast({ title: "Batch Required", description: "Please select an existing batch", variant: "destructive" });
        return;
      }
    }

    // Use different validation based on mode
    const validRows = uploadMode === "update" 
      ? parsedData.filter((r) => r.isValidForUpdate)
      : parsedData.filter((r) => r.isValid);
      
    if (validRows.length === 0) {
      const msg = uploadMode === "update" 
        ? "There are no valid rows to import. Ensure all rows have valid NRC Numbers."
        : "There are no valid rows to import. Ensure all rows have valid Assigned Agent names.";
      toast({ title: "No Valid Data", description: msg, variant: "destructive" });
      return;
    }

    setIsImporting(true);
    setImportProgress(0);

    const CHUNK_SIZE = 100;

    try {
      let batch: { id: string; name: string; customer_count: number; total_amount: number };
      
      if (uploadMode === "new") {
        // Create new batch
        batch = await createBatch.mutateAsync({
          name: batchName.trim(),
          institution_name: institutionName.trim(),
          customer_count: validRows.length,
          total_amount: validRows.reduce((sum, r) => sum + r.amountOwed, 0),
        });
      } else {
        // Use existing batch for both "existing" and "update" modes
        const existingBatch = batches.find(b => b.id === selectedBatchId);
        if (!existingBatch) {
          throw new Error("Selected batch not found");
        }
        batch = {
          id: existingBatch.id,
          name: existingBatch.name,
          customer_count: existingBatch.customer_count,
          total_amount: Number(existingBatch.total_amount),
        };
      }

      setImportProgress(10);

      // =====================================================
      // MODULE B: UPDATE EXISTING BATCH INFO (update mode)
      // Only updates existing customers in the batch - NO new customers/tickets
      // =====================================================
      if (uploadMode === "update") {
        // Fetch existing batch_customers for this batch
        const { data: existingBatchCustomers } = await supabase
          .from('batch_customers')
          .select('nrc_number, master_customer_id')
          .eq('batch_id', batch.id);
        
        const existingNrcsInBatch = new Map(
          existingBatchCustomers?.map(bc => [bc.nrc_number, bc.master_customer_id]) || []
        );

        let updatedCount = 0;
        let skippedCount = 0;
        let amountDelta = 0;

        for (const row of validRows) {
          // Skip if NRC is NOT in this batch (update mode only updates existing)
          if (!existingNrcsInBatch.has(row.nrcNumber)) {
            skippedCount++;
            continue;
          }

          const masterCustomerId = existingNrcsInBatch.get(row.nrcNumber);
          
          // Fetch current values to calculate amount delta (only if we're updating amount)
          let amountToUpdate: number | null = null;
          
          if (!row.amountOwedIsEmpty) {
            // Explicit amount value (including 0) - will update
            const { data: currentBatchCustomer } = await supabase
              .from('batch_customers')
              .select('amount_owed')
              .eq('batch_id', batch.id)
              .eq('nrc_number', row.nrcNumber)
              .single();
            
            const oldAmount = currentBatchCustomer?.amount_owed || 0;
            amountDelta += row.amountOwed - oldAmount;
            amountToUpdate = row.amountOwed;
          }

          // Update master_customers with COALESCE pattern (non-empty only)
          const masterUpdate: Record<string, any> = {};
          if (row.name) masterUpdate.name = row.name;
          if (row.mobileNumber) masterUpdate.mobile_number = row.mobileNumber;
          if (row.branchName) masterUpdate.branch_name = row.branchName;
          if (row.employerName) masterUpdate.employer_name = row.employerName;
          if (row.employerSubdivision) masterUpdate.employer_subdivision = row.employerSubdivision;
          if (row.loanConsultant) masterUpdate.loan_consultant = row.loanConsultant;
          if (row.tenure) masterUpdate.tenure = row.tenure;
          if (row.nextOfKinName) masterUpdate.next_of_kin_name = row.nextOfKinName;
          if (row.nextOfKinContact) masterUpdate.next_of_kin_contact = row.nextOfKinContact;
          if (row.workplaceContact) masterUpdate.workplace_contact = row.workplaceContact;
          if (row.workplaceDestination) masterUpdate.workplace_destination = row.workplaceDestination;
          
          const parsedDate = validateAndParseDate(row.lastPaymentDate);
          if (parsedDate) {
            masterUpdate.last_payment_date = parsedDate;
            masterUpdate.loan_book_last_payment_date = parsedDate;
          }

          if (Object.keys(masterUpdate).length > 0) {
            await supabase.from('master_customers').update(masterUpdate).eq('id', masterCustomerId);
          }

          // Update batch_customers - only update amount if explicit value provided
          const batchCustomerUpdate: Record<string, any> = {};
          if (amountToUpdate !== null) {
            batchCustomerUpdate.amount_owed = amountToUpdate;
          }
          if (row.name) batchCustomerUpdate.name = row.name;
          if (row.mobileNumber) batchCustomerUpdate.mobile_number = row.mobileNumber;
          if (row.arrearStatus) batchCustomerUpdate.arrear_status = row.arrearStatus;
          if (row.assignedAgentId) batchCustomerUpdate.assigned_agent_id = row.assignedAgentId;
          if (parsedDate) batchCustomerUpdate.last_payment_date = parsedDate;

          if (Object.keys(batchCustomerUpdate).length > 0) {
            await supabase.from('batch_customers').update(batchCustomerUpdate)
              .eq('batch_id', batch.id)
              .eq('nrc_number', row.nrcNumber);
          }

          // Update ticket - only update amount if explicit value provided
          const ticketUpdate: Record<string, any> = {};
          if (amountToUpdate !== null) {
            ticketUpdate.amount_owed = amountToUpdate;
            // If amount = 0, resolve the ticket
            if (amountToUpdate === 0) {
              ticketUpdate.status = 'Resolved';
              ticketUpdate.resolved_date = new Date().toISOString();
            }
          }
          if (row.name) ticketUpdate.customer_name = row.name;
          if (row.mobileNumber) ticketUpdate.mobile_number = row.mobileNumber;
          if (row.assignedAgentId) ticketUpdate.assigned_agent = row.assignedAgentId;

          if (Object.keys(ticketUpdate).length > 0) {
            await supabase.from('tickets').update(ticketUpdate)
              .eq('batch_id', batch.id)
              .eq('nrc_number', row.nrcNumber);
          }

          updatedCount++;
          setImportProgress(10 + (updatedCount / validRows.length) * 80);
        }

        // Update batch total_amount with the delta
        if (amountDelta !== 0) {
          await supabase.from('batches').update({
            total_amount: Math.max(0, batch.total_amount + amountDelta),
          }).eq('id', batch.id);
        }

        setImportProgress(100);
        
        const message = `Updated ${updatedCount} customers in batch "${batch.name}"${skippedCount > 0 ? `, skipped ${skippedCount} (not in batch)` : ''}`;
        toast({ title: "Update Complete", description: message });
        navigate('/customers');
        return;
      }

      // =====================================================
      // MODULE A: ADD TO EXISTING BATCH / CREATE NEW BATCH
      // Only creates NEW customers - skips existing NRCs entirely
      // =====================================================

      // Fetch existing batch_customers for this batch to check for duplicates
      const { data: existingBatchCustomers } = await supabase
        .from('batch_customers')
        .select('nrc_number, master_customer_id')
        .eq('batch_id', batch.id);
      
      const existingNrcsInBatch = new Set(existingBatchCustomers?.map(bc => bc.nrc_number) || []);

      // For "existing" mode: ONLY add new customers, skip ALL existing NRCs
      // For "new" mode: process normally (existing in master creates new ticket in batch)
      let newCustomerRows: ParsedRow[];
      let skippedExistingRows: ParsedRow[];
      
      if (uploadMode === "existing") {
        // MODULE A: Skip ANY row where NRC already exists in master (strict rule)
        newCustomerRows = validRows.filter(r => !r.existsInMaster);
        skippedExistingRows = validRows.filter(r => r.existsInMaster);
      } else {
        // New batch mode: process all - new to master gets created, existing to master gets ticket
        newCustomerRows = validRows.filter(r => !r.existsInMaster);
        skippedExistingRows = [];
      }
      
      // For new batch mode, also handle existing master customers getting new tickets
      const existingInMasterRows = uploadMode === "new" 
        ? validRows.filter(r => r.existsInMaster && !existingNrcsInBatch.has(r.nrcNumber))
        : [];

      let newlyAddedCount = 0;
      let skippedCount = skippedExistingRows.length;

      // Process new customers in chunks
      if (newCustomerRows.length > 0) {
        for (let i = 0; i < newCustomerRows.length; i += CHUNK_SIZE) {
          const chunk = newCustomerRows.slice(i, i + CHUNK_SIZE);
          
          const newMasterCustomers = chunk.map((row) => ({
            nrc_number: row.nrcNumber,
            name: row.name,
            mobile_number: row.mobileNumber || null,
            total_owed: row.amountOwed,
            outstanding_balance: row.amountOwed,
            loan_book_arrears: row.amountOwed,
            assigned_agent: row.assignedAgentId,
            branch_name: row.branchName || null,
            arrear_status: row.arrearStatus || null,
            employer_name: row.employerName || null,
            employer_subdivision: row.employerSubdivision || null,
            loan_consultant: row.loanConsultant || null,
            tenure: row.tenure || null,
            last_payment_date: validateAndParseDate(row.lastPaymentDate),
            loan_book_last_payment_date: validateAndParseDate(row.lastPaymentDate),
            next_of_kin_name: row.nextOfKinName || null,
            next_of_kin_contact: row.nextOfKinContact || null,
            workplace_contact: row.workplaceContact || null,
            workplace_destination: row.workplaceDestination || null,
          }));

          const { data: insertedCustomers, error: customersError } = await supabase
            .from('master_customers')
            .insert(newMasterCustomers)
            .select();

          if (customersError) throw customersError;

          if (insertedCustomers && insertedCustomers.length > 0) {
            newlyAddedCount += insertedCustomers.length;

            // Create tickets for new customers
            const newTickets = insertedCustomers.map(mc => {
              const row = chunk.find(r => r.nrcNumber === mc.nrc_number);
              const amountOwed = row?.amountOwed ?? 0;
              return {
                master_customer_id: mc.id,
                batch_id: batch.id,
                customer_name: mc.name,
                nrc_number: mc.nrc_number,
                mobile_number: mc.mobile_number,
                amount_owed: amountOwed,
                assigned_agent: mc.assigned_agent,
                priority: amountOwed === 0 ? 'Low' : 'High',
                status: amountOwed === 0 ? 'Resolved' : 'Open',
                resolved_date: amountOwed === 0 ? new Date().toISOString() : null,
              };
            });

            const { error: ticketsError } = await supabase
              .from('tickets')
              .insert(newTickets);

            if (ticketsError) throw ticketsError;

            // Create batch_customers entries
            const newBatchCustomers = insertedCustomers.map(mc => {
              const row = chunk.find(r => r.nrcNumber === mc.nrc_number);
              return {
                batch_id: batch.id,
                master_customer_id: mc.id,
                nrc_number: mc.nrc_number,
                name: mc.name,
                mobile_number: mc.mobile_number,
                amount_owed: row?.amountOwed ?? 0,
                assigned_agent_id: row?.assignedAgentId,
                arrear_status: row?.arrearStatus || null,
                last_payment_date: validateAndParseDate(row?.lastPaymentDate),
              };
            });

            const { error: batchCustError } = await supabase
              .from('batch_customers')
              .insert(newBatchCustomers);

            if (batchCustError) throw batchCustError;
          }

          setImportProgress(10 + (i / newCustomerRows.length) * 40);
        }
      }

      setImportProgress(50);

      // Handle existing master customers for NEW BATCH mode only
      if (existingInMasterRows.length > 0) {
        for (let i = 0; i < existingInMasterRows.length; i += CHUNK_SIZE) {
          const chunk = existingInMasterRows.slice(i, i + CHUNK_SIZE);
          const batchCustomersForExisting = [];

          for (const row of chunk) {
            const existingMaster = masterCustomers.find(mc => mc.nrc_number === row.nrcNumber);
            if (existingMaster) {
              // Only populate NULL/empty static fields
              const masterUpdate: Record<string, any> = {};
              if (!existingMaster.mobile_number && row.mobileNumber) {
                masterUpdate.mobile_number = row.mobileNumber;
              }
              if (!existingMaster.branch_name && row.branchName) {
                masterUpdate.branch_name = row.branchName;
              }
              if (!existingMaster.employer_name && row.employerName) {
                masterUpdate.employer_name = row.employerName;
              }
              if (!existingMaster.employer_subdivision && row.employerSubdivision) {
                masterUpdate.employer_subdivision = row.employerSubdivision;
              }
              if (!existingMaster.loan_consultant && row.loanConsultant) {
                masterUpdate.loan_consultant = row.loanConsultant;
              }
              if (!existingMaster.tenure && row.tenure) {
                masterUpdate.tenure = row.tenure;
              }
              if (!(existingMaster as any).next_of_kin_name && row.nextOfKinName) {
                masterUpdate.next_of_kin_name = row.nextOfKinName;
              }
              if (!(existingMaster as any).next_of_kin_contact && row.nextOfKinContact) {
                masterUpdate.next_of_kin_contact = row.nextOfKinContact;
              }
              if (!(existingMaster as any).workplace_contact && row.workplaceContact) {
                masterUpdate.workplace_contact = row.workplaceContact;
              }
              if (!(existingMaster as any).workplace_destination && row.workplaceDestination) {
                masterUpdate.workplace_destination = row.workplaceDestination;
              }
              
              if (Object.keys(masterUpdate).length > 0) {
                await supabase.from('master_customers').update(masterUpdate).eq('id', existingMaster.id);
              }

              batchCustomersForExisting.push({
                batch_id: batch.id,
                master_customer_id: existingMaster.id,
                nrc_number: row.nrcNumber,
                name: row.name,
                mobile_number: row.mobileNumber || null,
                amount_owed: row.amountOwed,
                assigned_agent_id: row.assignedAgentId,
                arrear_status: row.arrearStatus || null,
                last_payment_date: validateAndParseDate(row.lastPaymentDate),
              });

              newlyAddedCount++;

              // Create ticket for this batch
              const ticketStatus = row.amountOwed === 0 ? 'Resolved' : 'Open';
              const ticketPriority = row.amountOwed === 0 ? 'Low' : 'High';
              await supabase.from('tickets').insert({
                master_customer_id: existingMaster.id,
                batch_id: batch.id,
                customer_name: row.name,
                nrc_number: row.nrcNumber,
                mobile_number: row.mobileNumber || null,
                amount_owed: row.amountOwed,
                assigned_agent: row.assignedAgentId,
                priority: ticketPriority,
                status: ticketStatus,
                resolved_date: row.amountOwed === 0 ? new Date().toISOString() : null,
              });
            }
          }

          if (batchCustomersForExisting.length > 0) {
            const { error: existingBatchError } = await supabase
              .from('batch_customers')
              .insert(batchCustomersForExisting);

            if (existingBatchError) throw existingBatchError;
          }

          setImportProgress(50 + (i / existingInMasterRows.length) * 30);
        }
      }

      setImportProgress(90);

      // Update batch totals for "existing" mode
      if (uploadMode === "existing" && newlyAddedCount > 0) {
        const addedAmount = newCustomerRows.reduce((sum, r) => sum + r.amountOwed, 0);
        await supabase.from('batches').update({
          customer_count: batch.customer_count + newlyAddedCount,
          total_amount: batch.total_amount + addedAmount,
        }).eq('id', batch.id);
      }

      setImportProgress(100);
      
      let message: string;
      if (uploadMode === "new") {
        message = `Successfully created batch "${batchName}" with ${newlyAddedCount} customers`;
      } else {
        const parts = [`Added ${newlyAddedCount} new customers`];
        if (skippedCount > 0) parts.push(`skipped ${skippedCount} existing NRCs`);
        message = `${parts.join(', ')} to batch "${batch.name}"`;
      }
      toast({ title: "Import Complete", description: message });
      navigate('/customers');
    } catch (error: any) {
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_customers.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Use mode-appropriate validation for counts
  // Daily mode only needs valid NRC
  const validCount = uploadMode === "daily" 
    ? parsedData.filter((r) => r.nrcNumber && !r.isDuplicateNrc).length
    : uploadMode === "update" 
      ? parsedData.filter((r) => r.isValidForUpdate).length
      : parsedData.filter((r) => r.isValid).length;
  const invalidCount = uploadMode === "daily"
    ? parsedData.filter((r) => !r.nrcNumber || r.isDuplicateNrc).length
    : uploadMode === "update"
      ? parsedData.filter((r) => !r.isValidForUpdate).length
      : parsedData.filter((r) => !r.isValid).length;
  const existingCount = parsedData.filter((r) => r.existsInMaster && (uploadMode === "update" || uploadMode === "daily" ? r.isValidForUpdate : r.isValid)).length;
  const rejectedAgentCount = parsedData.filter((r) => r.errors.some(e => e.includes('not found'))).length;
  const duplicateNrcCount = parsedData.filter((r) => r.isDuplicateNrc).length;
  const duplicateMobileCount = parsedData.filter((r) => r.isDuplicateMobile).length;
  // Daily mode doesn't block on agent/name errors - only duplicate NRCs
  const hasBlockingErrors = uploadMode === "daily" 
    ? duplicateNrcCount > 0 
    : invalidCount > 0;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);
  };

  const getAgentDisplayName = (agentId: string | null) => {
    if (!agentId) return '-';
    const profile = profiles.find(p => p.id === agentId);
    return profile?.display_name || profile?.full_name || '-';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/customers" className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-input bg-background hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Create New Batch</h1>
          <p className="text-muted-foreground">Upload CSV/Excel to create a new batch with customers and tickets</p>
        </div>
        <Button variant="outline" onClick={downloadSample}>
          <Download className="h-4 w-4 mr-2" />
          Download Sample
        </Button>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>CSV Column Requirements</AlertTitle>
        <AlertDescription>
          {uploadMode === "daily" ? (
            <>
              <strong>Daily Update</strong> requires: <strong>NRC Number</strong> and <strong>Amount Owed</strong>. 
              Optional: Days in Arrears, Last Payment Date. <strong>Amount = 0</strong> resolves tickets. No names or agent columns needed.
            </>
          ) : uploadMode === "update" ? (
            <>
              <strong>NRC Number</strong> is required. All other fields are optional — empty cells or #N/A values will not overwrite existing data.
              <strong> Amount Owed = 0</strong> is valid and will clear arrears.
            </>
          ) : (
            <>
              Your file must have: <strong>Customer Name</strong>, <strong>NRC Number</strong>, <strong>Amount Owed</strong>, <strong>Mobile Number</strong>, <strong>Assigned Agent</strong> (must match agent's display name).
              Empty cells, #N/A, and N/A values are treated as blank.
            </>
          )}
        </AlertDescription>
      </Alert>

      {/* Hide agents card for daily mode - not needed */}
      {profiles.length > 0 && uploadMode !== "daily" && (
        <Card>
          <CardHeader>
            <CardTitle>Available Agents</CardTitle>
            <CardDescription>Use these display names in the "Assigned Agent" column</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {profiles.filter(p => p.display_name).map(p => (
                <Badge key={p.id} variant="outline" className="text-sm">
                  {p.display_name}
                </Badge>
              ))}
              {profiles.filter(p => p.display_name).length === 0 && (
                <p className="text-muted-foreground text-sm">
                  No agents have set their display name yet. Agents must set their display name in Settings first.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Upload Mode</CardTitle>
          <CardDescription>Choose how this upload should be processed</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup 
            value={uploadMode} 
            onValueChange={(v) => setUploadMode(v as "new" | "existing" | "update" | "daily")} 
            className="grid gap-3"
          >
            {/* New Batch Option */}
            <div className={`flex items-start space-x-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${uploadMode === "new" ? "border-primary bg-primary/5" : "border-muted hover:bg-muted/50"}`}>
              <RadioGroupItem value="new" id="new-batch" className="mt-1" />
              <div className="flex-1">
                <Label htmlFor="new-batch" className="text-base font-medium cursor-pointer">
                  🆕 Create New Batch
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Creates a fresh batch. All uploaded customers will be added. If an NRC already exists in the system, a new ticket will be created for this batch.
                </p>
              </div>
            </div>
            
            {/* Add to Existing Option */}
            <div className={`flex items-start space-x-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${uploadMode === "existing" ? "border-primary bg-primary/5" : "border-muted hover:bg-muted/50"}`}>
              <RadioGroupItem value="existing" id="existing-batch" className="mt-1" />
              <div className="flex-1">
                <Label htmlFor="existing-batch" className="text-base font-medium cursor-pointer">
                  ➕ Add to Existing Batch
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Adds <strong>only NEW customers</strong> (by NRC) to an existing batch. Customers already in the batch are skipped — no duplicates, no overwrites.
                </p>
              </div>
            </div>
            
            {/* Update Existing Option */}
            <div className={`flex items-start space-x-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${uploadMode === "update" ? "border-primary bg-primary/5" : "border-muted hover:bg-muted/50"}`}>
              <RadioGroupItem value="update" id="update-batch" className="mt-1" />
              <div className="flex-1">
                <Label htmlFor="update-batch" className="text-base font-medium cursor-pointer">
                  🔄 Update Existing Batch Info
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Updates data for customers <strong>already in the batch</strong>. Empty cells or #N/A values won't overwrite existing data. Amount Owed = 0 clears arrears and resolves tickets.
                </p>
              </div>
            </div>
            
            {/* Daily Update (Loan Book Reconciliation) - Admin Only */}
            {isAdmin && (
              <div className={`flex items-start space-x-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${uploadMode === "daily" ? "border-primary bg-primary/5" : "border-muted hover:bg-muted/50"}`}>
                <RadioGroupItem value="daily" id="daily-update" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="daily-update" className="text-base font-medium cursor-pointer">
                    📊 Daily Update (Loan Book)
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    <strong>Reconciliation only.</strong> Updates arrears for existing NRCs from loan book data. No new customers or tickets created.
                    Detects: Cleared, Reduced, Increased, Reopened, Maintained movements. Notifies agents automatically.
                  </p>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Required: <Badge variant="outline" className="text-xs">NRC Number</Badge> <Badge variant="outline" className="text-xs">Amount Owed</Badge> 
                    Optional: <Badge variant="outline" className="text-xs">Days in Arrears</Badge> <Badge variant="outline" className="text-xs">Last Payment Date</Badge>
                  </div>
                </div>
              </div>
            )}
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Batch Details - Hide for Daily mode since it doesn't use batches */}
      {uploadMode !== "daily" && (
        <Card>
          <CardHeader>
            <CardTitle>Batch Details</CardTitle>
            <CardDescription>
              {uploadMode === "new" 
                ? "Enter details for your new batch" 
                : "Select an existing batch to modify"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">

            {uploadMode === "new" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="batchName">Batch Name *</Label>
                  <Input id="batchName" placeholder="e.g., MTN Loans Nov 2025" value={batchName} onChange={(e) => setBatchName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="institutionName">Institution Name *</Label>
                  <Input id="institutionName" placeholder="e.g., MTN Mobile Money" value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="existingBatch">Select Batch *</Label>
                <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an existing batch" />
                  </SelectTrigger>
                  <SelectContent>
                    {batches.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} ({b.customer_count} customers)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {batches.length === 0 && (
                  <p className="text-sm text-muted-foreground">No existing batches. Create a new batch first.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!file && (
        <Card>
          <CardContent className="p-6">
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Drag and drop your CSV or Excel file</h3>
              <p className="text-muted-foreground mb-4">Supports .csv, .xlsx, and .xls files</p>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileSelect} className="hidden" id="csv-upload" />
              <Button asChild variant="outline">
                <label htmlFor="csv-upload" className="cursor-pointer">
                  <FileText className="h-4 w-4 mr-2" />
                  Select File
                </label>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {file && parsedData.length > 0 && (
        <>
          {/* Blocking Error Banner */}
          {hasBlockingErrors && (
            <Alert variant="destructive" className="border-2">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="text-lg">Upload Blocked - {invalidCount} Error(s) Found</AlertTitle>
              <AlertDescription>
                <p className="mb-2">Fix the following issues before importing:</p>
                <ul className="list-disc pl-4 space-y-1">
                  {duplicateNrcCount > 0 && <li><strong>{duplicateNrcCount}</strong> duplicate NRC number(s) in file</li>}
                  {duplicateMobileCount > 0 && <li><strong>{duplicateMobileCount}</strong> duplicate mobile number(s) in file</li>}
                  {rejectedAgentCount > 0 && <li><strong>{rejectedAgentCount}</strong> row(s) with invalid agent names</li>}
                  {parsedData.filter(r => r.errors.some(e => e.includes('required'))).length > 0 && 
                    <li><strong>{parsedData.filter(r => r.errors.some(e => e.includes('required'))).length}</strong> row(s) with missing required fields</li>}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-6">
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-muted"><FileText className="h-5 w-5 text-muted-foreground" /></div><div><p className="text-sm text-muted-foreground">File</p><p className="font-medium truncate max-w-[100px]">{file.name}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-success/10"><Check className="h-5 w-5 text-success" /></div><div><p className="text-sm text-muted-foreground">Valid Rows</p><p className="font-medium text-success">{validCount}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-destructive/10"><X className="h-5 w-5 text-destructive" /></div><div><p className="text-sm text-muted-foreground">Invalid Rows</p><p className="font-medium text-destructive">{invalidCount}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-warning/10"><AlertCircle className="h-5 w-5 text-warning" /></div><div><p className="text-sm text-muted-foreground">Duplicate NRC</p><p className="font-medium text-warning">{duplicateNrcCount}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-warning/10"><AlertCircle className="h-5 w-5 text-warning" /></div><div><p className="text-sm text-muted-foreground">Duplicate Mobile</p><p className="font-medium text-warning">{duplicateMobileCount}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-info/10"><AlertCircle className="h-5 w-5 text-info" /></div><div><p className="text-sm text-muted-foreground">Existing NRCs</p><p className="font-medium text-info">{existingCount}</p></div></div></CardContent></Card>
          </div>

          {existingCount > 0 && !hasBlockingErrors && uploadMode === "new" && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Existing Customers Found</AlertTitle>
              <AlertDescription>{existingCount} customer(s) already exist in master. New tickets will be created for this batch.</AlertDescription>
            </Alert>
          )}

          {existingCount > 0 && !hasBlockingErrors && uploadMode === "existing" && (
            <Alert className="border-warning bg-warning/10">
              <AlertCircle className="h-4 w-4 text-warning" />
              <AlertTitle className="text-warning">Will Skip {existingCount} Existing NRCs</AlertTitle>
              <AlertDescription>{existingCount} customer(s) already exist and will be skipped. Only {validCount - existingCount} new customers will be added.</AlertDescription>
            </Alert>
          )}

          {uploadMode === "update" && !hasBlockingErrors && (
            <Alert className="border-info bg-info/10">
              <AlertCircle className="h-4 w-4 text-info" />
              <AlertTitle className="text-info">Update Mode Active</AlertTitle>
              <AlertDescription>Only customers already in the selected batch will be updated. NRCs not in the batch will be skipped.</AlertDescription>
            </Alert>
          )}

          {uploadMode === "daily" && !hasBlockingErrors && (
            <Alert className="border-primary bg-primary/10">
              <RefreshCw className="h-4 w-4 text-primary" />
              <AlertTitle className="text-primary">Daily Update Mode (Loan Book)</AlertTitle>
              <AlertDescription>
                Reconciliation only. Updates arrears for existing NRCs. Detects: Cleared, Reduced, Increased, Reopened, Maintained movements. Agents will be notified automatically.
              </AlertDescription>
            </Alert>
          )}

          {/* Daily Sync Results Display */}
          {uploadMode === "daily" && dailySyncResult && (
            <Card className="border-primary">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <CheckCircle className="h-5 w-5" />
                  Daily Update Completed
                </CardTitle>
                <CardDescription>Summary of arrears reconciliation from loan book</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="p-3 bg-muted/50 rounded-lg text-center">
                    <p className="text-2xl font-bold">{dailySyncResult.processed}</p>
                    <p className="text-xs text-muted-foreground">Processed</p>
                  </div>
                  <div className="p-3 bg-blue-500/10 rounded-lg text-center">
                    <div className="flex items-center justify-center gap-1">
                      <TrendingUp className="h-4 w-4 text-blue-500" />
                      <p className="text-2xl font-bold text-blue-600">{dailySyncResult.updated}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Updated</p>
                  </div>
                  <div className="p-3 bg-green-500/10 rounded-lg text-center">
                    <div className="flex items-center justify-center gap-1">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <p className="text-2xl font-bold text-green-600">{dailySyncResult.resolved}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Resolved</p>
                  </div>
                  <div className="p-3 bg-orange-500/10 rounded-lg text-center">
                    <div className="flex items-center justify-center gap-1">
                      <RefreshCw className="h-4 w-4 text-orange-500" />
                      <p className="text-2xl font-bold text-orange-600">{dailySyncResult.reopened}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Reopened</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg text-center">
                    <p className="text-2xl font-bold">{dailySyncResult.maintained}</p>
                    <p className="text-xs text-muted-foreground">Maintained</p>
                  </div>
                  <div className="p-3 bg-yellow-500/10 rounded-lg text-center">
                    <div className="flex items-center justify-center gap-1">
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                      <p className="text-2xl font-bold text-yellow-600">{dailySyncResult.not_found}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Not Found</p>
                  </div>
                </div>
                
                {/* Agent notification indicator */}
                <div className="flex items-center gap-2 p-3 mt-4 bg-primary/5 rounded-lg">
                  <Bell className="h-4 w-4 text-primary" />
                  <span className="text-sm">
                    Agents notified of {dailySyncResult.updated + dailySyncResult.resolved + dailySyncResult.reopened} changes
                  </span>
                </div>

                {dailySyncResult.errors.length > 0 && (
                  <Alert variant="destructive" className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {dailySyncResult.errors.length} errors: {dailySyncResult.errors.slice(0, 3).join('; ')}
                      {dailySyncResult.errors.length > 3 && `... and ${dailySyncResult.errors.length - 3} more`}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Preview Data</CardTitle>
              <CardDescription>Tickets will be assigned to the specified agents</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-auto max-h-96">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px]">Row</TableHead>
                      <TableHead className="w-[80px]">Status</TableHead>
                      <TableHead>Customer Name</TableHead>
                      <TableHead>NRC Number</TableHead>
                      <TableHead>Mobile Number</TableHead>
                      <TableHead className="text-right">Amount Owed</TableHead>
                      <TableHead>Assigned Agent</TableHead>
                      <TableHead>Errors</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.map((row, index) => (
                      <TableRow key={index} className={!row.isValid ? 'bg-destructive/5' : row.existsInMaster ? 'bg-info/5' : ''}>
                        <TableCell className="font-mono text-sm text-muted-foreground">{row.rowNumber}</TableCell>
                        <TableCell>
                          {row.isValid ? (
                            row.existsInMaster ? (
                              <Badge variant="outline" className="bg-info/10 text-info whitespace-nowrap">Exists</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-success/10 text-success whitespace-nowrap">New</Badge>
                            )
                          ) : (
                            <Badge variant="destructive" className="whitespace-nowrap">Invalid</Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{row.name || '-'}</TableCell>
                        <TableCell className={`font-mono text-sm ${row.isDuplicateNrc ? 'text-destructive font-bold' : ''}`}>
                          {row.nrcNumber || '-'}
                          {row.isDuplicateNrc && <span className="ml-1 text-xs">(dup)</span>}
                        </TableCell>
                        <TableCell className={`font-mono text-sm ${row.isDuplicateMobile ? 'text-destructive font-bold' : ''}`}>
                          {row.mobileNumber || '-'}
                          {row.isDuplicateMobile && <span className="ml-1 text-xs">(dup)</span>}
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(row.amountOwed)}</TableCell>
                        <TableCell>
                          {row.assignedAgentId ? (
                            <Badge variant="outline">{row.assignedAgent}</Badge>
                          ) : row.assignedAgent ? (
                            <Badge variant="destructive" className="whitespace-nowrap">{row.assignedAgent} ✗</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-destructive max-w-[200px]">
                          {row.errors.length > 0 && (
                            <span className="truncate block" title={row.errors.join('; ')}>
                              {row.errors[0]}{row.errors.length > 1 && ` (+${row.errors.length - 1} more)`}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {parsedData.some(r => !r.isValid) && (
                <div className="mt-4 p-4 bg-destructive/5 rounded-lg border border-destructive/20">
                  <h4 className="font-medium text-destructive mb-2">Detailed Errors by Row:</h4>
                  <ul className="text-sm space-y-1 max-h-48 overflow-auto">
                    {parsedData.filter(r => !r.isValid).slice(0, 20).map((row) => (
                      <li key={row.rowNumber} className="text-muted-foreground">
                        <span className="font-medium text-destructive">Row {row.rowNumber}</span> ({row.name || 'unnamed'}): {row.errors.join('; ')}
                      </li>
                    ))}
                    {parsedData.filter(r => !r.isValid).length > 20 && (
                      <li className="text-muted-foreground font-medium">...and {parsedData.filter(r => !r.isValid).length - 20} more rows with errors</li>
                    )}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {isImporting && (
            <Card>
              <CardContent className="p-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Importing...</span>
                    <span>{Math.round(importProgress)}%</span>
                  </div>
                  <Progress value={importProgress} />
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-4 items-center">
            <Button variant="outline" onClick={() => { setFile(null); setParsedData([]); }}>
              Start Over
            </Button>
            <Button 
              onClick={handleImport} 
              disabled={isImporting || validCount === 0 || hasBlockingErrors}
              className={hasBlockingErrors ? 'opacity-50 cursor-not-allowed' : ''}
            >
              {isImporting ? 'Processing...' : hasBlockingErrors ? 'Fix Errors to Import' : 
                uploadMode === "new" ? `Create Batch (${validCount} customers)` :
                uploadMode === "existing" ? `Add ${validCount - existingCount} New Customers` :
                `Update ${validCount} Records`}
            </Button>
            {hasBlockingErrors && (
              <span className="text-sm text-destructive">
                ⚠ Upload blocked: {invalidCount} row(s) have errors that must be fixed
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}