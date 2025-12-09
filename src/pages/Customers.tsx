import { useState } from "react";
import { Search, Filter, MoreHorizontal, Eye, Ticket, Phone, UserPlus, Loader2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { useUIStore } from "@/store/useUIStore";
import { useMasterCustomers, useBatchCustomers, useBatches, useProfiles, useDeleteBatch } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 0,
  }).format(amount);
};

type PaymentStatus = 'Not Paid' | 'Partially Paid' | 'Fully Paid';

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'Fully Paid':
      return <Badge className="bg-success/10 text-success border-success/20">Fully Paid</Badge>;
    case 'Partially Paid':
      return <Badge className="bg-warning/10 text-warning border-warning/20">Partially Paid</Badge>;
    case 'Not Paid':
      return <Badge variant="destructive">Not Paid</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

export default function Customers() {
  const { activeBatchId, setActiveBatch } = useUIStore();
  const { data: masterCustomers, isLoading: loadingCustomers } = useMasterCustomers();
  const { data: batchCustomers } = useBatchCustomers();
  const { data: batches } = useBatches();
  const { data: profiles } = useProfiles();
  const { isAdmin, profile } = useAuth();
  const queryClient = useQueryClient();
  const deleteBatch = useDeleteBatch();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  
  // Add customer dialog state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerNrc, setNewCustomerNrc] = useState("");
  const [newCustomerMobile, setNewCustomerMobile] = useState("");
  const [newCustomerAmount, setNewCustomerAmount] = useState("");
  const [newCustomerAgent, setNewCustomerAgent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Delete batch state
  const [batchToDelete, setBatchToDelete] = useState<string | null>(null);

  if (loadingCustomers) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Get customers based on active batch
  const getDisplayCustomers = () => {
    if (!activeBatchId || !masterCustomers || !batchCustomers) {
      return (masterCustomers || []).map(mc => ({
        ...mc,
        batchAmount: Number(mc.total_owed),
      }));
    }
    
    const batchCustomerData = batchCustomers
      .filter(bc => bc.batch_id === activeBatchId)
      .map(bc => ({ masterCustomerId: bc.master_customer_id, batchAmount: Number(bc.amount_owed) }));
    
    return batchCustomerData.map(({ masterCustomerId, batchAmount }) => {
      const master = masterCustomers.find(mc => mc.id === masterCustomerId);
      if (!master) return null;
      return { ...master, batchAmount };
    }).filter(Boolean) as (NonNullable<typeof masterCustomers>[0] & { batchAmount: number })[];
  };

  const displayCustomers = getDisplayCustomers();
  const activeBatch = batches?.find(b => b.id === activeBatchId);

  const handleAddCustomer = async () => {
    if (!newCustomerName.trim() || !newCustomerNrc.trim() || !newCustomerAmount) {
      toast.error("Please fill in all required fields");
      return;
    }

    const amount = parseFloat(newCustomerAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setIsSubmitting(true);

    try {
      // Create or get walk-in batch if no active batch
      let targetBatchId = activeBatchId;
      
      if (!targetBatchId) {
        const walkInBatch = batches?.find(b => b.name === "Walk-in Customers");
        if (walkInBatch) {
          targetBatchId = walkInBatch.id;
        } else {
          const { data: newBatch, error: batchError } = await supabase
            .from('batches')
            .insert({ name: "Walk-in Customers", institution_name: "Direct Payments" })
            .select()
            .single();
          
          if (batchError) throw batchError;
          targetBatchId = newBatch.id;
        }
      }

      // Create master customer
      const { data: customer, error: customerError } = await supabase
        .from('master_customers')
        .insert({
          nrc_number: newCustomerNrc.trim(),
          name: newCustomerName.trim(),
          mobile_number: newCustomerMobile.trim() || null,
          total_owed: amount,
          outstanding_balance: amount,
          assigned_agent: newCustomerAgent || null,
        })
        .select()
        .single();

      if (customerError) throw customerError;

      // Create batch customer link
      await supabase.from('batch_customers').insert({
        batch_id: targetBatchId,
        master_customer_id: customer.id,
        nrc_number: newCustomerNrc.trim(),
        name: newCustomerName.trim(),
        mobile_number: newCustomerMobile.trim() || null,
        amount_owed: amount,
      });

      // Create ticket
      await supabase.from('tickets').insert({
        master_customer_id: customer.id,
        customer_name: newCustomerName.trim(),
        nrc_number: newCustomerNrc.trim(),
        mobile_number: newCustomerMobile.trim() || null,
        amount_owed: amount,
        assigned_agent: newCustomerAgent || null,
      });

      // Update batch totals
      const currentBatch = batches?.find(b => b.id === targetBatchId);
      if (currentBatch) {
        await supabase.from('batches').update({
          customer_count: (currentBatch.customer_count || 0) + 1,
          total_amount: Number(currentBatch.total_amount || 0) + amount,
        }).eq('id', targetBatchId);
      }

      queryClient.invalidateQueries({ queryKey: ['master_customers'] });
      queryClient.invalidateQueries({ queryKey: ['batch_customers'] });
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });

      toast.success(`Customer ${newCustomerName} added successfully`);
      
      setNewCustomerName("");
      setNewCustomerNrc("");
      setNewCustomerMobile("");
      setNewCustomerAmount("");
      setNewCustomerAgent("");
      setIsAddDialogOpen(false);
    } catch (error: any) {
      console.error('Error adding customer:', error);
      if (error.code === '23505') {
        toast.error("A customer with this NRC number already exists");
      } else {
        toast.error("Failed to add customer");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteBatch = async () => {
    if (batchToDelete) {
      // If deleting active batch, clear the selection
      if (batchToDelete === activeBatchId) {
        setActiveBatch(null);
      }
      await deleteBatch.mutateAsync(batchToDelete);
      setBatchToDelete(null);
    }
  };

  const getAgentName = (agentId: string | null) => {
    if (!agentId || !profiles) return '-';
    const prof = profiles.find(p => p.id === agentId);
    return prof?.display_name || prof?.full_name || '-';
  };

  const filteredCustomers = displayCustomers.filter((customer) => {
    const matchesSearch = 
      customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.nrc_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.mobile_number?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || customer.payment_status === statusFilter;
    const matchesAgent = agentFilter === "all" || customer.assigned_agent === agentFilter;
    
    return matchesSearch && matchesStatus && matchesAgent;
  });

  const displayName = profile?.display_name || profile?.full_name?.split(' ')[0] || 'Agent';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{displayName}'s Customers</h1>
          <p className="text-muted-foreground">
            {activeBatch ? `Viewing batch: ${activeBatch.name}` : 'Global customer registry'}
          </p>
        </div>
        
        <div className="flex gap-2">
          {activeBatch && (
            <Button 
              variant="destructive" 
              size="sm"
              onClick={() => setBatchToDelete(activeBatchId!)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Batch
            </Button>
          )}
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="h-4 w-4 mr-2" />
                Add Customer
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Add New Customer</DialogTitle>
                <DialogDescription>
                  Add a walk-in customer who was not included in the CSV import. A ticket will be automatically created.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Full Name *</Label>
                  <Input
                    id="name"
                    placeholder="Enter customer name"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="nrc">NRC Number *</Label>
                  <Input
                    id="nrc"
                    placeholder="e.g., 123456/78/1"
                    value={newCustomerNrc}
                    onChange={(e) => setNewCustomerNrc(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="mobile">Mobile Number</Label>
                  <Input
                    id="mobile"
                    placeholder="e.g., 0971234567"
                    value={newCustomerMobile}
                    onChange={(e) => setNewCustomerMobile(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="amount">Total Amount Owed (ZMW) *</Label>
                  <Input
                    id="amount"
                    type="number"
                    placeholder="Enter amount"
                    value={newCustomerAmount}
                    onChange={(e) => setNewCustomerAmount(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="agent">Assigned Agent</Label>
                  <Select value={newCustomerAgent} onValueChange={setNewCustomerAgent}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles?.map(prof => (
                        <SelectItem key={prof.id} value={prof.id}>
                          {prof.display_name || prof.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddCustomer} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    'Add Customer'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, NRC or mobile..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Payment Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Not Paid">Not Paid</SelectItem>
                <SelectItem value="Partially Paid">Partially Paid</SelectItem>
                <SelectItem value="Fully Paid">Fully Paid</SelectItem>
              </SelectContent>
            </Select>
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {profiles?.map(prof => (
                  <SelectItem key={prof.id} value={prof.id}>
                    {prof.display_name || prof.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>NRC Number</TableHead>
                  <TableHead>Mobile</TableHead>
                  {activeBatchId && <TableHead className="text-right">Batch Amount</TableHead>}
                  <TableHead className="text-right">Total Owed</TableHead>
                  <TableHead className="text-right">Total Paid</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={activeBatchId ? 10 : 9} className="text-center py-8 text-muted-foreground">
                      {!masterCustomers?.length 
                        ? "No customers yet. Create a new batch to import customers." 
                        : "No customers found"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCustomers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium">{customer.name}</TableCell>
                      <TableCell className="font-mono text-sm">{customer.nrc_number}</TableCell>
                      <TableCell className="font-mono text-sm">{customer.mobile_number || '-'}</TableCell>
                      {activeBatchId && (
                        <TableCell className="text-right font-medium">
                          {formatCurrency(customer.batchAmount)}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-semibold text-destructive">
                        {formatCurrency(Number(customer.total_owed))}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-success">
                        {formatCurrency(Number(customer.total_paid))}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(Number(customer.outstanding_balance))}
                      </TableCell>
                      <TableCell>{getStatusBadge(customer.payment_status)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {getAgentName(customer.assigned_agent)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link to={`/customers/${customer.id}`}>
                                <Eye className="h-4 w-4 mr-2" />
                                View Profile
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link to={`/tickets?customerId=${customer.id}`}>
                                <Ticket className="h-4 w-4 mr-2" />
                                View Ticket
                              </Link>
                            </DropdownMenuItem>
                            {customer.mobile_number && (
                              <DropdownMenuItem asChild>
                                <a href={`tel:${customer.mobile_number}`}>
                                  <Phone className="h-4 w-4 mr-2" />
                                  Call Customer
                                </a>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredCustomers.length} of {displayCustomers.length} customers
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!batchToDelete} onOpenChange={(open) => !open && setBatchToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Batch</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this batch? This will remove the batch and all customer associations. The customers themselves will remain in the master registry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteBatch} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Batch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
