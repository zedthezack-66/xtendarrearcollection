import { useState } from "react";
import { Search, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePayments, useMasterCustomers, useBatches, useBatchCustomers } from "@/hooks/useSupabaseData";
import { useUIStore } from "@/store/useUIStore";

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);
const formatDate = (date: string) => new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const getPaymentMethodBadge = (method: string) => {
  switch (method) {
    case 'Mobile Money': return <Badge className="bg-info/10 text-info border-info/20">Mobile Money</Badge>;
    case 'Bank': return <Badge className="bg-primary/10 text-primary border-primary/20">Bank</Badge>;
    default: return <Badge variant="outline">{method}</Badge>;
  }
};

export default function Payments() {
  const { data: payments = [] } = usePayments();
  const { data: masterCustomers = [] } = useMasterCustomers();
  const { data: batches = [] } = useBatches();
  const { data: batchCustomers = [] } = useBatchCustomers();
  const { activeBatchId } = useUIStore();
  const [searchQuery, setSearchQuery] = useState("");

  const getDisplayPayments = () => {
    if (!activeBatchId) return payments;
    const batchCustomerIds = batchCustomers
      .filter(bc => bc.batch_id === activeBatchId)
      .map(bc => bc.master_customer_id);
    return payments.filter(p => batchCustomerIds.includes(p.master_customer_id));
  };

  const displayPayments = getDisplayPayments();
  const activeBatch = batches.find(b => b.id === activeBatchId);

  const filteredPayments = displayPayments.filter((payment) => {
    const customer = masterCustomers.find(c => c.id === payment.master_customer_id);
    const customerName = customer?.name || payment.customer_name || '';
    return customerName.toLowerCase().includes(searchQuery.toLowerCase()) || payment.id.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const totalPayments = filteredPayments.reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payments</h1>
          <p className="text-muted-foreground">{activeBatch ? `Viewing batch: ${activeBatch.name}` : 'Track and manage all payment records'}</p>
        </div>
        <Button asChild><Link to="/payments/new"><Plus className="h-4 w-4 mr-2" />Record Payment</Link></Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by customer name..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{payments.length === 0 ? "No payments recorded yet" : "No payments found"}</TableCell></TableRow>
                ) : (
                  filteredPayments.map((payment) => {
                    const customer = masterCustomers.find(c => c.id === payment.master_customer_id);
                    return (
                      <TableRow key={payment.id}>
                        <TableCell className="font-mono text-sm font-medium">#{payment.id.slice(0, 8)}</TableCell>
                        <TableCell><Link to={`/customers/${payment.master_customer_id}`} className="hover:underline">{customer?.name || payment.customer_name}</Link></TableCell>
                        <TableCell>{formatDate(payment.payment_date)}</TableCell>
                        <TableCell>{getPaymentMethodBadge(payment.payment_method)}</TableCell>
                        <TableCell className="text-right font-semibold text-success">{formatCurrency(Number(payment.amount))}</TableCell>
                        <TableCell className="text-muted-foreground max-w-[200px] truncate">{payment.notes || '-'}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Showing {filteredPayments.length} of {displayPayments.length} payments</span>
            <span className="font-medium">Total: <span className="text-success">{formatCurrency(totalPayments)}</span></span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
