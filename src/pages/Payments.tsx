import { useState, useEffect, useMemo } from "react";
import { Search, Plus, Trash2, MoreHorizontal, Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePayments, useMasterCustomers, useBatches, useBatchCustomers, useDeletePayment, useUpdatePayment, useTickets } from "@/hooks/useSupabaseData";
import { useUIStore } from "@/store/useUIStore";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);
const formatDate = (date: string) => new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const getPaymentMethodBadge = (method: string) => {
  switch (method) {
    case 'Mobile Money': return <Badge className="bg-info/10 text-info border-info/20">Mobile Money</Badge>;
    case 'Bank': return <Badge className="bg-primary/10 text-primary border-primary/20">Bank</Badge>;
    default: return <Badge variant="outline">{method}</Badge>;
  }
};

interface PaymentEdit {
  id: string;
  amount: string;
  payment_date: string;
  payment_method: string;
  notes: string;
}

export default function Payments() {
  const { data: payments = [] } = usePayments();
  const { data: masterCustomers = [] } = useMasterCustomers();
  const { data: batches = [] } = useBatches();
  const { data: batchCustomers = [] } = useBatchCustomers();
  const { data: tickets = [] } = useTickets();
  const { activeBatchId } = useUIStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [paymentToDelete, setPaymentToDelete] = useState<string | null>(null);
  const [paymentToEdit, setPaymentToEdit] = useState<PaymentEdit | null>(null);
  const deletePayment = useDeletePayment();
  const updatePayment = useUpdatePayment();
  const queryClient = useQueryClient();

  // Compute payments per ticket for balance display
  const paymentsByTicket = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of payments) {
      if (p.ticket_id) {
        map[p.ticket_id] = (map[p.ticket_id] || 0) + Number(p.amount);
      }
    }
    return map;
  }, [payments]);

  // Realtime subscription for payments
  useEffect(() => {
    const channel = supabase
      .channel('payments-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['payments'] });
          queryClient.invalidateQueries({ queryKey: ['master_customers'] });
          queryClient.invalidateQueries({ queryKey: ['tickets'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const handleDeletePayment = async () => {
    if (paymentToDelete) {
      await deletePayment.mutateAsync(paymentToDelete);
      setPaymentToDelete(null);
    }
  };

  const handleEditPayment = (payment: typeof payments[0]) => {
    setPaymentToEdit({
      id: payment.id,
      amount: String(payment.amount),
      payment_date: payment.payment_date.split('T')[0],
      payment_method: payment.payment_method,
      notes: payment.notes || '',
    });
  };

  const handleSaveEdit = async () => {
    if (!paymentToEdit) return;
    
    const amount = parseFloat(paymentToEdit.amount);
    if (isNaN(amount) || amount <= 0) return;

    await updatePayment.mutateAsync({
      id: paymentToEdit.id,
      amount,
      payment_date: paymentToEdit.payment_date,
      payment_method: paymentToEdit.payment_method,
      notes: paymentToEdit.notes,
    });
    setPaymentToEdit(null);
  };

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
                  <TableHead className="text-right">Ticket Owed</TableHead>
                  <TableHead className="text-right">Total Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">{payments.length === 0 ? "No payments recorded yet" : "No payments found"}</TableCell></TableRow>
                ) : (
                  filteredPayments.map((payment) => {
                    const customer = masterCustomers.find(c => c.id === payment.master_customer_id);
                    const ticket = tickets.find(t => t.id === payment.ticket_id);
                    const ticketAmountOwed = ticket ? Number(ticket.amount_owed) : 0;
                    const ticketTotalPaid = payment.ticket_id ? (paymentsByTicket[payment.ticket_id] || 0) : 0;
                    const ticketBalance = Math.max(0, ticketAmountOwed - ticketTotalPaid);
                    
                    return (
                      <TableRow key={payment.id}>
                        <TableCell className="font-mono text-sm font-medium">#{payment.id.slice(0, 8)}</TableCell>
                        <TableCell><Link to={`/customers/${payment.master_customer_id}`} className="hover:underline">{customer?.name || payment.customer_name}</Link></TableCell>
                        <TableCell>{formatDate(payment.payment_date)}</TableCell>
                        <TableCell>{getPaymentMethodBadge(payment.payment_method)}</TableCell>
                        <TableCell className="text-right font-semibold text-success">{formatCurrency(Number(payment.amount))}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{ticketAmountOwed > 0 ? formatCurrency(ticketAmountOwed) : '-'}</TableCell>
                        <TableCell className="text-right font-semibold text-success">{ticketTotalPaid > 0 ? formatCurrency(ticketTotalPaid) : '-'}</TableCell>
                        <TableCell className={`text-right font-semibold ${ticketBalance > 0 ? 'text-destructive' : 'text-success'}`}>
                          {ticketAmountOwed > 0 ? formatCurrency(ticketBalance) : '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[200px] truncate">{payment.notes || '-'}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEditPayment(payment)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit Payment
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-destructive"
                                onClick={() => setPaymentToDelete(payment.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete Payment
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!paymentToDelete} onOpenChange={() => setPaymentToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this payment? This will recalculate the customer's balance and may change ticket status. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePayment} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Payment Dialog */}
      <Dialog open={!!paymentToEdit} onOpenChange={(open) => !open && setPaymentToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Payment</DialogTitle>
            <DialogDescription>
              Update payment details. Balances and ticket status will be recalculated automatically.
            </DialogDescription>
          </DialogHeader>
          {paymentToEdit && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-amount">Amount (ZMW)</Label>
                <Input
                  id="edit-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentToEdit.amount}
                  onChange={(e) => setPaymentToEdit({ ...paymentToEdit, amount: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-date">Payment Date</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={paymentToEdit.payment_date}
                  onChange={(e) => setPaymentToEdit({ ...paymentToEdit, payment_date: e.target.value })}
                />
              </div>
              <div className="space-y-3">
                <Label>Payment Method</Label>
                <RadioGroup 
                  value={paymentToEdit.payment_method} 
                  onValueChange={(value) => setPaymentToEdit({ ...paymentToEdit, payment_method: value })} 
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="Mobile Money" id="edit-mobile" />
                    <Label htmlFor="edit-mobile" className="font-normal cursor-pointer">Mobile Money</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="Bank" id="edit-bank" />
                    <Label htmlFor="edit-bank" className="font-normal cursor-pointer">Bank Transfer</Label>
                  </div>
                </RadioGroup>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  id="edit-notes"
                  value={paymentToEdit.notes}
                  onChange={(e) => setPaymentToEdit({ ...paymentToEdit, notes: e.target.value })}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentToEdit(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={updatePayment.isPending}>
              {updatePayment.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}