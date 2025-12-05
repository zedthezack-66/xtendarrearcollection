import { useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import Papa from "papaparse";
import * as XLSX from "xlsx";
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
import { useMasterCustomers, useCreateBatch, useProfiles } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface CSVRow {
  'Customer Name'?: string;
  'NRC Number'?: string;
  'Amount Owed'?: string;
  'Mobile Number'?: string;
  [key: string]: string | undefined;
}

interface ParsedRow {
  name: string;
  nrcNumber: string;
  amountOwed: number;
  mobileNumber: string;
  isValid: boolean;
  errors: string[];
  existsInMaster: boolean;
}

const SAMPLE_CSV = `Customer Name,NRC Number,Amount Owed,Mobile Number
John Mwanza,123456/10/1,15000,260971234567
Jane Banda,234567/20/2,8500,260972345678
Peter Phiri,345678/30/3,22000,260973456789`;

export default function CSVImport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: masterCustomers = [] } = useMasterCustomers();
  const { data: profiles = [] } = useProfiles();
  const createBatch = useCreateBatch();
  
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [batchName, setBatchName] = useState("");
  const [institutionName, setInstitutionName] = useState("");

  const existingNrcNumbers = new Set(masterCustomers.map((c) => c.nrc_number));
  const agents = profiles.filter(p => p.id !== user?.id).slice(0, 3);

  const processRows = (data: CSVRow[]) => {
    const seenNrcNumbers = new Set<string>();
    const parsed: ParsedRow[] = data.map((row) => {
      const name = row['Customer Name']?.toString().trim() || '';
      const nrcNumber = row['NRC Number']?.toString().trim() || '';
      const amountOwedStr = row['Amount Owed']?.toString().trim() || '0';
      const amountOwed = parseFloat(amountOwedStr.replace(/[^0-9.-]/g, ''));
      const mobileNumber = row['Mobile Number']?.toString().trim() || '';
      
      const errors: string[] = [];
      if (!name) errors.push('Customer Name is required');
      if (!nrcNumber) errors.push('NRC Number is required');
      if (isNaN(amountOwed) || amountOwed <= 0) errors.push('Valid Amount Owed is required');
      
      const isDuplicateInFile = seenNrcNumbers.has(nrcNumber);
      const existsInMaster = existingNrcNumbers.has(nrcNumber);
      
      if (nrcNumber) seenNrcNumbers.add(nrcNumber);
      if (isDuplicateInFile) errors.push('Duplicate NRC in file');
      
      return {
        name,
        nrcNumber,
        amountOwed: isNaN(amountOwed) ? 0 : amountOwed,
        mobileNumber,
        isValid: errors.length === 0,
        errors,
        existsInMaster,
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
    if (!batchName.trim()) {
      toast({ title: "Batch Name Required", description: "Please enter a name for this batch", variant: "destructive" });
      return;
    }

    if (!institutionName.trim()) {
      toast({ title: "Institution Name Required", description: "Please enter the institution name", variant: "destructive" });
      return;
    }

    const validRows = parsedData.filter((r) => r.isValid);
    if (validRows.length === 0) {
      toast({ title: "No Valid Data", description: "There are no valid rows to import", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    setImportProgress(0);

    try {
      // Create batch first
      const batch = await createBatch.mutateAsync({
        name: batchName.trim(),
        institution_name: institutionName.trim(),
        customer_count: validRows.length,
        total_amount: validRows.reduce((sum, r) => sum + r.amountOwed, 0),
      });

      setImportProgress(10);

      // Separate new customers from existing ones
      const newCustomerRows = validRows.filter(r => !r.existsInMaster);
      const existingCustomerRows = validRows.filter(r => r.existsInMaster);

      // Batch insert new master customers
      if (newCustomerRows.length > 0) {
        const newMasterCustomers = newCustomerRows.map((row, index) => ({
          nrc_number: row.nrcNumber,
          name: row.name,
          mobile_number: row.mobileNumber || null,
          total_owed: row.amountOwed,
          outstanding_balance: row.amountOwed,
          assigned_agent: agents[index % agents.length]?.id || user?.id,
        }));

        const { data: insertedCustomers, error: customersError } = await supabase
          .from('master_customers')
          .insert(newMasterCustomers)
          .select();

        if (customersError) throw customersError;

        setImportProgress(40);

        // Create tickets for new customers in batch
        if (insertedCustomers && insertedCustomers.length > 0) {
          const newTickets = insertedCustomers.map(mc => ({
            master_customer_id: mc.id,
            customer_name: mc.name,
            nrc_number: mc.nrc_number,
            mobile_number: mc.mobile_number,
            amount_owed: Number(mc.total_owed),
            assigned_agent: mc.assigned_agent,
          }));

          const { error: ticketsError } = await supabase
            .from('tickets')
            .insert(newTickets);

          if (ticketsError) throw ticketsError;

          // Create batch_customers entries for new customers
          const newBatchCustomers = insertedCustomers.map(mc => ({
            batch_id: batch.id,
            master_customer_id: mc.id,
            nrc_number: mc.nrc_number,
            name: mc.name,
            mobile_number: mc.mobile_number,
            amount_owed: Number(mc.total_owed),
          }));

          const { error: batchCustError } = await supabase
            .from('batch_customers')
            .insert(newBatchCustomers);

          if (batchCustError) throw batchCustError;
        }
      }

      setImportProgress(70);

      // Handle existing customers - update totals and create batch_customer entries
      if (existingCustomerRows.length > 0) {
        const batchCustomersForExisting = [];

        for (const row of existingCustomerRows) {
          const existingMaster = masterCustomers.find(mc => mc.nrc_number === row.nrcNumber);
          if (existingMaster) {
            // Update master customer totals
            await supabase.from('master_customers').update({
              total_owed: Number(existingMaster.total_owed) + row.amountOwed,
              outstanding_balance: Number(existingMaster.outstanding_balance) + row.amountOwed,
              mobile_number: row.mobileNumber || existingMaster.mobile_number,
            }).eq('id', existingMaster.id);

            batchCustomersForExisting.push({
              batch_id: batch.id,
              master_customer_id: existingMaster.id,
              nrc_number: row.nrcNumber,
              name: row.name,
              mobile_number: row.mobileNumber || null,
              amount_owed: row.amountOwed,
            });
          }
        }

        // Batch insert batch_customers for existing
        if (batchCustomersForExisting.length > 0) {
          const { error: existingBatchError } = await supabase
            .from('batch_customers')
            .insert(batchCustomersForExisting);

          if (existingBatchError) throw existingBatchError;
        }
      }

      setImportProgress(100);
      toast({ title: "Import Complete", description: `Successfully created batch "${batchName}" with ${validRows.length} customers` });
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/customers" className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-input bg-background hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Create New Batch</h1>
          <p className="text-muted-foreground">Upload CSV to create a new batch with customers and tickets</p>
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
          Your CSV must have these columns: <strong>Customer Name</strong>, <strong>NRC Number</strong>, <strong>Amount Owed</strong>, <strong>Mobile Number</strong>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Batch Details</CardTitle>
          <CardDescription>Enter details for this import batch</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
          <div className="grid gap-4 md:grid-cols-4">
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-muted"><FileText className="h-5 w-5 text-muted-foreground" /></div><div><p className="text-sm text-muted-foreground">File</p><p className="font-medium truncate max-w-[120px]">{file.name}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-success/10"><Check className="h-5 w-5 text-success" /></div><div><p className="text-sm text-muted-foreground">Valid Rows</p><p className="font-medium text-success">{validCount}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-destructive/10"><X className="h-5 w-5 text-destructive" /></div><div><p className="text-sm text-muted-foreground">Invalid Rows</p><p className="font-medium text-destructive">{invalidCount}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-info/10"><AlertCircle className="h-5 w-5 text-info" /></div><div><p className="text-sm text-muted-foreground">Existing NRCs</p><p className="font-medium text-info">{existingCount}</p></div></div></CardContent></Card>
          </div>

          {existingCount > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Existing Customers Found</AlertTitle>
              <AlertDescription>{existingCount} customer(s) already exist in the master registry. Their amounts will be added to their total owed.</AlertDescription>
            </Alert>
          )}

          {invalidCount > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Validation Errors</AlertTitle>
              <AlertDescription>{invalidCount} row(s) have errors and will be skipped during import.</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Preview Data</CardTitle>
              <CardDescription>Tickets will be assigned to available agents</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-auto max-h-96">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Status</TableHead>
                      <TableHead>Customer Name</TableHead>
                      <TableHead>NRC Number</TableHead>
                      <TableHead>Mobile Number</TableHead>
                      <TableHead className="text-right">Amount Owed</TableHead>
                      <TableHead>Assigned To</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.map((row, index) => (
                      <TableRow key={index} className={!row.isValid ? 'bg-destructive/5' : ''}>
                        <TableCell>
                          {row.isValid ? (
                            row.existsInMaster ? (
                              <Badge className="bg-info/10 text-info border-info/20">Linked</Badge>
                            ) : (
                              <Badge className="bg-success/10 text-success border-success/20">New</Badge>
                            )
                          ) : (
                            <Badge variant="destructive">Error</Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="font-mono text-sm">{row.nrcNumber}</TableCell>
                        <TableCell className="font-mono text-sm">{row.mobileNumber || '-'}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.amountOwed)}</TableCell>
                        <TableCell>
                          {row.isValid ? (
                            <Badge variant="outline">{agents[index % agents.length]?.full_name || 'Auto'}</Badge>
                          ) : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {isImporting && (
            <Card>
              <CardContent className="p-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Importing...</span>
                    <span>{importProgress}%</span>
                  </div>
                  <Progress value={importProgress} />
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-4 justify-end">
            <Button variant="outline" onClick={() => { setFile(null); setParsedData([]); }} disabled={isImporting}>
              Start Over
            </Button>
            <Button onClick={handleImport} disabled={validCount === 0 || isImporting || !batchName.trim() || !institutionName.trim()}>
              {isImporting ? 'Importing...' : `Create Batch (${validCount} customers)`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
