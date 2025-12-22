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
  'Assigned Agent'?: string;
  [key: string]: string | undefined;
}

interface ParsedRow {
  name: string;
  nrcNumber: string;
  amountOwed: number;
  mobileNumber: string;
  assignedAgent: string;
  assignedAgentId: string | null;
  isValid: boolean;
  errors: string[];
  existsInMaster: boolean;
}

const SAMPLE_CSV = `Customer Name,NRC Number,Amount Owed,Mobile Number,Assigned Agent
John Mwanza,123456/10/1,15000,260971234567,Ziba
Jane Banda,234567/20/2,8500,260972345678,Mary
Peter Phiri,345678/30/3,22000,260973456789,Ziba`;

export default function CSVImport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
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
  
  // Map display_name to agent ID
  const agentDisplayNameMap = new Map(
    profiles
      .filter(p => p.display_name)
      .map(p => [p.display_name!.toLowerCase(), p.id])
  );

  const processRows = (data: CSVRow[]) => {
    const seenNrcNumbers = new Set<string>();
    const parsed: ParsedRow[] = data.map((row) => {
      const name = row['Customer Name']?.toString().trim() || '';
      const nrcNumber = row['NRC Number']?.toString().trim() || '';
      const amountOwedStr = row['Amount Owed']?.toString().trim() || '0';
      const amountOwed = parseFloat(amountOwedStr.replace(/[^0-9.-]/g, ''));
      const mobileNumber = row['Mobile Number']?.toString().trim() || '';
      const assignedAgent = row['Assigned Agent']?.toString().trim() || '';
      
      const errors: string[] = [];
      if (!name) errors.push('Customer Name is required');
      if (!nrcNumber) errors.push('NRC Number is required');
      if (isNaN(amountOwed) || amountOwed <= 0) errors.push('Valid Amount Owed is required');
      if (!assignedAgent) errors.push('Assigned Agent is required');
      
      // Map agent display_name to ID
      const assignedAgentId = assignedAgent ? agentDisplayNameMap.get(assignedAgent.toLowerCase()) || null : null;
      if (assignedAgent && !assignedAgentId) {
        errors.push(`Agent "${assignedAgent}" not found`);
      }
      
      const isDuplicateInFile = seenNrcNumbers.has(nrcNumber);
      const existsInMaster = existingNrcNumbers.has(nrcNumber);
      
      if (nrcNumber) seenNrcNumbers.add(nrcNumber);
      if (isDuplicateInFile) errors.push('Duplicate NRC in file');
      
      return {
        name,
        nrcNumber,
        amountOwed: isNaN(amountOwed) ? 0 : amountOwed,
        mobileNumber,
        assignedAgent,
        assignedAgentId,
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
      toast({ title: "No Valid Data", description: "There are no valid rows to import. Ensure all rows have valid Assigned Agent names.", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    setImportProgress(0);

    const CHUNK_SIZE = 100;

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
          }));

          const { data: insertedCustomers, error: customersError } = await supabase
            .from('master_customers')
            .insert(newMasterCustomers)
            .select();

          if (customersError) throw customersError;

          if (insertedCustomers && insertedCustomers.length > 0) {
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
              };
            });

            const { error: batchCustError } = await supabase
              .from('batch_customers')
              .insert(newBatchCustomers);

            if (batchCustError) throw batchCustError;
          }

          setImportProgress(10 + (i / newCustomerRows.length) * 50);
        }
      }

      setImportProgress(60);

      // Handle existing customers - update totals and create batch_customer entries
      if (existingCustomerRows.length > 0) {
        for (let i = 0; i < existingCustomerRows.length; i += CHUNK_SIZE) {
          const chunk = existingCustomerRows.slice(i, i + CHUNK_SIZE);
          const batchCustomersForExisting = [];

          for (const row of chunk) {
            const existingMaster = masterCustomers.find(mc => mc.nrc_number === row.nrcNumber);
            if (existingMaster) {
              // Only update if mobile is missing - don't double count arrears
              if (!existingMaster.mobile_number && row.mobileNumber) {
                await supabase.from('master_customers').update({
                  mobile_number: row.mobileNumber,
                }).eq('id', existingMaster.id);
              }

              batchCustomersForExisting.push({
                batch_id: batch.id,
                master_customer_id: existingMaster.id,
                nrc_number: row.nrcNumber,
                name: row.name,
                mobile_number: row.mobileNumber || null,
                amount_owed: row.amountOwed,
                assigned_agent_id: row.assignedAgentId,
              });

              // Create ticket for this batch
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

          setImportProgress(60 + (i / existingCustomerRows.length) * 35);
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
  const rejectedAgentCount = parsedData.filter((r) => r.errors.some(e => e.includes('not found'))).length;

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
          <div className="grid gap-4 md:grid-cols-5">
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-muted"><FileText className="h-5 w-5 text-muted-foreground" /></div><div><p className="text-sm text-muted-foreground">File</p><p className="font-medium truncate max-w-[120px]">{file.name}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-success/10"><Check className="h-5 w-5 text-success" /></div><div><p className="text-sm text-muted-foreground">Valid Rows</p><p className="font-medium text-success">{validCount}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-destructive/10"><X className="h-5 w-5 text-destructive" /></div><div><p className="text-sm text-muted-foreground">Invalid Rows</p><p className="font-medium text-destructive">{invalidCount}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-info/10"><AlertCircle className="h-5 w-5 text-info" /></div><div><p className="text-sm text-muted-foreground">Existing NRCs</p><p className="font-medium text-info">{existingCount}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-warning/10"><AlertCircle className="h-5 w-5 text-warning" /></div><div><p className="text-sm text-muted-foreground">Agent Not Found</p><p className="font-medium text-warning">{rejectedAgentCount}</p></div></div></CardContent></Card>
          </div>

          {rejectedAgentCount > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Agent Mapping Errors</AlertTitle>
              <AlertDescription>
                {rejectedAgentCount} row(s) have invalid agent names. Ensure agents have set their display name in Settings and the CSV uses the exact display name.
              </AlertDescription>
            </Alert>
          )}

          {existingCount > 0 && (
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
                      <TableHead className="w-[80px]">Status</TableHead>
                      <TableHead>Customer Name</TableHead>
                      <TableHead>NRC Number</TableHead>
                      <TableHead>Mobile Number</TableHead>
                      <TableHead className="text-right">Amount Owed</TableHead>
                      <TableHead>Assigned Agent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.map((row, index) => (
                      <TableRow key={index} className={!row.isValid ? 'bg-destructive/5' : row.existsInMaster ? 'bg-info/5' : ''}>
                        <TableCell>
                          {row.isValid ? (
                            row.existsInMaster ? (
                              <Badge variant="outline" className="bg-info/10 text-info">Exists</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-success/10 text-success">New</Badge>
                            )
                          ) : (
                            <Badge variant="destructive">Invalid</Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{row.name || '-'}</TableCell>
                        <TableCell className="font-mono text-sm">{row.nrcNumber || '-'}</TableCell>
                        <TableCell className="font-mono text-sm">{row.mobileNumber || '-'}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.amountOwed)}</TableCell>
                        <TableCell>
                          {row.assignedAgentId ? (
                            <Badge variant="outline">{row.assignedAgent}</Badge>
                          ) : row.assignedAgent ? (
                            <Badge variant="destructive">{row.assignedAgent} (not found)</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {parsedData.some(r => !r.isValid) && (
                <div className="mt-4 p-4 bg-destructive/5 rounded-lg">
                  <h4 className="font-medium text-destructive mb-2">Validation Errors:</h4>
                  <ul className="text-sm space-y-1">
                    {parsedData.filter(r => !r.isValid).slice(0, 5).map((row, idx) => (
                      <li key={idx} className="text-muted-foreground">
                        Row {idx + 1} ({row.name || 'unnamed'}): {row.errors.join(', ')}
                      </li>
                    ))}
                    {parsedData.filter(r => !r.isValid).length > 5 && (
                      <li className="text-muted-foreground">...and {parsedData.filter(r => !r.isValid).length - 5} more errors</li>
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

          <div className="flex gap-4">
            <Button variant="outline" onClick={() => { setFile(null); setParsedData([]); }}>
              Start Over
            </Button>
            <Button onClick={handleImport} disabled={isImporting || validCount === 0}>
              {isImporting ? 'Importing...' : `Create Batch (${validCount} customers)`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}