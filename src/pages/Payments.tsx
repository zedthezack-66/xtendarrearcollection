import { useState } from "react";
import { Search, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAppStore } from "@/store/useAppStore";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (date: Date) => {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const getPaymentMethodBadge = (method: string) => {
  switch (method) {
    case 'Mobile Money':
      return <Badge className="bg-info/10 text-info border-info/20">Mobile Money</Badge>;
    case 'Bank':
      return <Badge className="bg-primary/10 text-primary border-primary/20">Bank</Badge>;
    default:
      return <Badge variant="outline">{method}</Badge>;
  }
};

export default function Payments() {
  const { payments, masterCustomers, activeBatchId, batchCustomers, batches } = useAppStore();
  const [searchQuery, setSearchQuery] = useState("");

  // Get payments based on active batch
  const getDisplayPayments = () => {
    if (!activeBatchId) {
      return payments;
    }
    const batchCustomerIds = batchCustomers
      .filter(bc => bc.batchId === activeBatchId)
      .map(bc => bc.masterCustomerId);
    return payments.filter(p => batchCustomerIds.includes(p.masterCustomerId));
  };

  const displayPayments = getDisplayPayments();
  const activeBatch = batches.find(b => b.id === activeBatchId);

  const filteredPayments = displayPayments.filter((payment) => {
    const customer = masterCustomers.find(c => c.id === payment.masterCustomerId);
    const customerName = customer?.name || payment.customerName || '';
    const matchesSearch = 
      customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      payment.id.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesSearch;
  });

  const totalPayments = filteredPayments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payments</h1>
          <p className="text-muted-foreground">
            {activeBatch ? `Viewing batch: ${activeBatch.name}` : 'Track and manage all payment records'}
          </p>
        </div>
        <Button asChild>
          <Link to="/payments/new">
            <Plus className="h-4 w-4 mr-2" />
            Record Payment
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by customer name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
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
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {payments.length === 0 ? "No payments recorded yet" : "No payments found"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPayments.map((payment) => {
                    const customer = masterCustomers.find(c => c.id === payment.masterCustomerId);
                    return (
                      <TableRow key={payment.id}>
                        <TableCell className="font-mono text-sm font-medium">
                          #{payment.id.slice(0, 8)}
                        </TableCell>
                        <TableCell>
                          <Link 
                            to={`/customers/${payment.masterCustomerId}`}
                            className="hover:underline"
                          >
                            {customer?.name || payment.customerName}
                          </Link>
                        </TableCell>
                        <TableCell>{formatDate(payment.date)}</TableCell>
                        <TableCell>{getPaymentMethodBadge(payment.paymentMethod)}</TableCell>
                        <TableCell className="text-right font-semibold text-success">
                          {formatCurrency(payment.amount)}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[200px] truncate">
                          {payment.notes || '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Showing {filteredPayments.length} of {displayPayments.length} payments
            </span>
            <span className="font-medium">
              Total: <span className="text-success">{formatCurrency(totalPayments)}</span>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
