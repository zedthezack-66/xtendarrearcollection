import { useState, useCallback } from "react";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, TrendingUp, TrendingDown, Minus, RotateCcw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";

interface SyncRecord {
  nrc_number: string;
  arrears_amount: number;
  last_payment_date: string | null;
}

interface SyncResult {
  success: boolean;
  sync_batch_id: string;
  processed: number;
  updated: number;
  not_found: number;
  resolved: number;
  errors: string[];
}

const SAMPLE_CSV = `NRC Number,Arrears Amount,Last Payment Date
123456/78/9,5000,2026-01-10
987654/32/1,0,2026-01-15
456789/01/2,2500,`;

export default function LoanBookSync() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<SyncRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    setFile(selectedFile);
    setSyncResult(null);
    setParseErrors([]);
    setProgress(0);

    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const errors: string[] = [];
        const records: SyncRecord[] = [];
        
        results.data.forEach((row: any, index: number) => {
          const nrc = row['NRC Number']?.toString().trim();
          const arrearsStr = row['Arrears Amount']?.toString().trim();
          const paymentDate = row['Last Payment Date']?.toString().trim();
          
          if (!nrc) {
            errors.push(`Row ${index + 2}: Missing NRC Number`);
            return;
          }
          
          const arrears = parseFloat(arrearsStr) || 0;
          
          records.push({
            nrc_number: nrc,
            arrears_amount: arrears,
            last_payment_date: paymentDate || null,
          });
        });
        
        setParsedData(records);
        setParseErrors(errors);
        
        if (records.length > 0) {
          toast({
            title: "File parsed",
            description: `${records.length} records ready for sync${errors.length > 0 ? `, ${errors.length} rows skipped` : ''}`,
          });
        }
      },
      error: (error) => {
        toast({
          title: "Parse error",
          description: error.message,
          variant: "destructive",
        });
      },
    });
  }, [toast]);

  const handleSync = async () => {
    if (parsedData.length === 0) {
      toast({ title: "No data to sync", variant: "destructive" });
      return;
    }

    setIsProcessing(true);
    setProgress(10);

    try {
      // Process in chunks for large datasets (free-tier safe)
      const CHUNK_SIZE = 500;
      let totalProcessed = 0;
      let totalUpdated = 0;
      let totalNotFound = 0;
      let totalResolved = 0;
      let allErrors: string[] = [];
      let lastBatchId = '';

      for (let i = 0; i < parsedData.length; i += CHUNK_SIZE) {
        const chunk = parsedData.slice(i, i + CHUNK_SIZE);
        
        const { data, error } = await supabase.rpc('process_loan_book_sync', {
          p_sync_data: JSON.stringify(chunk),
        });
        
        if (error) throw error;
        
        const result = data as unknown as SyncResult;
        totalProcessed += result.processed;
        totalUpdated += result.updated;
        totalNotFound += result.not_found;
        totalResolved += result.resolved;
        allErrors = [...allErrors, ...result.errors];
        lastBatchId = result.sync_batch_id;
        
        setProgress(10 + ((i + chunk.length) / parsedData.length) * 80);
      }

      setProgress(100);
      
      setSyncResult({
        success: true,
        sync_batch_id: lastBatchId,
        processed: totalProcessed,
        updated: totalUpdated,
        not_found: totalNotFound,
        resolved: totalResolved,
        errors: allErrors,
      });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] });

      toast({
        title: "Sync completed",
        description: `${totalUpdated} records updated, ${totalResolved} tickets resolved`,
      });
    } catch (error: any) {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setParsedData([]);
    setSyncResult(null);
    setParseErrors([]);
    setProgress(0);
  };

  const downloadTemplate = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'loan_book_sync_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-96">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Only administrators can access the Loan Book Sync feature.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Daily Loan Book Sync</h1>
        <p className="text-muted-foreground">Upload loan book data to update arrears and auto-resolve cleared accounts</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Upload Loan Book
            </CardTitle>
            <CardDescription>
              CSV/Excel file with NRC Number, Arrears Amount, and Last Payment Date
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                Download Template
              </Button>
              {file && (
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Reset
                </Button>
              )}
            </div>

            <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center">
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
                id="loan-book-upload"
                disabled={isProcessing}
              />
              <label htmlFor="loan-book-upload" className="cursor-pointer">
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {file ? file.name : 'Click to upload or drag and drop'}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">CSV or Excel files</p>
              </label>
            </div>

            {parseErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {parseErrors.length} rows skipped due to errors
                </AlertDescription>
              </Alert>
            )}

            {parsedData.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Records ready:</span>
                  <Badge variant="secondary">{parsedData.length}</Badge>
                </div>
                
                <Button 
                  onClick={handleSync} 
                  disabled={isProcessing}
                  className="w-full"
                >
                  {isProcessing ? 'Processing...' : 'Start Sync'}
                </Button>
              </div>
            )}

            {isProcessing && (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-xs text-center text-muted-foreground">{Math.round(progress)}%</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results Section */}
        <Card>
          <CardHeader>
            <CardTitle>Sync Results</CardTitle>
            <CardDescription>Summary of the latest sync operation</CardDescription>
          </CardHeader>
          <CardContent>
            {syncResult ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-medium">Sync completed successfully</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-2xl font-bold">{syncResult.processed}</p>
                    <p className="text-xs text-muted-foreground">Processed</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-2xl font-bold text-success">{syncResult.updated}</p>
                    <p className="text-xs text-muted-foreground">Updated</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-2xl font-bold text-info">{syncResult.resolved}</p>
                    <p className="text-xs text-muted-foreground">Tickets Resolved</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-2xl font-bold text-warning">{syncResult.not_found}</p>
                    <p className="text-xs text-muted-foreground">Not Found</p>
                  </div>
                </div>

                {syncResult.errors.length > 0 && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {syncResult.errors.length} errors occurred during sync
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No sync results yet</p>
                <p className="text-sm">Upload a file to begin</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Preview Table */}
      {parsedData.length > 0 && !syncResult && (
        <Card>
          <CardHeader>
            <CardTitle>Data Preview</CardTitle>
            <CardDescription>First 10 records from the uploaded file</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>NRC Number</TableHead>
                  <TableHead className="text-right">Arrears Amount</TableHead>
                  <TableHead>Last Payment Date</TableHead>
                  <TableHead>Expected Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsedData.slice(0, 10).map((record, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-mono">{record.nrc_number}</TableCell>
                    <TableCell className="text-right font-mono">
                      {new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(record.arrears_amount)}
                    </TableCell>
                    <TableCell>{record.last_payment_date || '-'}</TableCell>
                    <TableCell>
                      {record.arrears_amount === 0 ? (
                        <Badge className="bg-success/10 text-success">Will Resolve</Badge>
                      ) : (
                        <Badge variant="secondary">Will Update</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {parsedData.length > 10 && (
              <p className="text-xs text-muted-foreground text-center mt-4">
                + {parsedData.length - 10} more records
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
