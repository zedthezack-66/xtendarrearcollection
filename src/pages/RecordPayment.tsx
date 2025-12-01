import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/useAppStore";
import { PaymentMethod } from "@/types";

export default function RecordPayment() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { masterCustomers, tickets, addPayment } = useAppStore();
  
  const preselectedCustomerId = searchParams.get('customerId') || '';
  
  const [formData, setFormData] = useState({
    customerId: preselectedCustomerId,
    amount: '',
    paymentMethod: 'Mobile Money' as PaymentMethod,
    paymentDate: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const selectedCustomer = masterCustomers.find(c => c.id === formData.customerId);
  const customerTicket = selectedCustomer 
    ? tickets.find(t => t.masterCustomerId === selectedCustomer.id)
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.customerId || !formData.amount) {
      toast({
        title: "Validation Error",
        description: "Please select a customer and enter an amount",
        variant: "destructive",
      });
      return;
    }

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }

    if (!customerTicket) {
      toast({
        title: "Error",
        description: "No ticket found for this customer",
        variant: "destructive",
      });
      return;
    }

    addPayment({
      ticketId: customerTicket.id,
      masterCustomerId: selectedCustomer!.id,
      customerId: selectedCustomer!.id,
      customerName: selectedCustomer!.name,
      amount,
      paymentMethod: formData.paymentMethod,
      date: new Date(formData.paymentDate),
      notes: formData.notes,
    });
    
    toast({
      title: "Payment Recorded",
      description: `Payment of ZMW ${amount.toLocaleString()} has been recorded successfully`,
    });
    
    navigate('/payments');
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency: 'ZMW',
      minimumFractionDigits: 0,
    }).format(amount);
  };

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
        <CardHeader>
          <CardTitle>Payment Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="customer">Customer *</Label>
              <Select
                value={formData.customerId}
                onValueChange={(value) => setFormData({ ...formData, customerId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a customer" />
                </SelectTrigger>
                <SelectContent>
                  {masterCustomers.length === 0 ? (
                    <SelectItem value="none" disabled>No customers available</SelectItem>
                  ) : (
                    masterCustomers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name} - {customer.nrcNumber}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {selectedCustomer && (
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Owed:</span>
                  <span className="font-medium text-destructive">{formatCurrency(selectedCustomer.totalOwed)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Paid:</span>
                  <span className="font-medium text-success">{formatCurrency(selectedCustomer.totalPaid)}</span>
                </div>
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-muted-foreground">Outstanding:</span>
                  <span className="font-bold">{formatCurrency(selectedCustomer.outstandingBalance)}</span>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (ZMW) *</Label>
                <Input
                  id="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="paymentDate">Payment Date *</Label>
                <Input
                  id="paymentDate"
                  type="date"
                  value={formData.paymentDate}
                  onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Payment Method *</Label>
              <RadioGroup 
                value={formData.paymentMethod} 
                onValueChange={(value) => setFormData({ ...formData, paymentMethod: value as PaymentMethod })}
                className="flex gap-4"
              >
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
              <Textarea
                id="notes"
                placeholder="Enter any notes about this payment..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </div>

            <div className="flex gap-4">
              <Button type="submit">Record Payment</Button>
              <Button type="button" variant="outline" onClick={() => navigate('/payments')}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
