import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Search, MoreHorizontal, Eye, CheckCircle, PlayCircle, Loader2, Phone, Trash2, AlertTriangle, ChevronDown, ChevronUp, MessageSquare, Building, User2, Clock, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InlineNoteInput } from "@/components/InlineNoteInput";
import { TicketStatusDropdowns, ARREAR_STATUS_OPTIONS, PAYMENT_STATUS_OPTIONS, EMPLOYER_REASON_OPTIONS } from "@/components/TicketStatusDropdowns";
import { BatchTransferDialog } from "@/components/BatchTransferDialog";
import { BulkTransferDialog } from "@/components/BulkTransferDialog";
import { EditableAmountOwed } from "@/components/EditableAmountOwed";
import { useTickets, useUpdateTicket, useProfiles, useDeleteTicket, usePayments, useCallLogsForTickets, useCreateCallLog, useUpdateCallLog, useMasterCustomers } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', minimumFractionDigits: 0 }).format(amount);
};

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const getStatusBadge = (status: string, hasNotes?: boolean) => {
  const baseClasses = hasNotes ? 'cursor-help' : '';
  switch (status) {
    case 'Open': return <Badge className={`bg-warning/10 text-warning border-warning/20 whitespace-nowrap ${baseClasses}`}>Open</Badge>;
    case 'In Progress': return <Badge className={`bg-info/10 text-info border-info/20 whitespace-nowrap ${baseClasses}`}>In Progress</Badge>;
    case 'Resolved': return <Badge className={`bg-success/10 text-success border-success/20 whitespace-nowrap ${baseClasses}`}>Resolved</Badge>;
    case 'Pending Confirmation': return <Badge className={`bg-amber-500/10 text-amber-600 border-amber-500/20 whitespace-nowrap animate-pulse ${baseClasses}`}>⚠️ Pending Confirmation</Badge>;
    default: return <Badge variant="outline" className={`whitespace-nowrap ${baseClasses}`}>{status}</Badge>;
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
  const { data: masterCustomers = [] } = useMasterCustomers();
  const { profile, user, isAdmin } = useAuth();
  const updateTicket = useUpdateTicket();
  const deleteTicket = useDeleteTicket();
  const createCallLog = useCreateCallLog();
  const updateCallLog = useUpdateCallLog();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [amountSort, setAmountSort] = useState<string>("none");
  const [ticketToDelete, setTicketToDelete] = useState<string | null>(null);
  const [blockedResolveModal, setBlockedResolveModal] = useState<{ ticketId: string; balance: number } | null>(null);
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  const [expandedStatuses, setExpandedStatuses] = useState<Record<string, boolean>>({});
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set());

  // Handler for updating ticket status dropdowns
  const handleTicketStatusUpdate = useCallback(async (
    ticketId: string,
    field: 'ticket_arrear_status' | 'ticket_payment_status' | 'employer_reason_for_arrears',
    value: string
  ) => {
    try {
      await updateTicket.mutateAsync({ id: ticketId, [field]: value });
      toast({ title: "Status updated", description: `${field.replace(/_/g, ' ')} saved` });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  }, [updateTicket, toast]);

  const toggleStatuses = (ticketId: string) => {
    setExpandedStatuses(prev => ({ ...prev, [ticketId]: !prev[ticketId] }));
  };

  // Get all ticket IDs for fetching call logs - memoized to prevent unnecessary re-renders
  const allTicketIds = useMemo(() => {
    if (!tickets || tickets.length === 0) return [];
    return tickets.map(t => t.id);
  }, [tickets]);

  // Fetch call logs for all tickets - only when we have tickets
  const { data: callLogs = [], isLoading: isLoadingCallLogs } = useCallLogsForTickets(allTicketIds);

  // Group call logs by ticket ID - memoized for performance
  const callLogsByTicket = useMemo(() => {
    if (!callLogs || callLogs.length === 0) return {};
    const map: Record<string, typeof callLogs> = {};
    for (const log of callLogs) {
      if (!map[log.ticket_id]) {
        map[log.ticket_id] = [];
      }
      map[log.ticket_id].push(log);
    }
    return map;
  }, [callLogs]);

  // Realtime subscription for tickets and call_logs
  useEffect(() => {
    const channel = supabase
      .channel('tickets-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        queryClient.invalidateQueries({ queryKey: ['tickets'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_logs' }, () => {
        // Invalidate all call_logs queries to ensure dashboard gets fresh data
        queryClient.invalidateQueries({ queryKey: ['call_logs'] });
        // Force immediate refetch
        queryClient.refetchQueries({ queryKey: ['call_logs'] });
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

  // Handler for inline note save (add or update) - MUST be before any early returns
  const handleInlineNoteSave = useCallback(async (
    ticketId: string,
    masterCustomerId: string,
    note: string,
    isUpdate: boolean,
    noteId?: string
  ) => {
    if (isUpdate && noteId) {
      // Update existing note
      await updateCallLog.mutateAsync({ id: noteId, notes: note });
    } else {
      // Create new note with default outcome
      await createCallLog.mutateAsync({
        ticket_id: ticketId,
        master_customer_id: masterCustomerId,
        call_outcome: 'Note Added',
        notes: note,
      });
    }
  }, [createCallLog, updateCallLog]);

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  // Sort order: In Progress (top), Open (middle), Resolved (bottom)
  const statusOrder: Record<string, number> = { 'In Progress': 0, 'Open': 1, 'Resolved': 2 };

  const formatDateTime = (date: string) => {
    return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const toggleNotes = (ticketId: string) => {
    setExpandedNotes(prev => ({ ...prev, [ticketId]: !prev[ticketId] }));
  };

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
    .sort((a, b) => {
      // Primary sort: amount owed if selected
      if (amountSort === "high") {
        return Number(b.amount_owed) - Number(a.amount_owed);
      } else if (amountSort === "low") {
        return Number(a.amount_owed) - Number(b.amount_owed);
      }
      // Default: sort by status (In Progress first, then Open, then Resolved)
      return statusOrder[a.status] - statusOrder[b.status];
    });

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{displayName}'s Tickets</h1>
          <p className="text-muted-foreground">Manage collections workflow</p>
        </div>
        {isAdmin && (
          <BulkTransferDialog 
            selectedTicketIds={Array.from(selectedTickets)} 
            onTransferComplete={() => setSelectedTickets(new Set())}
            disabled={selectedTickets.size === 0}
          />
        )}
      </div>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by customer, NRC or mobile..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Pending Confirmation">⚠️ Pending Confirmation</SelectItem>
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
            <Select value={amountSort} onValueChange={setAmountSort}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Sort by Amount" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Default Sort</SelectItem>
                <SelectItem value="high">Amount: High → Low</SelectItem>
                <SelectItem value="low">Amount: Low → High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full">
            <Table className="w-full table-fixed">
              <TableHeader>
                <TableRow>
                  {isAdmin && (
                    <TableHead className="w-10">
                      <input 
                        type="checkbox" 
                        checked={selectedTickets.size === filteredTickets.length && filteredTickets.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedTickets(new Set(filteredTickets.map(t => t.id)));
                          } else {
                            setSelectedTickets(new Set());
                          }
                        }}
                        className="h-4 w-4 rounded border-muted"
                      />
                    </TableHead>
                  )}
                  <TableHead className="w-[15%]">Customer</TableHead>
                  <TableHead className="w-[12%] hidden sm:table-cell">NRC</TableHead>
                  <TableHead className="text-right w-[10%]">Owed</TableHead>
                  <TableHead className="text-right w-[10%] hidden md:table-cell">Paid</TableHead>
                  <TableHead className="text-right w-[10%]">Balance</TableHead>
                  <TableHead className="w-[8%] hidden lg:table-cell">Priority</TableHead>
                  <TableHead className="w-[10%]">Status</TableHead>
                  <TableHead className="w-[10%] hidden md:table-cell">Agent</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTickets.length === 0 ? (
                  <TableRow><TableCell colSpan={isAdmin ? 11 : 10} className="text-center py-8 text-muted-foreground">No tickets found</TableCell></TableRow>
                ) : (
                  filteredTickets.map((ticket) => {
                    const totalPaid = paymentsByTicket[ticket.id] || 0;
                    const amountOwed = Number(ticket.amount_owed);
                    const balance = Math.max(0, amountOwed - totalPaid);
                    const ticketCallLogs = callLogsByTicket[ticket.id] || [];
                    const hasCallLogs = ticketCallLogs.length > 0;
                    const latestNote = ticketCallLogs[0];
                    const isExpanded = expandedNotes[ticket.id];
                    
                    const masterCustomer = masterCustomers.find(mc => mc.id === ticket.master_customer_id);
                    const hasStaticInfo = masterCustomer?.branch_name || masterCustomer?.employer_name || masterCustomer?.loan_consultant;
                    
                    return (
                      <React.Fragment key={ticket.id}>
                        {/* Primary Info Row */}
                        <TableRow 
                          className={`${hasCallLogs ? 'cursor-pointer hover:bg-muted/50 border-b-0' : ''} ${ticket.status === 'Resolved' ? 'bg-success/5' : ''}`} 
                          onClick={hasCallLogs ? () => toggleNotes(ticket.id) : undefined}
                        >
                          {isAdmin && (
                            <TableCell onClick={(e) => e.stopPropagation()} className="py-2">
                              <input 
                                type="checkbox" 
                                checked={selectedTickets.has(ticket.id)}
                                onChange={(e) => {
                                  const newSelected = new Set(selectedTickets);
                                  if (e.target.checked) {
                                    newSelected.add(ticket.id);
                                  } else {
                                    newSelected.delete(ticket.id);
                                  }
                                  setSelectedTickets(newSelected);
                                }}
                                className="h-4 w-4 rounded border-muted"
                              />
                            </TableCell>
                          )}
                          <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              {hasCallLogs && (
                                isExpanded ? <ChevronUp className="h-3 w-3 text-info flex-shrink-0" /> : <ChevronDown className="h-3 w-3 text-info flex-shrink-0" />
                              )}
                              {hasStaticInfo ? (
                                <HoverCard>
                                  <HoverCardTrigger asChild>
                                    <span className="cursor-help underline decoration-dotted underline-offset-2 truncate font-medium">{ticket.customer_name}</span>
                                  </HoverCardTrigger>
                                  <HoverCardContent className="w-72 z-50" side="right">
                                    <div className="space-y-2">
                                      <p className="font-semibold text-sm">{ticket.customer_name}</p>
                                      <p className="text-xs font-mono text-muted-foreground">NRC: {ticket.nrc_number}</p>
                                      {ticket.mobile_number && <p className="text-xs font-mono text-muted-foreground">Mobile: {ticket.mobile_number}</p>}
                                      <div className="text-xs space-y-1 text-muted-foreground pt-1 border-t">
                                        {masterCustomer?.branch_name && (
                                          <div className="flex items-center gap-2">
                                            <Building className="h-3 w-3" />
                                            <span>Branch: {masterCustomer.branch_name}</span>
                                          </div>
                                        )}
                                        {masterCustomer?.employer_name && (
                                          <div className="flex items-center gap-2">
                                            <Building className="h-3 w-3" />
                                            <span>Employer: {masterCustomer.employer_name}</span>
                                          </div>
                                        )}
                                        {masterCustomer?.employer_subdivision && (
                                          <div className="flex items-center gap-2">
                                            <Building className="h-3 w-3" />
                                            <span>Subdivision: {masterCustomer.employer_subdivision}</span>
                                          </div>
                                        )}
                                        {masterCustomer?.loan_consultant && (
                                          <div className="flex items-center gap-2">
                                            <User2 className="h-3 w-3" />
                                            <span>Consultant: {masterCustomer.loan_consultant}</span>
                                          </div>
                                        )}
                                        {masterCustomer?.tenure && (
                                          <div className="flex items-center gap-2">
                                            <Clock className="h-3 w-3" />
                                            <span>Tenure: {masterCustomer.tenure}</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </HoverCardContent>
                                </HoverCard>
                              ) : (
                                <span className="truncate font-medium">{ticket.customer_name}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs py-2 hidden sm:table-cell truncate">{ticket.nrc_number}</TableCell>
                          <TableCell className="text-right py-2 text-sm" onClick={(e) => e.stopPropagation()}>
                            <EditableAmountOwed
                              ticketId={ticket.id}
                              currentAmount={amountOwed}
                              canEdit={isAdmin || ticket.assigned_agent === profile?.id}
                              source="ticket_list"
                            />
                          </TableCell>
                          <TableCell className="text-right font-semibold text-success py-2 text-sm hidden md:table-cell">{formatCurrency(totalPaid)}</TableCell>
                          <TableCell className={`text-right font-semibold py-2 text-sm ${balance > 0 ? 'text-destructive' : 'text-success'}`}>
                            {formatCurrency(balance)}
                          </TableCell>
                          <TableCell className="py-2 hidden lg:table-cell">{getPriorityBadge(ticket.priority)}</TableCell>
                          <TableCell className="py-2">{getStatusBadge(ticket.status)}</TableCell>
                          <TableCell className="text-muted-foreground py-2 text-sm truncate hidden md:table-cell">{getAgentName(ticket.assigned_agent)}</TableCell>
                          <TableCell className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="z-50">
                                <DropdownMenuItem asChild><Link to={`/customers/${ticket.master_customer_id}`}><Eye className="h-4 w-4 mr-2" />View Customer</Link></DropdownMenuItem>
                                {ticket.mobile_number && <DropdownMenuItem asChild><a href={`tel:${ticket.mobile_number}`}><Phone className="h-4 w-4 mr-2" />Call {ticket.mobile_number}</a></DropdownMenuItem>}
                                
                                {/* Open: Show Mark In Progress */}
                                {ticket.status === 'Open' && (
                                  <DropdownMenuItem onClick={() => updateTicket.mutate({ id: ticket.id, status: 'In Progress' })}>
                                    <PlayCircle className="h-4 w-4 mr-2" />Mark In Progress
                                  </DropdownMenuItem>
                                )}
                                
                                {/* Not Resolved: Show Mark Resolved */}
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
                                
                                {/* Resolved: Show Reopen Ticket */}
                                {ticket.status === 'Resolved' && (
                                  <DropdownMenuItem 
                                    onClick={() => updateTicket.mutate({ id: ticket.id, status: 'Open' })}
                                    className="text-warning focus:text-warning"
                                  >
                                    <RotateCcw className="h-4 w-4 mr-2" />
                                    Reopen Ticket
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
                        
                        {/* Call Notes Inline Edit Row (always visible) */}
                        <TableRow className={`${ticket.status === 'Resolved' ? 'bg-success/5' : ''}`}>
                          <TableCell colSpan={isAdmin ? 11 : 10} className="pt-0 pb-3 border-b">
                            <div className="flex flex-wrap items-center justify-center gap-2 py-2">
                              <div className="flex-1 min-w-[180px] max-w-sm">
                                <InlineNoteInput
                                  ticketId={ticket.id}
                                  masterCustomerId={ticket.master_customer_id}
                                  existingNote={latestNote?.notes || ''}
                                  existingNoteId={latestNote?.id}
                                  existingOutcome={latestNote?.call_outcome}
                                  lastUpdated={latestNote?.created_at}
                                  onSave={async (note, isUpdate, noteId) => {
                                    await handleInlineNoteSave(ticket.id, ticket.master_customer_id, note, isUpdate, noteId);
                                  }}
                                  isLoading={createCallLog.isPending || updateCallLog.isPending}
                                />
                              </div>
                              <Button variant="outline" size="sm" className="h-8 px-2 text-xs flex-shrink-0" onClick={(e) => { e.stopPropagation(); toggleStatuses(ticket.id); }}>
                                {expandedStatuses[ticket.id] ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                                Status
                              </Button>
                              {isAdmin && (
                                <BatchTransferDialog ticketId={ticket.id} currentBatchId={ticket.batch_id} currentAgentId={ticket.assigned_agent} customerName={ticket.customer_name} />
                              )}
                              {hasCallLogs && (
                                <Button variant="ghost" size="sm" className="h-8 px-2 text-info hover:text-info hover:bg-info/10 flex-shrink-0" onClick={(e) => { e.stopPropagation(); toggleNotes(ticket.id); }}>
                                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                  <span className="ml-1 text-xs">{ticketCallLogs.length}</span>
                                </Button>
                              )}
                            </div>
                            {expandedStatuses[ticket.id] && (
                              <div className="bg-muted/30 rounded-lg p-3 border mt-3 max-w-xl mx-auto" onClick={(e) => e.stopPropagation()}>
                                <TicketStatusDropdowns
                                  ticketArrearStatus={(ticket as any).ticket_arrear_status}
                                  ticketPaymentStatus={(ticket as any).ticket_payment_status}
                                  employerReasonForArrears={(ticket as any).employer_reason_for_arrears}
                                  onArrearStatusChange={(value) => handleTicketStatusUpdate(ticket.id, 'ticket_arrear_status', value)}
                                  onPaymentStatusChange={(value) => handleTicketStatusUpdate(ticket.id, 'ticket_payment_status', value)}
                                  onEmployerReasonChange={(value) => handleTicketStatusUpdate(ticket.id, 'employer_reason_for_arrears', value)}
                                  isLoading={updateTicket.isPending}
                                  compact
                                />
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                        {hasCallLogs && isExpanded && (
                          <TableRow className="bg-info/5 hover:bg-info/5">
                            <TableCell colSpan={isAdmin ? 11 : 10} className="p-0">
                              <div className="p-4 space-y-3">
                                <div className="flex items-center gap-2 text-sm font-medium text-info">
                                  <MessageSquare className="h-4 w-4" />
                                  All Call Notes ({ticketCallLogs.length})
                                </div>
                                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                                  {ticketCallLogs.map((log) => (
                                    <div key={log.id} className="bg-background rounded-lg border p-3 space-y-2">
                                      <div className="flex items-center justify-between">
                                        <Badge variant="outline" className="text-xs">{log.call_outcome}</Badge>
                                        <span className="text-xs text-muted-foreground">{formatDateTime(log.created_at)}</span>
                                      </div>
                                      {log.notes && <p className="text-sm text-foreground">{log.notes}</p>}
                                      {log.promise_to_pay_date && (
                                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                          <span>Promise to Pay: {formatDate(log.promise_to_pay_date)}</span>
                                          {log.promise_to_pay_amount && <span className="font-semibold text-warning">{formatCurrency(Number(log.promise_to_pay_amount))}</span>}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="p-4 text-sm text-muted-foreground">Showing {filteredTickets.length} of {tickets?.length || 0} tickets</div>
        </CardContent>
      </Card>

      <AlertDialog open={!!ticketToDelete} onOpenChange={(open) => !open && setTicketToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ticket</AlertDialogTitle>
            <AlertDialogDescription>
              This will <strong>permanently delete</strong> the ticket, batch customer record, all payments, and call notes. If this customer has no other tickets, they will also be fully removed from the system. This action cannot be undone.
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