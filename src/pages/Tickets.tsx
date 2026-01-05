import { useState, useEffect, useMemo } from "react";
import { Search, MoreHorizontal, Eye, CheckCircle, PlayCircle, Loader2, Phone, Trash2, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
import { useTickets, useUpdateTicket, useProfiles, useDeleteTicket, usePayments } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);
};

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'Open': return <Badge className="bg-warning/10 text-warning border-warning/20 whitespace-nowrap">Open</Badge>;
    case 'In Progress': return <Badge className="bg-info/10 text-info border-info/20 whitespace-nowrap">In Progress</Badge>;
    case 'Resolved': return <Badge className="bg-success/10 text-success border-success/20 whitespace-nowrap">Resolved</Badge>;
    default: return <Badge variant="outline" className="whitespace-nowrap">{status}</Badge>;
  }
};

const getPriorityBadge = (priority: string) => {
  switch (priority) {
    case 'High': return <Badge variant="destructive">High</Badge>;
    case 'Medium': return <Badge className="bg-warning/10 text-warning border-warning/20">Medium</Badge>;
    case 'Low': return <Badge variant="outline">Low</Badge>;
    default: return <Badge variant="outline">{priority}</Badge>;
  }
};

export default function Tickets() {
  const { data: tickets, isLoading } = useTickets();
  const { data: profiles } = useProfiles();
  const { data: payments = [] } = usePayments();
  const { profile } = useAuth();
  const updateTicket = useUpdateTicket();
  const deleteTicket = useDeleteTicket();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [ticketToDelete, setTicketToDelete] = useState<string | null>(null);
  const [blockedResolveModal, setBlockedResolveModal] = useState<{ ticketId: string; balance: number } | null>(null);

  // Realtime subscription for tickets
  useEffect(() => {
    const channel = supabase
      .channel('tickets-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        queryClient.invalidateQueries({ queryKey: ['tickets'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Compute payments per ticket
  const paymentsByTicket = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of payments) {
      if (p.ticket_id) {
        map[p.ticket_id] = (map[p.ticket_id] || 0) + Number(p.amount);
      }
    }
    return map;
  }, [payments]);

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  // Sort order: In Progress (top), Open (middle), Resolved (bottom)
  const statusOrder: Record<string, number> = { 'In Progress': 0, 'Open': 1, 'Resolved': 2 };

  const getAgentName = (agentId: string | null) => {
    if (!agentId || !profiles) return '-';
    const p = profiles.find(p => p.id === agentId);
    return (p as any)?.display_name || p?.full_name || '-';
  };

  const filteredTickets = (tickets || [])
    .filter((ticket) => {
      const matchesSearch = 
        ticket.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ticket.nrc_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ticket.mobile_number?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "all" || ticket.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || ticket.priority === priorityFilter;
      const matchesAgent = agentFilter === "all" || ticket.assigned_agent === agentFilter;
      return matchesSearch && matchesStatus && matchesPriority && matchesAgent;
    })
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  const handleDeleteTicket = async () => {
    if (ticketToDelete) {
      await deleteTicket.mutateAsync(ticketToDelete);
      setTicketToDelete(null);
    }
  };

  const handleResolveTicket = async (ticketId: string) => {
    const totalPaid = paymentsByTicket[ticketId] || 0;
    const ticket = tickets?.find(t => t.id === ticketId);
    const amountOwed = ticket ? Number(ticket.amount_owed) : 0;
    const balance = Math.max(0, amountOwed - totalPaid);
    
    if (totalPaid < amountOwed) {
      setBlockedResolveModal({ ticketId, balance });
      return;
    }
    
    updateTicket.mutate({ id: ticketId, status: 'Resolved', resolved_date: new Date().toISOString() });
  };

  const currentProfile = profiles?.find(p => p.id === profile?.id);
  const displayName = (currentProfile as any)?.display_name || profile?.full_name?.split(' ')[0] || 'Agent';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{displayName}'s Tickets</h1>
        <p className="text-muted-foreground">Manage collections workflow</p>
      </div>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by customer, NRC or mobile..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Open">Open</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="High">High</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="Low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Agent" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {profiles?.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>NRC</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead className="text-right">Amount Owed</TableHead>
                  <TableHead className="text-right">Total Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTickets.length === 0 ? (
                  <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">No tickets found</TableCell></TableRow>
                ) : (
                  filteredTickets.map((ticket) => {
                    const totalPaid = paymentsByTicket[ticket.id] || 0;
                    const amountOwed = Number(ticket.amount_owed);
                    const balance = Math.max(0, amountOwed - totalPaid);
                    
                    return (
                      <TableRow key={ticket.id}>
                        <TableCell className="font-mono text-sm">#{ticket.id.slice(0, 8)}</TableCell>
                        <TableCell className="font-medium">{ticket.customer_name}</TableCell>
                        <TableCell className="font-mono text-sm">{ticket.nrc_number}</TableCell>
                        <TableCell className="font-mono text-sm">{ticket.mobile_number || '-'}</TableCell>
                        <TableCell className="text-right font-semibold text-destructive">{formatCurrency(amountOwed)}</TableCell>
                        <TableCell className="text-right font-semibold text-success">{formatCurrency(totalPaid)}</TableCell>
                        <TableCell className={`text-right font-semibold ${balance > 0 ? 'text-destructive' : 'text-success'}`}>
                          {formatCurrency(balance)}
                        </TableCell>
                        <TableCell>{getPriorityBadge(ticket.priority)}</TableCell>
                        <TableCell>{getStatusBadge(ticket.status)}</TableCell>
                        <TableCell className="text-muted-foreground">{getAgentName(ticket.assigned_agent)}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(ticket.created_at)}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild><Link to={`/customers/${ticket.master_customer_id}`}><Eye className="h-4 w-4 mr-2" />View Customer</Link></DropdownMenuItem>
                              {ticket.mobile_number && <DropdownMenuItem asChild><a href={`tel:${ticket.mobile_number}`}><Phone className="h-4 w-4 mr-2" />Call</a></DropdownMenuItem>}
                              {ticket.status === 'Open' && <DropdownMenuItem onClick={() => updateTicket.mutate({ id: ticket.id, status: 'In Progress' })}><PlayCircle className="h-4 w-4 mr-2" />Mark In Progress</DropdownMenuItem>}
                              {ticket.status !== 'Resolved' && (
                                <DropdownMenuItem 
                                  onClick={() => handleResolveTicket(ticket.id)}
                                  disabled={balance > 0}
                                  className={balance > 0 ? 'opacity-50' : ''}
                                >
                                  <CheckCircle className="h-4 w-4 mr-2" />
                                  Mark Resolved {balance > 0 && <span className="ml-1 text-xs text-destructive">(Blocked)</span>}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-destructive focus:text-destructive"
                                onClick={() => setTicketToDelete(ticket.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />Delete Ticket
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
          <div className="mt-4 text-sm text-muted-foreground">Showing {filteredTickets.length} of {tickets?.length || 0} tickets</div>
        </CardContent>
      </Card>

      <AlertDialog open={!!ticketToDelete} onOpenChange={(open) => !open && setTicketToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ticket</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the ticket, related batch customer, master customer, all payments, and call notes. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteTicket} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Blocked Resolve Modal */}
      <Dialog open={!!blockedResolveModal} onOpenChange={(open) => !open && setBlockedResolveModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Cannot Resolve Ticket
            </DialogTitle>
            <DialogDescription>
              Full payment is required to resolve this ticket.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-destructive/10 rounded-lg border border-destructive/20">
            <p className="text-sm text-muted-foreground">Outstanding Balance:</p>
            <p className="text-2xl font-bold text-destructive">
              {formatCurrency(blockedResolveModal?.balance || 0)}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockedResolveModal(null)}>
              Close
            </Button>
            <Button asChild>
              <Link to={`/payments/new?customerId=${tickets?.find(t => t.id === blockedResolveModal?.ticketId)?.master_customer_id}`}>
                Record Payment
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}