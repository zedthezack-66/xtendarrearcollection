import { useState, useEffect, useMemo } from "react";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, RotateCcw, Download, Layers, Flag, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBatches } from "@/hooks/useSupabaseData";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { PageHeader } from "@/components/layout/PageHeader";
import XLSX from "xlsx-js-style";
import Papa from "papaparse";

// Columns read from the daily loan book export (LoanBook_DDMmmYYYY.csv).
const REQUIRED_COLUMNS = ["LoanRefId", "NRCNumber", "ArrearAmount", "LastPaymentDate"];

interface FileRow {
  row: number;
  loan_id: string;
  nrc_number: string;
  foreclosure_loan_id: string;
  arrears_amount: string;
  days_in_arrears: string;
  last_payment_date: string;
}

interface Totals {
  loans: number;
  opening: number;
  current: number;
  collected: number;
  paying: number;
  cleared: number;
  reduced: number;
  maintained: number;
  no_arrears: number;
  increased: number;
  flagged: number;
  matched_loan_id: number;
  matched_top_up: number;
  matched_nrc: number;
  missing: number;
  ambiguous: number;
}

interface AgentRow {
  agent_id: string | null;
  agent_name: string;
  loans: number;
  opening: number;
  current: number;
  collected: number;
  paying: number;
  cleared: number;
  flagged: number;
}

interface FlaggedRow {
  ticket_id: string;
  customer_name: string;
  loan_id: string;
  matched_loan_id: string | null;
  agent_name: string;
  opening: number;
  current: number;
  flag_reason: string;
}

interface Summary {
  last_updated: string | null;
  file_name: string | null;
  totals: Totals;
  agents: AgentRow[];
  flagged: FlaggedRow[];
}

interface Issue {
  row: number | null;
  loan_id: string | null;
  message: string;
}

interface SyncResult {
  success: boolean;
  committed: boolean;
  rows_received?: number;
  tickets?: number;
  tickets_changed?: number;
  reopened?: number;
  overridden_payments?: number;
  notifications?: number;
  collected_before?: number;
  summary?: Summary;
  errors: Issue[];
  warnings: Issue[];
}

const kwacha = (value: number | null | undefined) =>
  `K${Number(value ?? 0).toLocaleString("en-ZM", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const normLoan = (value: unknown) => String(value ?? "").trim().toUpperCase();
const normNrc = (value: unknown) => String(value ?? "").replace(/\s/g, "").toUpperCase();

const errorMessage = (error: unknown) =>
  (error as { message?: string } | null)?.message ?? String(error);

const rate = (collected: number, opening: number) =>
  Number(opening) > 0 ? `${((Number(collected) / Number(opening)) * 100).toFixed(1)}%` : "-";

function SummaryView({ summary, title, description }: { summary: Summary; title: string; description: string }) {
  const t = summary.totals;
  const tiles = [
    { label: "Collected this month", value: kwacha(t.collected), tone: "text-green-600" },
    { label: "Opening arrears", value: kwacha(t.opening) },
    { label: "Arrears today", value: kwacha(t.current) },
    { label: "Collection rate", value: rate(t.collected, t.opening) },
    { label: "Loans paying", value: t.paying },
    { label: "Cleared", value: t.cleared, tone: "text-green-600" },
    { label: "No change", value: t.maintained },
    { label: "Flagged", value: t.flagged, tone: t.flagged > 0 ? "text-orange-600" : undefined },
  ];

  const downloadSummary = () => {
    const wb = XLSX.utils.book_new();
    const agentRows = summary.agents.map((a) => ({
      Agent: a.agent_name,
      Loans: a.loans,
      "Opening Arrears": Number(a.opening),
      "Arrears Today": Number(a.current),
      "Collected MTD": Number(a.collected),
      "Collection Rate": rate(a.collected, a.opening),
      "Loans Paying": a.paying,
      Cleared: a.cleared,
      Flagged: a.flagged,
    }));
    agentRows.push({
      Agent: "Total",
      Loans: t.loans,
      "Opening Arrears": Number(t.opening),
      "Arrears Today": Number(t.current),
      "Collected MTD": Number(t.collected),
      "Collection Rate": rate(t.collected, t.opening),
      "Loans Paying": t.paying,
      Cleared: t.cleared,
      Flagged: t.flagged,
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(agentRows), "By Agent");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        summary.flagged.map((f) => ({
          Customer: f.customer_name,
          "Loan ID": f.loan_id,
          "Loan ID in Loan Book": f.matched_loan_id ?? "",
          Agent: f.agent_name,
          "Opening Arrears": Number(f.opening),
          "Arrears Today": Number(f.current),
          Reason: f.flag_reason,
        }))
      ),
      "Flagged"
    );
    XLSX.writeFile(wb, `Collections_MTD_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={downloadSummary}>
          <Download className="h-4 w-4 mr-1" />
          Download
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {tiles.map((tile) => (
            <div key={tile.label} className="p-3 bg-muted/50 rounded-lg">
              <p className={`text-xl font-bold ${tile.tone ?? ""}`}>{tile.value}</p>
              <p className="text-xs text-muted-foreground">{tile.label}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          {t.loans} loans: {t.matched_loan_id} matched by Loan ID, {t.matched_top_up} by top-up, {t.matched_nrc} by NRC,{" "}
          {t.missing} not in the file, {t.ambiguous} unclear. {t.no_arrears} had no arrears at the start of the month.
        </p>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Loans</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Today</TableHead>
                <TableHead className="text-right">Collected</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Paying</TableHead>
                <TableHead className="text-right">Cleared</TableHead>
                <TableHead className="text-right">Flagged</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.agents.map((a) => (
                <TableRow key={a.agent_id ?? "unassigned"}>
                  <TableCell className="font-medium">{a.agent_name}</TableCell>
                  <TableCell className="text-right">{a.loans}</TableCell>
                  <TableCell className="text-right font-mono">{kwacha(a.opening)}</TableCell>
                  <TableCell className="text-right font-mono">{kwacha(a.current)}</TableCell>
                  <TableCell className="text-right font-mono text-green-600">{kwacha(a.collected)}</TableCell>
                  <TableCell className="text-right">{rate(a.collected, a.opening)}</TableCell>
                  <TableCell className="text-right">{a.paying}</TableCell>
                  <TableCell className="text-right">{a.cleared}</TableCell>
                  <TableCell className="text-right">{a.flagged > 0 ? <Badge variant="outline">{a.flagged}</Badge> : 0}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{t.loans}</TableCell>
                <TableCell className="text-right font-mono">{kwacha(t.opening)}</TableCell>
                <TableCell className="text-right font-mono">{kwacha(t.current)}</TableCell>
                <TableCell className="text-right font-mono text-green-600">{kwacha(t.collected)}</TableCell>
                <TableCell className="text-right">{rate(t.collected, t.opening)}</TableCell>
                <TableCell className="text-right">{t.paying}</TableCell>
                <TableCell className="text-right">{t.cleared}</TableCell>
                <TableCell className="text-right">{t.flagged}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {summary.flagged.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Flag className="h-4 w-4 text-orange-500" />
              Flagged for checking ({t.flagged})
            </h3>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Loan ID</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Today</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.flagged.map((f) => (
                    <TableRow key={f.ticket_id}>
                      <TableCell>{f.customer_name}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {f.loan_id}
                        {f.matched_loan_id && f.matched_loan_id !== f.loan_id && (
                          <span className="block text-muted-foreground">now {f.matched_loan_id}</span>
                        )}
                      </TableCell>
                      <TableCell>{f.agent_name}</TableCell>
                      <TableCell className="text-right font-mono">{kwacha(f.opening)}</TableCell>
                      <TableCell className="text-right font-mono">{kwacha(f.current)}</TableCell>
                      <TableCell className="text-sm">{f.flag_reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {t.flagged > summary.flagged.length && (
              <p className="text-xs text-muted-foreground">Showing the {summary.flagged.length} largest.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IssueList({ issues, title, destructive }: { issues: Issue[]; title: string; destructive?: boolean }) {
  if (issues.length === 0) return null;
  return (
    <Alert variant={destructive ? "destructive" : "default"}>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        <p className="font-medium mb-1">{title}</p>
        <ul className="text-sm space-y-0.5 max-h-48 overflow-y-auto">
          {issues.map((issue, i) => (
            <li key={i}>
              {issue.row ? `Row ${issue.row}` : ""}
              {issue.loan_id ? ` (${issue.loan_id})` : ""}
              {issue.row || issue.loan_id ? ": " : ""}
              {issue.message}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

export default function LoanBookSync() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: batches = [] } = useBatches();

  // A month's opening position is all the batches loaded that month (one per agent).
  const months = useMemo(() => {
    const byMonth = new Map<string, { key: string; label: string; batches: typeof batches }>();
    batches.forEach((b) => {
      const d = new Date(b.upload_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!byMonth.has(key)) {
        byMonth.set(key, { key, label: d.toLocaleString("en-GB", { month: "long", year: "numeric" }), batches: [] });
      }
      byMonth.get(key)!.batches.push(b);
    });
    return [...byMonth.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [batches]);

  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const monthBatches = useMemo(() => months.find((m) => m.key === selectedMonth)?.batches ?? [], [months, selectedMonth]);
  const batchIds = useMemo(() => monthBatches.map((b) => b.id), [monthBatches]);
  const monthLabel = months.find((m) => m.key === selectedMonth)?.label ?? "";

  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [fileRowCount, setFileRowCount] = useState(0);
  const [stage, setStage] = useState<"idle" | "reading" | "previewing" | "applying">("idle");
  const [preview, setPreview] = useState<SyncResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // The latest month is normally the one being collected.
  useEffect(() => {
    if (!selectedMonth && months.length > 0) setSelectedMonth(months[0].key);
  }, [months, selectedMonth]);

  const { data: currentSummary, isLoading: summaryLoading } = useQuery({
    queryKey: ["loan_book_mtd", ...batchIds],
    enabled: isAdmin && batchIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_loan_book_mtd_summary", { p_batch_ids: batchIds });
      if (error) throw error;
      return data as unknown as Summary;
    },
  });

  const reset = () => {
    setFile(null);
    setRows([]);
    setFileRowCount(0);
    setPreview(null);
    setFileError(null);
    setStage("idle");
  };

  const runSync = async (fileRows: FileRow[], commit: boolean, fileName: string) => {
    const { data, error } = await supabase.rpc("sync_loan_book_mtd", {
      p_batch_ids: batchIds,
      p_rows: fileRows as unknown as never,
      p_file_name: fileName,
      p_commit: commit,
    });
    if (error) throw error;
    return data as unknown as SyncResult;
  };

  const handleFile = async (selected: File) => {
    if (batchIds.length === 0) {
      toast({ title: "Select the month first", variant: "destructive" });
      return;
    }
    reset();
    setFile(selected);
    setStage("reading");

    try {
      const parsed = await new Promise<Papa.ParseResult<Record<string, string>>>((resolve, reject) =>
        Papa.parse<Record<string, string>>(selected, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h) => h.trim(),
          complete: resolve,
          error: reject,
        })
      );

      const headers = parsed.meta.fields ?? [];
      const missingColumns = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
      if (missingColumns.length > 0) {
        setFileError(`This doesn't look like the daily loan book. Missing columns: ${missingColumns.join(", ")}.`);
        setStage("idle");
        return;
      }

      // Only rows that can belong to the month's batches go to the server: their Loan IDs, top-ups of them, and their NRCs.
      const tickets = await fetchAllRows<{ loan_id: string; nrc_number: string }>((from, to) =>
        supabase
          .from("tickets")
          .select("loan_id, nrc_number, id")
          .in("batch_id", batchIds)
          .order("id")
          .range(from, to)
      );
      const loanIds = new Set(tickets.map((t) => normLoan(t.loan_id)));
      const nrcs = new Set(tickets.map((t) => normNrc(t.nrc_number)));

      const relevant: FileRow[] = [];
      parsed.data.forEach((r, i) => {
        const loan = normLoan(r.LoanRefId);
        const foreclosure = normLoan(r.ForeclosureLoanRefId);
        const nrc = normNrc(r.NRCNumber);
        if (loanIds.has(loan) || (foreclosure && loanIds.has(foreclosure)) || (nrc && nrcs.has(nrc))) {
          relevant.push({
            row: i + 2,
            loan_id: loan,
            nrc_number: r.NRCNumber ?? "",
            foreclosure_loan_id: foreclosure,
            arrears_amount: r.ArrearAmount ?? "",
            days_in_arrears: r.DaysInArrear ?? "",
            last_payment_date: r.LastPaymentDate ?? "",
          });
        }
      });

      setRows(relevant);
      setFileRowCount(parsed.data.length);
      setStage("previewing");
      setPreview(await runSync(relevant, false, selected.name));
    } catch (error) {
      toast({ title: "Could not read the loan book", description: errorMessage(error), variant: "destructive" });
    } finally {
      setStage((s) => (s === "reading" || s === "previewing" ? "idle" : s));
    }
  };

  const apply = async () => {
    if (!file) return;
    setStage("applying");
    try {
      const result = await runSync(rows, true, file.name);
      if (!result.success) {
        setPreview(result);
        return;
      }
      ["loan_book_mtd", "master_customers", "tickets", "dashboard_stats", "agent_notifications", "payments"].forEach((key) =>
        queryClient.invalidateQueries({ queryKey: [key] })
      );
      toast({
        title: "Loan book update applied",
        description: `${kwacha(result.summary?.totals.collected)} collected this month, ${result.summary?.totals.flagged ?? 0} flagged`,
      });
      reset();
    } catch (error) {
      toast({ title: "Update failed; nothing was saved", description: errorMessage(error), variant: "destructive" });
    } finally {
      setStage((s) => (s === "applying" ? "idle" : s));
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-96">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Only administrators can access the Daily Loan Book Update feature.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const busy = stage !== "idle";
  const changeToday = preview?.summary ? Number(preview.summary.totals.collected) - Number(preview.collected_before ?? 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Loan book"
        title="Daily update"
        description="Upload today's loan book. Each loan is compared with its arrears at the start of the month: lower means a payment, zero means cleared, higher is flagged. Differences under K1 are ignored."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Upload Loan Book
          </CardTitle>
          <CardDescription>The daily export as it comes, e.g. LoanBook_09Nov2026.csv</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Month (opening position)</label>
              <Select value={selectedMonth} onValueChange={(v) => { reset(); setSelectedMonth(v); }} disabled={busy}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a month..." />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.label} ({m.batches.length} {m.batches.length === 1 ? "batch" : "batches"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {monthBatches.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {monthBatches.map((b) => (
                    <Badge key={b.id} variant="secondary" className="text-xs font-normal">
                      <Layers className="h-3 w-3 mr-1" />
                      {b.name} · {b.customer_count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 text-center">
              <input
                type="file"
                accept=".csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) handleFile(f);
                }}
                className="hidden"
                id="loan-book-upload"
                disabled={busy || batchIds.length === 0}
              />
              <label htmlFor="loan-book-upload" className="cursor-pointer">
                <Upload className="h-6 w-6 mx-auto mb-1 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{file ? file.name : "Choose the loan book CSV"}</p>
              </label>
            </div>
          </div>

          {(stage === "reading" || stage === "previewing") && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {stage === "reading" ? "Reading the file..." : "Comparing with the opening position..."}
            </p>
          )}

          {fileError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{fileError}</AlertDescription>
            </Alert>
          )}

          {preview && !preview.success && (
            <IssueList issues={preview.errors} title="Nothing was saved. Fix these and upload again:" destructive />
          )}

          {preview?.success && preview.summary && (
            <div className="space-y-3">
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-medium">Preview: nothing has been saved yet.</p>
                  <p className="text-sm">
                    {fileRowCount.toLocaleString()} loans in the file, {rows.length.toLocaleString()} relate to this batch.{" "}
                    {kwacha(changeToday)} more collected since the last update. {preview.tickets_changed} tickets will
                    change, {preview.reopened} reopen, {preview.overridden_payments} agent-reported payments will be
                    replaced by the loan book, and {preview.notifications} agent notifications will be sent.
                  </p>
                </AlertDescription>
              </Alert>
              <IssueList issues={preview.warnings} title="Warnings (the update can still be applied):" />
              <div className="flex gap-2">
                <Button onClick={apply} disabled={busy}>
                  {stage === "applying" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
                  Apply update
                </Button>
                <Button variant="ghost" onClick={reset} disabled={busy}>
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {preview?.success && preview.summary ? (
        <SummaryView
          summary={preview.summary}
          title="Preview: month to date after this update"
          description={`${monthLabel} - ${file?.name ?? ""}`}
        />
      ) : summaryLoading ? null : currentSummary && currentSummary.totals.loans > 0 ? (
        <SummaryView
          summary={currentSummary}
          title="Month to date"
          description={`${monthLabel} - last updated ${
            currentSummary.last_updated ? new Date(currentSummary.last_updated).toLocaleString("en-GB") : "-"
          } from ${currentSummary.file_name ?? "the loan book"}`}
        />
      ) : (
        batchIds.length > 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <FileSpreadsheet className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No loan book uploaded for {monthLabel} yet.</p>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
