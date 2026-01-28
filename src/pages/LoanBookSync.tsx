import { useState, useCallback } from "react";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, TrendingUp, TrendingDown, Minus, RotateCcw, Download, RefreshCw, Bell } from "lucide-react";
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
  arrears_amount: number | null;
  days_in_arrears: number | null;
  last_payment_date: string | null;
}

interface SyncResult {
  success: boolean;
  sync_batch_id: string;
  processed: number;
  updated: number;
  maintained: number;
  not_found: number;
  resolved: number;
  reopened: number;
  errors: string[];
}

// Template columns - STRICT (no names, no agent fields, no batch fields)
const TEMPLATE_HEADERS = ['NRC Number', 'Amount Owed', 'Days in Arrears', 'Last Payment Date - Loan Book'];

const SAMPLE_CSV = `NRC Number,Amount Owed,Days in Arrears,Last Payment Date - Loan Book
123456/78/9,5000,30,2026-01-10
987654/32/1,0,,2026-01-15
456789/01/2,2500,15,`;

// Helper to check empty/N/A values
const isEmptyValue = (value: string | undefined | null): boolean => {
  if (value === undefined || value === null) return true;
  const v = value.toString().trim().toUpperCase();
  return v === '' || v === '#N/A' || v === 'N/A' || v === 'NULL';
};

// Parse arrears amount with fault tolerance (0 is valid)
const parseArrearsAmount = (value: string | undefined | null): number | null => {
  if (isEmptyValue(value)) return null;
  const cleaned = value!.toString().trim().replace(/,/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
};

// Parse days in arrears
const parseDaysInArrears = (value: string | undefined | null): number | null => {
  if (isEmptyValue(value)) return null;
  const parsed = parseInt(value!.toString().trim(), 10);
  return isNaN(parsed) ? null : parsed;
};

// Parse date with validation (1900-2100 range)
const parseSyncDate = (value: string | undefined | null): string | null => {
  if (isEmptyValue(value)) return null;
  const trimmed = value!.toString().trim();
  const date = new Date(trimmed);
  if (isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  if (year < 1900 || year > 2100) return null;
  return trimmed;
};

export default function LoanBookSync() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<SyncRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
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
          // Support both exact column names and variations
          const nrc = (row['NRC Number'] || row['nrc_number'] || row['NRC'])?.toString().trim();
          const arrearsStr = row['Amount Owed'] || row['Arrears Amount'] || row['arrears_amount'];
          const daysStr = row['Days in Arrears'] || row['days_in_arrears'];
          const paymentDate = row['Last Payment Date - Loan Book'] || row['Last Payment Date'] || row['last_payment_date'];
          
          if (!nrc || isEmptyValue(nrc)) {
            errors.push(`Row ${index + 2}: Missing NRC Number`);
            return;
          }
          
          const arrears = parseArrearsAmount(arrearsStr);
          const days = parseDaysInArrears(daysStr);
          const date = parseSyncDate(paymentDate);
          
          records.push({
            nrc_number: nrc,
            arrears_amount: arrears,
            days_in_arrears: days,
            last_payment_date: date,
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
      let totalMaintained = 0;
      let totalNotFound = 0;
      let totalResolved = 0;
      let totalReopened = 0;
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
        totalMaintained += result.maintained || 0;
        totalNotFound += result.not_found;
        totalResolved += result.resolved;
        totalReopened += result.reopened || 0;
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
        maintained: totalMaintained,
        not_found: totalNotFound,
        resolved: totalResolved,
        reopened: totalReopened,
        errors: allErrors,
      });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] });
      queryClient.invalidateQueries({ queryKey: ['agent_notifications'] });

      toast({
        title: "Daily update completed",
        description: `${totalUpdated} updated, ${totalResolved} resolved, ${totalReopened} reopened, ${totalMaintained} maintained`,
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

  const downloadEmptyTemplate = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'daily_update_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download pre-populated template with ALL NRCs (no 1000 row limit)
  const downloadPrePopulatedTemplate = async () => {
    setIsDownloadingTemplate(true);
    try {
      // Use RPC to get all NRCs without limit
      const { data, error } = await supabase.rpc('get_loan_book_sync_template');
      
      if (error) throw error;
      
      const customers = (data as any)?.customers || [];
      
      if (!customers || customers.length === 0) {
        toast({
          title: "No customers found",
          description: "There are no customers in the system to include in the template.",
          variant: "destructive",
        });
        return;
      }
      
      // Build CSV with ALL NRCs - strict columns only
      const rows = customers.map((c: any) => [
        c.nrc_number,
        '', // Amount Owed - admin fills
        '', // Days in Arrears - admin fills
        ''  // Last Payment Date - admin fills
      ]);
      
      const csvContent = [
        TEMPLATE_HEADERS.join(','),
        ...rows.map((row: string[]) => row.join(','))
      ].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daily_update_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      
      toast({
        title: "Template downloaded",
        description: `Template includes ${customers.length} customer NRCs. Fill in the amounts and dates.`,
      });
    } catch (error: any) {
      toast({
        title: "Download failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  // Get expected action label for preview
  const getExpectedAction = (arrears: number | null): { label: string; variant: "default" | "secondary" | "outline" | "destructive" } => {
    if (arrears === null) {
      return { label: "Skip (No Value)", variant: "outline" };
    }
    if (arrears === 0) {
      return { label: "Will Clear & Resolve", variant: "default" };
    }
    return { label: "Will Update", variant: "secondary" };
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-96">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Only administrators can access the Daily Loan Book Update feature.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Daily Update (Loan Book)</h1>
        <p className="text-muted-foreground">
          Reconcile arrears from the loan book. Updates balances, resolves cleared accounts, and notifies agents.
        </p>
      </div>

      {/* Info Alert */}
      <Alert>
        <RefreshCw className="h-4 w-4" />
        <AlertDescription>
          <strong>Reconciliation Mode:</strong> This updates arrears only. No new customers or tickets are created. 
          Agents will be notified of all changes (cleared, reduced, increased, reopened).
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Upload Loan Book Data
            </CardTitle>
            <CardDescription>
              CSV with: NRC Number, Amount Owed, Days in Arrears, Last Payment Date
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={downloadEmptyTemplate}>
                <Download className="h-4 w-4 mr-1" />
                Empty Template
              </Button>
              <Button 
                variant="default" 
                size="sm" 
                onClick={downloadPrePopulatedTemplate}
                disabled={isDownloadingTemplate}
              >
                <Download className="h-4 w-4 mr-1" />
                {isDownloadingTemplate ? 'Loading...' : 'All NRCs Template'}
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
                <p className="text-xs text-muted-foreground/60 mt-1">CSV files only</p>
              </label>
            </div>

            {parseErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {parseErrors.length} rows skipped due to missing NRC
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
                  {isProcessing ? 'Processing...' : 'Run Daily Update'}
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
            <CardTitle>Update Results</CardTitle>
            <CardDescription>Summary of the latest daily update</CardDescription>
          </CardHeader>
          <CardContent>
            {syncResult ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-medium">Update completed successfully</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-2xl font-bold">{syncResult.processed}</p>
                    <p className="text-xs text-muted-foreground">Processed</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-4 w-4 text-blue-500" />
                      <p className="text-2xl font-bold text-blue-600">{syncResult.updated}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Updated</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-1">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <p className="text-2xl font-bold text-green-600">{syncResult.resolved}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Resolved</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-1">
                      <RefreshCw className="h-4 w-4 text-orange-500" />
                      <p className="text-2xl font-bold text-orange-600">{syncResult.reopened}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Reopened</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-1">
                      <Minus className="h-4 w-4 text-muted-foreground" />
                      <p className="text-2xl font-bold">{syncResult.maintained}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Maintained</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-1">
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                      <p className="text-2xl font-bold text-yellow-600">{syncResult.not_found}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Not Found</p>
                  </div>
                </div>

                {/* Agent notification indicator */}
                <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-lg">
                  <Bell className="h-4 w-4 text-primary" />
                  <span className="text-sm">
                    Agents notified of {syncResult.updated + syncResult.resolved + syncResult.reopened} changes
                  </span>
                </div>

                {syncResult.errors.length > 0 && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {syncResult.errors.length} errors: {syncResult.errors.slice(0, 3).join('; ')}
                      {syncResult.errors.length > 3 && `... and ${syncResult.errors.length - 3} more`}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No update results yet</p>
                <p className="text-sm">Upload a loan book file to begin</p>
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
                  <TableHead className="text-right">Amount Owed</TableHead>
                  <TableHead className="text-right">Days in Arrears</TableHead>
                  <TableHead>Last Payment Date</TableHead>
                  <TableHead>Expected Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsedData.slice(0, 10).map((record, index) => {
                  const action = getExpectedAction(record.arrears_amount);
                  return (
                    <TableRow key={index}>
                      <TableCell className="font-mono">{record.nrc_number}</TableCell>
                      <TableCell className="text-right font-mono">
                        {record.arrears_amount !== null
                          ? new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(record.arrears_amount)
                          : <span className="text-muted-foreground italic">-</span>
                        }
                      </TableCell>
                      <TableCell className="text-right">
                        {record.days_in_arrears !== null ? record.days_in_arrears : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell>{record.last_payment_date || <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell>
                        <Badge variant={action.variant}>{action.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
