import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
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

interface CSVRow {
  title: string;
  nrcId: string;
  name: string;
  phoneNumber: string;
  arrearAmount: string;
  employerName: string;
  paymentMethod: string;
  status: string;
}

interface ParsedRow extends CSVRow {
  isValid: boolean;
  errors: string[];
  isDuplicate: boolean;
}

const SAMPLE_CSV = `Title,Name,NRC ID,Phone Number,Arrear Amount,Employer Name,Payment Method,Status
Mr,John Doe,123456/10/1,+260 97 1234567,15000,ABC Company,bank_transfer,defaulted
Mrs,Jane Smith,234567/20/2,+260 96 2345678,8500,XYZ Corp,mobile_money,active`;

export default function CSVImport() {
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  const parseCSV = (content: string): ParsedRow[] => {
    const lines = content.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const rows: ParsedRow[] = [];
    const seenNrcIds = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row: CSVRow = {
        title: values[headers.indexOf('title')] || '',
        name: values[headers.indexOf('name')] || '',
        nrcId: values[headers.indexOf('nrc id')] || '',
        phoneNumber: values[headers.indexOf('phone number')] || '',
        arrearAmount: values[headers.indexOf('arrear amount')] || '0',
        employerName: values[headers.indexOf('employer name')] || '',
        paymentMethod: values[headers.indexOf('payment method')] || 'cash',
        status: values[headers.indexOf('status')] || 'active',
      };

      const errors: string[] = [];
      if (!row.name) errors.push('Name is required');
      if (!row.nrcId) errors.push('NRC ID is required');
      if (!row.phoneNumber) errors.push('Phone number is required');
      if (isNaN(parseFloat(row.arrearAmount))) errors.push('Invalid arrear amount');

      const isDuplicate = seenNrcIds.has(row.nrcId);
      if (row.nrcId) seenNrcIds.add(row.nrcId);

      rows.push({
        ...row,
        isValid: errors.length === 0 && !isDuplicate,
        errors,
        isDuplicate,
      });
    }

    return rows;
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === 'text/csv') {
      setFile(droppedFile);
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setParsedData(parseCSV(content));
      };
      reader.readAsText(droppedFile);
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
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setParsedData(parseCSV(content));
      };
      reader.readAsText(selectedFile);
    }
  };

  const handleImport = async () => {
    const validRows = parsedData.filter(r => r.isValid);
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

    for (let i = 0; i < validRows.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      setImportProgress(((i + 1) / validRows.length) * 100);
    }

    setIsImporting(false);
    toast({
      title: "Import Complete",
      description: `Successfully imported ${validRows.length} customers`,
    });
    setFile(null);
    setParsedData([]);
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

  const validCount = parsedData.filter(r => r.isValid).length;
  const invalidCount = parsedData.filter(r => !r.isValid).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/customers" className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-input bg-background hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Import Customers</h1>
          <p className="text-muted-foreground">Upload a CSV file to bulk import customers</p>
        </div>
        <Button variant="outline" onClick={downloadSample}>
          <Download className="h-4 w-4 mr-2" />
          Download Sample
        </Button>
      </div>

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
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">File</p>
                    <p className="font-medium">{file.name}</p>
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
          </div>

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
              <CardDescription>Review the data before importing</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-auto max-h-96">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Status</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>NRC ID</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Arrear Amount</TableHead>
                      <TableHead>Employer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.map((row, index) => (
                      <TableRow key={index} className={!row.isValid ? 'bg-destructive/5' : ''}>
                        <TableCell>
                          {row.isValid ? (
                            <Badge className="bg-success/10 text-success">Valid</Badge>
                          ) : row.isDuplicate ? (
                            <Badge variant="secondary">Duplicate</Badge>
                          ) : (
                            <Badge variant="destructive">Error</Badge>
                          )}
                        </TableCell>
                        <TableCell>{row.title} {row.name}</TableCell>
                        <TableCell className="font-mono text-sm">{row.nrcId}</TableCell>
                        <TableCell>{row.phoneNumber}</TableCell>
                        <TableCell>{row.arrearAmount}</TableCell>
                        <TableCell>{row.employerName}</TableCell>
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
                <p className="text-sm text-muted-foreground mb-2">Importing customers...</p>
                <Progress value={importProgress} />
              </CardContent>
            </Card>
          )}

          <div className="flex gap-4">
            <Button onClick={handleImport} disabled={isImporting || validCount === 0}>
              Import {validCount} Customer{validCount !== 1 ? 's' : ''}
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
