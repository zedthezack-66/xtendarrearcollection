import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useMasterCustomers, useTickets, usePayments, useCreatePayment, useUpdateTicket } from "@/hooks/useSupabaseData";

export default function RecordPayment() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { data: masterCustomers = [] } = useMasterCustomers();
  const { data: tickets = [] } = useTickets();
  const { data: payments = [] } = usePayments();
  const createPayment = useCreatePayment();
  const updateTicket = useUpdateTicket();
  
  const preselectedCustomerId = searchParams.get('customerId') || '';
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  
  const [formData, setFormData] = useState({
    customerId: preselectedCustomerId,
    amount: '',
    paymentMethod: 'Mobile Money',
    paymentDate: new Date().toISOString().split('T')[0],
    notes: '',
    ticketStatus: '' as '' | 'In Progress' | 'Resolved',
  });

  const selectedCustomer = masterCustomers.find(c => c.id === formData.customerId);
  const customerTicket = selectedCustomer ? tickets.find(t => t.master_customer_id === selectedCustomer.id) : null;
  
  // Calculate existing payments for this customer
  const existingPayments = selectedCustomer 
    ? payments.filter(p => p.master_customer_id === selectedCustomer.id)
    : [];
  const existingTotalPaid = existingPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  
  // Auto-determine status based on payment amount
  const amountOwed = customerTicket ? Number(customerTicket.amount_owed) : 0;
  const paymentAmount = parseFloat(formData.amount) || 0;
  const newTotalPaid = existingTotalPaid + paymentAmount;
  
  // Can user select Resolved?
  const canSelectResolved = newTotalPaid >= amountOwed;
  const remainingAfterPayment = Math.max(0, amountOwed - newTotalPaid);

  // Auto-set ticket status when amount changes
  useEffect(() => {
    if (paymentAmount > 0 && amountOwed > 0) {
      if (newTotalPaid >= amountOwed) {
        setFormData(prev => ({ ...prev, ticketStatus: 'Resolved' }));
      } else {
        setFormData(prev => ({ ...prev, ticketStatus: 'In Progress' }));
      }
    }
  }, [paymentAmount, amountOwed, newTotalPaid]);
  
  // Handle status change with validation
  const handleStatusChange = (value: string) => {
    if (value === 'Resolved' && !canSelectResolved) {
      setShowBlockedModal(true);
      return;
    }
    setFormData({ ...formData, ticketStatus: value as 'In Progress' | 'Resolved' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.customerId || !formData.amount) {
      toast({ title: "Validation Error", description: "Please select a customer and enter an amount", variant: "destructive" });
      return;
    }

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Validation Error", description: "Please enter a valid amount", variant: "destructive" });
      return;
    }

    try {
      await createPayment.mutateAsync({
        ticket_id: customerTicket?.id,
        master_customer_id: selectedCustomer!.id,
        customer_name: selectedCustomer!.name,
        amount,
        payment_method: formData.paymentMethod,
        payment_date: formData.paymentDate,
        notes: formData.notes,
      });

      // If user selected a specific status, apply it immediately
      if (customerTicket && formData.ticketStatus) {
        await updateTicket.mutateAsync({
          id: customerTicket.id,
          status: formData.ticketStatus,
          resolved_date: formData.ticketStatus === 'Resolved' ? new Date().toISOString() : null,
        });
      }

      navigate('/payments');
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const formatCurrency = (amount: number) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link to="/payments" className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-input bg-background hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Record Payment</h1>
          <p className="text-muted-foreground">Log a new payment from a customer</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Payment Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="customer">Customer *</Label>
              <Select value={formData.customerId} onValueChange={(value) => setFormData({ ...formData, customerId: value })}>
                <SelectTrigger><SelectValue placeholder="Select a customer" /></SelectTrigger>
                <SelectContent>
                  {masterCustomers.length === 0 ? (
                    <SelectItem value="none" disabled>No customers available</SelectItem>
                  ) : (
                    masterCustomers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>{customer.name} - {customer.nrc_number}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {selectedCustomer && customerTicket && (
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Amount Owed:</span>
                  <span className="font-medium text-destructive">{formatCurrency(amountOwed)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Already Paid:</span>
                  <span className="font-medium text-success">{formatCurrency(existingTotalPaid)}</span>
                </div>
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-muted-foreground">Remaining:</span>
                  <span className="font-bold">{formatCurrency(Math.max(0, amountOwed - existingTotalPaid))}</span>
                </div>
                {paymentAmount > 0 && (
                  <div className="flex justify-between text-sm border-t pt-2">
                    <span className="text-muted-foreground">After This Payment:</span>
                    <span className={`font-bold ${newTotalPaid >= amountOwed ? 'text-success' : 'text-warning'}`}>
                      {newTotalPaid >= amountOwed ? 'Fully Paid' : formatCurrency(amountOwed - newTotalPaid) + ' remaining'}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (ZMW) *</Label>
                <Input id="amount" type="number" min="0" step="0.01" placeholder="0.00" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="paymentDate">Payment Date *</Label>
                <Input id="paymentDate" type="date" value={formData.paymentDate} onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })} />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Payment Method *</Label>
              <RadioGroup value={formData.paymentMethod} onValueChange={(value) => setFormData({ ...formData, paymentMethod: value })} className="flex gap-4">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Mobile Money" id="mobile" />
                  <Label htmlFor="mobile" className="font-normal cursor-pointer">Mobile Money</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="Bank" id="bank" />
                  <Label htmlFor="bank" className="font-normal cursor-pointer">Bank Transfer</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea id="notes" placeholder="Enter any notes about this payment..." value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} />
            </div>

            {customerTicket && paymentAmount > 0 && (
              <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
                <Label>Ticket Status After Payment</Label>
                <RadioGroup 
                  value={formData.ticketStatus} 
                  onValueChange={handleStatusChange} 
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="In Progress" id="inprogress" />
                    <Label htmlFor="inprogress" className="font-normal cursor-pointer">In Progress</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem 
                      value="Resolved" 
                      id="resolved" 
                      disabled={!canSelectResolved}
                      className={!canSelectResolved ? 'opacity-50' : ''}
                    />
                    <Label 
                      htmlFor="resolved" 
                      className={`font-normal cursor-pointer ${!canSelectResolved ? 'opacity-50' : ''}`}
                    >
                      Resolved {!canSelectResolved && <span className="text-xs text-destructive">(Blocked)</span>}
                    </Label>
                  </div>
                </RadioGroup>
                <p className="text-xs text-muted-foreground">
                  {canSelectResolved 
                    ? 'Full payment detected - auto-selecting Resolved' 
                    : `Partial payment - ${formatCurrency(remainingAfterPayment)} still outstanding`}
                </p>
              </div>
            )}

            <div className="flex gap-4">
              <Button type="submit" disabled={createPayment.isPending}>Record Payment</Button>
              <Button type="button" variant="outline" onClick={() => navigate('/payments')}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Blocked Resolve Modal */}
      <Dialog open={showBlockedModal} onOpenChange={setShowBlockedModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Cannot Select Resolved
            </DialogTitle>
            <DialogDescription>
              Full payment is required to resolve this ticket.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-destructive/10 rounded-lg border border-destructive/20">
            <p className="text-sm text-muted-foreground">Remaining after this payment:</p>
            <p className="text-2xl font-bold text-destructive">
              {formatCurrency(remainingAfterPayment)}
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowBlockedModal(false)}>
              Understood
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
