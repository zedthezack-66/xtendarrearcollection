import { useState } from "react";
import { Search, Filter, MoreHorizontal, Eye, CheckCircle, PlayCircle } from "lucide-react";
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
import { useAppStore } from "@/store/useAppStore";
import { TicketStatus, TicketPriority } from "@/types";

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

const getStatusBadge = (status: TicketStatus) => {
  switch (status) {
    case 'Open':
      return <Badge className="bg-warning/10 text-warning border-warning/20">Open</Badge>;
    case 'In Progress':
      return <Badge className="bg-info/10 text-info border-info/20">In Progress</Badge>;
    case 'Resolved':
      return <Badge className="bg-success/10 text-success border-success/20">Resolved</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

const getPriorityBadge = (priority: TicketPriority) => {
  switch (priority) {
    case 'High':
      return <Badge variant="destructive">High</Badge>;
    case 'Medium':
      return <Badge className="bg-warning/10 text-warning border-warning/20">Medium</Badge>;
    case 'Low':
      return <Badge variant="outline">Low</Badge>;
    default:
      return <Badge variant="outline">{priority}</Badge>;
  }
};

export default function Tickets() {
  const { tickets, settings, updateTicket } = useAppStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  // Sort tickets by status: Open > In Progress > Resolved
  const statusOrder: Record<TicketStatus, number> = {
    'Open': 0,
    'In Progress': 1,
    'Resolved': 2,
  };

  const filteredTickets = tickets
    .filter((ticket) => {
      const matchesSearch = 
        ticket.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ticket.nrcNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ticket.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ticket.mobileNumber?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === "all" || ticket.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || ticket.priority === priorityFilter;
      const matchesAgent = agentFilter === "all" || ticket.assignedAgent === agentFilter;
      
      return matchesSearch && matchesStatus && matchesPriority && matchesAgent;
    })
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  const handleMarkInProgress = (ticketId: string) => {
    updateTicket(ticketId, { status: 'In Progress' });
  };

  const handleMarkResolved = (ticketId: string) => {
    updateTicket(ticketId, { status: 'Resolved', resolvedDate: new Date() });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tickets</h1>
          <p className="text-muted-foreground">Manage collections workflow</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by customer, NRC or mobile..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Open">Open</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="High">High</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="Low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="w-[150px]">
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
                  <TableHead>Ticket ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>NRC Number</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead className="text-right">Amount Owed</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTickets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      {tickets.length === 0 ? "No tickets yet. Import a CSV to auto-create tickets." : "No tickets found"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTickets.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell className="font-mono text-sm font-medium">
                        #{ticket.id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="font-medium">{ticket.customerName}</TableCell>
                      <TableCell className="font-mono text-sm">{ticket.nrcNumber}</TableCell>
                      <TableCell className="font-mono text-sm">{ticket.mobileNumber || '-'}</TableCell>
                      <TableCell className="text-right font-semibold text-destructive">
                        {formatCurrency(ticket.amountOwed)}
                      </TableCell>
                      <TableCell>{getPriorityBadge(ticket.priority)}</TableCell>
                      <TableCell>{getStatusBadge(ticket.status)}</TableCell>
                      <TableCell className="text-muted-foreground">{ticket.assignedAgent}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(ticket.createdDate)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link to={`/customers/${ticket.customerId}`}>
                                <Eye className="h-4 w-4 mr-2" />
                                View Customer
                              </Link>
                            </DropdownMenuItem>
                            {ticket.status === 'Open' && (
                              <DropdownMenuItem onClick={() => handleMarkInProgress(ticket.id)}>
                                <PlayCircle className="h-4 w-4 mr-2" />
                                Mark In Progress
                              </DropdownMenuItem>
                            )}
                            {ticket.status !== 'Resolved' && (
                              <DropdownMenuItem onClick={() => handleMarkResolved(ticket.id)}>
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Mark Resolved
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
            Showing {filteredTickets.length} of {tickets.length} tickets
          </div>
        </CardContent>
      </Card>
    </div>
  );
}