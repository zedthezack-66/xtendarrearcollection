import { useState } from "react";
import { Search, Filter, MoreHorizontal, Eye, Ticket, Phone, UserPlus } from "lucide-react";
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
import { useAppStore } from "@/store/useAppStore";
import { PaymentStatus } from "@/types";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 0,
  }).format(amount);
};

const getStatusBadge = (status: PaymentStatus) => {
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
  const { masterCustomers, batchCustomers, activeBatchId, settings, batches, addCustomerToBatch, createBatch } = useAppStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  
  // Add customer dialog state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerNrc, setNewCustomerNrc] = useState("");
  const [newCustomerAmount, setNewCustomerAmount] = useState("");
  const [newCustomerAgent, setNewCustomerAgent] = useState(settings.agent1Name);

  // Get customers based on active batch
  const getDisplayCustomers = () => {
    if (!activeBatchId) {
      // Global view - show all master customers
      return masterCustomers.map(mc => ({
        ...mc,
        batchAmount: mc.totalOwed,
      }));
    }
    
    // Batch view - show customers in this batch with their global data
    const batchCustomerIds = batchCustomers
      .filter(bc => bc.batchId === activeBatchId)
      .map(bc => ({ masterCustomerId: bc.masterCustomerId, batchAmount: bc.amountOwed }));
    
    return batchCustomerIds.map(({ masterCustomerId, batchAmount }) => {
      const master = masterCustomers.find(mc => mc.id === masterCustomerId);
      if (!master) return null;
      return { ...master, batchAmount };
    }).filter(Boolean) as (typeof masterCustomers[0] & { batchAmount: number })[];
  };

  const displayCustomers = getDisplayCustomers();
  const activeBatch = batches.find(b => b.id === activeBatchId);

  const handleAddCustomer = () => {
    if (!newCustomerName.trim() || !newCustomerNrc.trim() || !newCustomerAmount) {
      toast.error("Please fill in all fields");
      return;
    }

    const amount = parseFloat(newCustomerAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    // If there's an active batch, add to that batch
    // Otherwise create a "Walk-in Customers" batch
    let targetBatchId = activeBatchId;
    
    if (!targetBatchId) {
      // Check if walk-in batch exists
      const walkInBatch = batches.find(b => b.name === "Walk-in Customers");
      if (walkInBatch) {
        targetBatchId = walkInBatch.id;
      } else {
        // Create walk-in batch
        targetBatchId = createBatch("Walk-in Customers", "Direct Payments");
      }
    }

    addCustomerToBatch(targetBatchId, newCustomerNrc.trim(), newCustomerName.trim(), amount, newCustomerAgent);
    
    toast.success(`Customer ${newCustomerName} added successfully`);
    
    // Reset form
    setNewCustomerName("");
    setNewCustomerNrc("");
    setNewCustomerAmount("");
    setNewCustomerAgent(settings.agent1Name);
    setIsAddDialogOpen(false);
  };

  const filteredCustomers = displayCustomers.filter((customer) => {
    const matchesSearch = 
      customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.nrcNumber.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || customer.paymentStatus === statusFilter;
    const matchesAgent = agentFilter === "all" || customer.assignedAgent === agentFilter;
    
    return matchesSearch && matchesStatus && matchesAgent;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Customers</h1>
          <p className="text-muted-foreground">
            {activeBatch ? `Viewing batch: ${activeBatch.name}` : 'Global customer registry'}
          </p>
        </div>
        
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
                Add a walk-in customer who wasn't included in the CSV import. A ticket will be automatically created.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  placeholder="Enter customer name"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="nrc">NRC Number</Label>
                <Input
                  id="nrc"
                  placeholder="e.g., 123456/78/1"
                  value={newCustomerNrc}
                  onChange={(e) => setNewCustomerNrc(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="amount">Total Amount Owed (ZMW)</Label>
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
                    <SelectItem value={settings.agent1Name}>{settings.agent1Name}</SelectItem>
                    <SelectItem value={settings.agent2Name}>{settings.agent2Name}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddCustomer}>
                Add Customer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or NRC number..."
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
                <SelectItem value={settings.agent1Name}>{settings.agent1Name}</SelectItem>
                <SelectItem value={settings.agent2Name}>{settings.agent2Name}</SelectItem>
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
                    <TableCell colSpan={activeBatchId ? 9 : 8} className="text-center py-8 text-muted-foreground">
                      {masterCustomers.length === 0 
                        ? "No customers yet. Create a new batch to import customers." 
                        : "No customers found"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCustomers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium">{customer.name}</TableCell>
                      <TableCell className="font-mono text-sm">{customer.nrcNumber}</TableCell>
                      {activeBatchId && (
                        <TableCell className="text-right font-medium">
                          {formatCurrency(customer.batchAmount)}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-semibold text-destructive">
                        {formatCurrency(customer.totalOwed)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-success">
                        {formatCurrency(customer.totalPaid)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(customer.outstandingBalance)}
                      </TableCell>
                      <TableCell>{getStatusBadge(customer.paymentStatus)}</TableCell>
                      <TableCell className="text-muted-foreground">{customer.assignedAgent}</TableCell>
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
                            <DropdownMenuItem>
                              <Phone className="h-4 w-4 mr-2" />
                              Call Customer
                            </DropdownMenuItem>
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
    </div>
  );
}
