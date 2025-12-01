import { useState } from "react";
import { Search, Database } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAppStore } from "@/store/useAppStore";
import { Link } from "react-router-dom";

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);

export default function MasterRegistry() {
  const { masterCustomers, batchCustomers, batches } = useAppStore();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCustomers = masterCustomers.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.nrcNumber.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Database className="h-6 w-6" />Master Customer Registry</h1><p className="text-muted-foreground">Global view of all customers across all batches</p></div>
      <Card>
        <CardHeader className="pb-4"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search by name or NRC..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" /></div></CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>NRC</TableHead><TableHead className="text-right">Total Owed</TableHead><TableHead className="text-right">Total Paid</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Status</TableHead><TableHead>Batches</TableHead></TableRow></TableHeader>
              <TableBody>
                {filteredCustomers.map(c => {
                  const customerBatches = batchCustomers.filter(bc => bc.masterCustomerId === c.id).length;
                  return (
                    <TableRow key={c.id}>
                      <TableCell><Link to={`/customers/${c.id}`} className="font-medium hover:underline">{c.name}</Link></TableCell>
                      <TableCell className="font-mono text-sm">{c.nrcNumber}</TableCell>
                      <TableCell className="text-right text-destructive">{formatCurrency(c.totalOwed)}</TableCell>
                      <TableCell className="text-right text-success">{formatCurrency(c.totalPaid)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(c.outstandingBalance)}</TableCell>
                      <TableCell><Badge variant={c.paymentStatus === 'Fully Paid' ? 'default' : 'destructive'}>{c.paymentStatus}</Badge></TableCell>
                      <TableCell><Badge variant="outline">{customerBatches} batch(es)</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Showing {filteredCustomers.length} of {masterCustomers.length} customers</p>
        </CardContent>
      </Card>
    </div>
  );
}
