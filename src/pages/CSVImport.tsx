import { useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import Papa from "papaparse";
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
import { useAppStore, processCSVBatch } from "@/store/useAppStore";

interface CSVRow {
  'Customer Name'?: string;
  'NRC Number'?: string;
  'Amount Owed'?: string;
  [key: string]: string | undefined;
}

interface ParsedRow {
  name: string;
  nrcNumber: string;
  amountOwed: number;
  isValid: boolean;
  errors: string[];
  existsInMaster: boolean;
}

const SAMPLE_CSV = `Customer Name,NRC Number,Amount Owed
John Mwanza,123456/10/1,15000
Jane Banda,234567/20/2,8500
Peter Phiri,345678/30/3,22000`;

export default function CSVImport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { masterCustomers, settings, createBatch, addCustomerToBatch } = useAppStore();
  
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [batchName, setBatchName] = useState("");
  const [institutionName, setInstitutionName] = useState("");

  const existingNrcNumbers = new Set(masterCustomers.map((c) => c.nrcNumber));

  const parseCSV = (file: File) => {
    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const seenNrcNumbers = new Set<string>();
        const parsed: ParsedRow[] = results.data.map((row) => {
          const name = row['Customer Name']?.trim() || '';
          const nrcNumber = row['NRC Number']?.trim() || '';
          const amountOwedStr = row['Amount Owed']?.trim() || '0';
          const amountOwed = parseFloat(amountOwedStr.replace(/[^0-9.-]/g, ''));
          
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
            isValid: errors.length === 0,
            errors,
            existsInMaster,
          };
        });
        setParsedData(parsed);
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.type === 'text/csv' || droppedFile.name.endsWith('.csv'))) {
      setFile(droppedFile);
      parseCSV(droppedFile);
    } else {
      toast({
        title: "Invalid File",
        description: "Please upload a CSV file",
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      parseCSV(selectedFile);
    }
  };

  const handleImport = async () => {
    if (!batchName.trim()) {
      toast({
        title: "Batch Name Required",
        description: "Please enter a name for this batch",
        variant: "destructive",
      });
      return;
    }

    if (!institutionName.trim()) {
      toast({
        title: "Institution Name Required",
        description: "Please enter the institution name",
        variant: "destructive",
      });
      return;
    }

    const validRows = parsedData.filter((r) => r.isValid);
    if (validRows.length === 0) {
      toast({
        title: "No Valid Data",
        description: "There are no valid rows to import",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    setImportProgress(0);

    // Create new batch
    const batchId = createBatch(batchName.trim(), institutionName.trim());

    // Process CSV data and add to batch
    processCSVBatch(
      batchId,
      validRows.map((r) => ({
        name: r.name,
        nrcNumber: r.nrcNumber,
        amountOwed: r.amountOwed,
      })),
      settings,
      addCustomerToBatch
    );

    // Simulate progress
    for (let i = 0; i <= 100; i += 10) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      setImportProgress(i);
    }

    setIsImporting(false);
    toast({
      title: "Import Complete",
      description: `Successfully created batch "${batchName}" with ${validRows.length} customers`,
    });
    
    navigate('/customers');
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
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency: 'ZMW',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/customers" className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-input bg-background hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Create New Batch</h1>
          <p className="text-muted-foreground">
            Upload CSV to create a new batch with customers and tickets
          </p>
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
          Your CSV must have these columns: <strong>Customer Name</strong>, <strong>NRC Number</strong>, <strong>Amount Owed</strong>
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
              <Input
                id="batchName"
                placeholder="e.g., MTN Loans Nov 2025"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="institutionName">Institution Name *</Label>
              <Input
                id="institutionName"
                placeholder="e.g., MTN Mobile Money"
                value={institutionName}
                onChange={(e) => setInstitutionName(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {!file && (
        <Card>
          <CardContent className="p-6">
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Drag and drop your CSV file</h3>
              <p className="text-muted-foreground mb-4">or click to browse</p>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
                id="csv-upload"
              />
              <Button asChild variant="outline">
                <label htmlFor="csv-upload" className="cursor-pointer">
                  <FileText className="h-4 w-4 mr-2" />
                  Select CSV File
                </label>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {file && parsedData.length > 0 && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">File</p>
                    <p className="font-medium truncate max-w-[120px]">{file.name}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-success/10">
                    <Check className="h-5 w-5 text-success" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Valid Rows</p>
                    <p className="font-medium text-success">{validCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <X className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Invalid Rows</p>
                    <p className="font-medium text-destructive">{invalidCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-info/10">
                    <AlertCircle className="h-5 w-5 text-info" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Existing NRCs</p>
                    <p className="font-medium text-info">{existingCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {existingCount > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Existing Customers Found</AlertTitle>
              <AlertDescription>
                {existingCount} customer(s) already exist in the master registry. Their amounts will be added to their total owed.
              </AlertDescription>
            </Alert>
          )}

          {invalidCount > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Validation Errors</AlertTitle>
              <AlertDescription>
                {invalidCount} row(s) have errors and will be skipped during import.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Preview Data</CardTitle>
              <CardDescription>
                Tickets will be assigned: {settings.agent1Name} & {settings.agent2Name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-auto max-h-96">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Status</TableHead>
                      <TableHead>Customer Name</TableHead>
                      <TableHead>NRC Number</TableHead>
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
                        <TableCell className="text-right">{formatCurrency(row.amountOwed)}</TableCell>
                        <TableCell>
                          {row.isValid ? (
                            <Badge variant="outline">
                              {index % 2 === 0 ? settings.agent1Name : settings.agent2Name}
                            </Badge>
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
                <p className="text-sm text-muted-foreground mb-2">Creating batch and importing customers...</p>
                <Progress value={importProgress} />
              </CardContent>
            </Card>
          )}

          <div className="flex gap-4">
            <Button onClick={handleImport} disabled={isImporting || validCount === 0 || !batchName.trim() || !institutionName.trim()}>
              Create Batch with {validCount} Customer{validCount !== 1 ? 's' : ''}
            </Button>
            <Button variant="outline" onClick={() => { setFile(null); setParsedData([]); }}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
