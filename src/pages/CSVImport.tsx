import { useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import Papa from "papaparse";
import XLSX from "xlsx-js-style";
import { ArrowLeft, Upload, FileText, Check, X, Download, AlertCircle } from "lucide-react";
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
  'Reason for Arrears'?: string;
  'Last Payment Date'?: string;
  [key: string]: string | undefined;
}

interface ParsedRow {
  rowNumber: number;
  name: string;
  nrcNumber: string;
  amountOwed: number;
  mobileNumber: string;
  assignedAgent: string;
  assignedAgentId: string | null;
  isValid: boolean;
  errors: string[];
  existsInMaster: boolean;
  isDuplicateNrc: boolean;
  isDuplicateMobile: boolean;
  // New loan book fields
  branchName: string;
  arrearStatus: string;
  employerName: string;
  employerSubdivision: string;
  loanConsultant: string;
  tenure: string;
  reasonForArrears: string;
  lastPaymentDate: string;
}

const SAMPLE_CSV = `Customer Name,NRC Number,Amount Owed,Mobile Number,Assigned Agent,Branch Name,Arrear Status,Employer Name,Employer Subdivision,Loan Consultant,Tenure,Last Payment Date
John Mwanza,123456/10/1,15000,260971234567,Ziba,Lusaka Main,60+ Days,Ministry of Health,Finance Dept,Grace Tembo,24 months,2025-12-15
Jane Banda,234567/20/2,8500,260972345678,Mary,Ndola Branch,30+ Days,Zambia Airways,Operations,Peter Sakala,12 months,
Peter Phiri,345678/30/3,22000,260973456789,Ziba,Kitwe Branch,90+ Days,Zambia Sugar,Production,Mary Mulenga,36 months,2025-11-20`;

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
  const [uploadMode, setUploadMode] = useState<"new" | "existing">("new");
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");

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
      const name = row['Customer Name']?.toString().trim() || '';
      const nrcNumber = row['NRC Number']?.toString().trim() || '';
      const amountOwedStr = row['Amount Owed']?.toString().trim() || '0';
      const amountOwed = parseFloat(amountOwedStr.replace(/[^0-9.-]/g, ''));
      const mobileNumber = row['Mobile Number']?.toString().trim() || '';
      const assignedAgent = row['Assigned Agent']?.toString().trim() || '';
      
      // Parse new loan book fields (all optional)
      const branchName = row['Branch Name']?.toString().trim() || '';
      const arrearStatus = row['Arrear Status']?.toString().trim() || '';
      const employerName = row['Employer Name']?.toString().trim() || '';
      const employerSubdivision = row['Employer Subdivision']?.toString().trim() || '';
      const loanConsultant = row['Loan Consultant']?.toString().trim() || '';
      const tenure = row['Tenure']?.toString().trim() || '';
      const reasonForArrears = row['Reason for Arrears']?.toString().trim() || '';
      const lastPaymentDate = row['Last Payment Date']?.toString().trim() || '';
      
      const errors: string[] = [];
      
      // Required field validation
      if (!name) errors.push('Customer Name is required');
      if (!nrcNumber) errors.push('NRC Number is required');
      if (isNaN(amountOwed) || amountOwed <= 0) errors.push('Valid Amount Owed is required');
      if (!assignedAgent) errors.push('Assigned Agent is required');
      
      // Map agent display_name to ID
      const assignedAgentId = assignedAgent ? agentDisplayNameMap.get(assignedAgent.toLowerCase()) || null : null;
      if (assignedAgent && !assignedAgentId) {
        errors.push(`Agent "${assignedAgent}" not found in system`);
      }
      
      // Duplicate detection
      const isDuplicateNrc = duplicateNrcs.has(nrcNumber);
      const isDuplicateMobile = mobileNumber && duplicateMobiles.has(mobileNumber);
      
      if (isDuplicateNrc) {
        const otherRows = nrcOccurrences.get(nrcNumber)!.filter(r => r !== rowNumber);
        errors.push(`Duplicate NRC in file (also in row${otherRows.length > 1 ? 's' : ''} ${otherRows.join(', ')})`);
      }
      
      if (isDuplicateMobile) {
        const otherRows = mobileOccurrences.get(mobileNumber)!.filter(r => r !== rowNumber);
        errors.push(`Duplicate mobile in file (also in row${otherRows.length > 1 ? 's' : ''} ${otherRows.join(', ')})`);
      }
      
      const existsInMaster = existingNrcNumbers.has(nrcNumber);
      
      return {
        rowNumber,
        name,
        nrcNumber,
        amountOwed: isNaN(amountOwed) ? 0 : amountOwed,
        mobileNumber,
        assignedAgent,
        assignedAgentId,
        isValid: errors.length === 0,
        errors,
        existsInMaster,
        isDuplicateNrc,
        isDuplicateMobile: !!isDuplicateMobile,
        // New loan book fields
        branchName,
        arrearStatus,
        employerName,
        employerSubdivision,
        loanConsultant,
        tenure,
        reasonForArrears,
        lastPaymentDate,
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
    }
  };

  const handleImport = async () => {
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
      if (!selectedBatchId) {
        toast({ title: "Batch Required", description: "Please select an existing batch", variant: "destructive" });
        return;
      }
    }

    const validRows = parsedData.filter((r) => r.isValid);
    if (validRows.length === 0) {
      toast({ title: "No Valid Data", description: "There are no valid rows to import. Ensure all rows have valid Assigned Agent names.", variant: "destructive" });
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
        // Use existing batch
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

      // Fetch existing batch_customers for this batch to check for duplicates
      const { data: existingBatchCustomers } = await supabase
        .from('batch_customers')
        .select('nrc_number, master_customer_id')
        .eq('batch_id', batch.id);
      
      const existingNrcsInBatch = new Set(existingBatchCustomers?.map(bc => bc.nrc_number) || []);

      // Separate rows into: new to master, existing in master but new to batch, already in batch
      const newCustomerRows = validRows.filter(r => !r.existsInMaster);
      const existingInMasterRows = validRows.filter(r => r.existsInMaster && !existingNrcsInBatch.has(r.nrcNumber));
      const alreadyInBatchRows = validRows.filter(r => existingNrcsInBatch.has(r.nrcNumber));

      let newlyAddedCount = 0;
      let updatedCount = 0;
      let skippedCount = alreadyInBatchRows.length;

      // Process new customers in chunks
      if (newCustomerRows.length > 0) {
        for (let i = 0; i < newCustomerRows.length; i += CHUNK_SIZE) {
          const chunk = newCustomerRows.slice(i, i + CHUNK_SIZE);
          
          const newMasterCustomers = chunk.map((row) => ({
            nrc_number: row.nrcNumber,
            name: row.name,
            mobile_number: row.mobileNumber || null,
            // No arrears at master level - set to 0
            total_owed: 0,
            outstanding_balance: 0,
            assigned_agent: row.assignedAgentId,
            // New loan book fields
            branch_name: row.branchName || null,
            arrear_status: row.arrearStatus || null,
            employer_name: row.employerName || null,
            employer_subdivision: row.employerSubdivision || null,
            loan_consultant: row.loanConsultant || null,
            tenure: row.tenure || null,
            reason_for_arrears: row.reasonForArrears || null,
            last_payment_date: row.lastPaymentDate ? new Date(row.lastPaymentDate).toISOString() : null,
          }));

          const { data: insertedCustomers, error: customersError } = await supabase
            .from('master_customers')
            .insert(newMasterCustomers)
            .select();

          if (customersError) throw customersError;

          if (insertedCustomers && insertedCustomers.length > 0) {
            newlyAddedCount += insertedCustomers.length;

            // Create tickets for new customers - amount from row, not master
            const newTickets = insertedCustomers.map(mc => {
              const row = chunk.find(r => r.nrcNumber === mc.nrc_number);
              return {
                master_customer_id: mc.id,
                batch_id: batch.id,
                customer_name: mc.name,
                nrc_number: mc.nrc_number,
                mobile_number: mc.mobile_number,
                amount_owed: row?.amountOwed || 0,
                assigned_agent: mc.assigned_agent,
                priority: 'High',
                status: 'Open',
              };
            });

            const { error: ticketsError } = await supabase
              .from('tickets')
              .insert(newTickets);

            if (ticketsError) throw ticketsError;

            // Create batch_customers entries - arrears stored here per batch
            // batch_customers: DO NOT store static fields - only batch-specific data
            const newBatchCustomers = insertedCustomers.map(mc => {
              const row = chunk.find(r => r.nrcNumber === mc.nrc_number);
              return {
                batch_id: batch.id,
                master_customer_id: mc.id,
                nrc_number: mc.nrc_number,
                name: mc.name,
                mobile_number: mc.mobile_number,
                amount_owed: row?.amountOwed || 0,
                assigned_agent_id: row?.assignedAgentId,
                // Only batch-specific fields - NOT static identity fields
                arrear_status: row?.arrearStatus || null,
                reason_for_arrears: row?.reasonForArrears || null,
                last_payment_date: row?.lastPaymentDate ? new Date(row.lastPaymentDate).toISOString() : null,
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

      // Handle existing master customers that are NEW to this batch (not duplicates)
      if (existingInMasterRows.length > 0) {
        for (let i = 0; i < existingInMasterRows.length; i += CHUNK_SIZE) {
          const chunk = existingInMasterRows.slice(i, i + CHUNK_SIZE);
          const batchCustomersForExisting = [];

          for (const row of chunk) {
            const existingMaster = masterCustomers.find(mc => mc.nrc_number === row.nrcNumber);
            if (existingMaster) {
              // Build update object for NULL/empty fields only - static identity data
              const masterUpdate: Record<string, any> = {};
              if (!existingMaster.mobile_number && row.mobileNumber) {
                masterUpdate.mobile_number = row.mobileNumber;
              }
              // Static fields: only populate if currently NULL/empty
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
              
              // Apply updates if any fields need updating
              if (Object.keys(masterUpdate).length > 0) {
                await supabase.from('master_customers').update(masterUpdate).eq('id', existingMaster.id);
                updatedCount++;
              }

              // batch_customers: DO NOT store static fields - only batch-specific data
              batchCustomersForExisting.push({
                batch_id: batch.id,
                master_customer_id: existingMaster.id,
                nrc_number: row.nrcNumber,
                name: row.name,
                mobile_number: row.mobileNumber || null,
                amount_owed: row.amountOwed,
                assigned_agent_id: row.assignedAgentId,
                // Only batch-specific fields - NOT static identity fields
                arrear_status: row.arrearStatus || null,
                reason_for_arrears: row.reasonForArrears || null,
                last_payment_date: row.lastPaymentDate ? new Date(row.lastPaymentDate).toISOString() : null,
              });

              newlyAddedCount++;

              // Create ticket for this batch - new ticket since customer is new to this batch
              await supabase.from('tickets').insert({
                master_customer_id: existingMaster.id,
                batch_id: batch.id,
                customer_name: row.name,
                nrc_number: row.nrcNumber,
                mobile_number: row.mobileNumber || null,
                amount_owed: row.amountOwed,
                assigned_agent: row.assignedAgentId,
                priority: 'High',
                status: 'Open',
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

      setImportProgress(85);

      // Handle customers already in this batch - update ONLY changed fields, never overwrite
      if (alreadyInBatchRows.length > 0) {
        for (const row of alreadyInBatchRows) {
          const existingMaster = masterCustomers.find(mc => mc.nrc_number === row.nrcNumber);
          if (existingMaster) {
            // Only update mobile if it was missing
            if (!existingMaster.mobile_number && row.mobileNumber) {
              await supabase.from('master_customers').update({
                mobile_number: row.mobileNumber,
              }).eq('id', existingMaster.id);
              
              // Also update batch_customers mobile if missing
              await supabase.from('batch_customers').update({
                mobile_number: row.mobileNumber,
              }).eq('batch_id', batch.id).eq('nrc_number', row.nrcNumber);
              
              updatedCount++;
            }
            // NEVER create new tickets or overwrite existing ticket data for duplicates
          }
        }
      }

      // Update batch totals - only count newly added customers
      if (uploadMode === "existing" && newlyAddedCount > 0) {
        const addedAmount = [...newCustomerRows, ...existingInMasterRows].reduce((sum, r) => sum + r.amountOwed, 0);
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
        if (updatedCount > 0) parts.push(`updated ${updatedCount} records`);
        if (skippedCount > 0) parts.push(`skipped ${skippedCount} duplicates`);
        message = `${parts.join(', ')} in batch "${batch.name}"`;
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

  const validCount = parsedData.filter((r) => r.isValid).length;
  const invalidCount = parsedData.filter((r) => !r.isValid).length;
  const existingCount = parsedData.filter((r) => r.existsInMaster && r.isValid).length;
  const rejectedAgentCount = parsedData.filter((r) => r.errors.some(e => e.includes('not found'))).length;
  const duplicateNrcCount = parsedData.filter((r) => r.isDuplicateNrc).length;
  const duplicateMobileCount = parsedData.filter((r) => r.isDuplicateMobile).length;
  const hasBlockingErrors = invalidCount > 0;

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
        <AlertTitle>Required CSV Columns</AlertTitle>
        <AlertDescription>
          Your file must have: <strong>Customer Name</strong>, <strong>NRC Number</strong>, <strong>Amount Owed</strong>, <strong>Mobile Number</strong>, <strong>Assigned Agent</strong> (must match agent's display name)
        </AlertDescription>
      </Alert>

      {profiles.length > 0 && (
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
          <CardTitle>Batch Details</CardTitle>
          <CardDescription>Choose to create a new batch or add to an existing one</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup value={uploadMode} onValueChange={(v) => setUploadMode(v as "new" | "existing")} className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="new" id="new-batch" />
              <Label htmlFor="new-batch">Create New Batch</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="existing" id="existing-batch" />
              <Label htmlFor="existing-batch">Add to Existing Batch</Label>
            </div>
          </RadioGroup>

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

          {existingCount > 0 && !hasBlockingErrors && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Existing Customers Found</AlertTitle>
              <AlertDescription>{existingCount} customer(s) already exist. New tickets will be created for this batch without double-counting arrears.</AlertDescription>
            </Alert>
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
              {isImporting ? 'Importing...' : hasBlockingErrors ? 'Fix Errors to Import' : `Create Batch (${validCount} customers)`}
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