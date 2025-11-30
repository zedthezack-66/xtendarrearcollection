export type PaymentStatus = 'Not Paid' | 'Partially Paid' | 'Fully Paid';
export type TicketStatus = 'Open' | 'In Progress' | 'Resolved';
export type TicketPriority = 'High' | 'Medium' | 'Low';
export type AgentName = string;

export interface Customer {
  id: string;
  nrcNumber: string;
  name: string;
  amountOwed: number;
  totalPaid: number;
  paymentStatus: PaymentStatus;
  callNotes: string;
  willPayTomorrow: boolean;
  noCall: boolean;
  assignedAgent: AgentName;
  ticketId: string;
  createdDate: Date;
  lastUpdated: Date;
}

export interface Ticket {
  id: string;
  customerId: string;
  customerName: string;
  nrcNumber: string;
  amountOwed: number;
  priority: TicketPriority;
  status: TicketStatus;
  assignedAgent: AgentName;
  callNotes: string;
  createdDate: Date;
  resolvedDate: Date | null;
  lastUpdated: Date;
}

export interface Payment {
  id: string;
  ticketId: string;
  customerId: string;
  customerName: string;
  amount: number;
  date: Date;
  notes: string;
  createdDate: Date;
}

export interface AppSettings {
  agent1Name: string;
  agent2Name: string;
}

export interface DashboardStats {
  totalCustomers: number;
  totalOutstanding: number;
  totalCollected: number;
  collectionRate: number;
  openTickets: number;
  resolvedTickets: number;
  ticketsByPriority: { priority: TicketPriority; count: number }[];
  ticketsByStatus: { status: TicketStatus; count: number }[];
  collectionsByAgent: { agent: string; amount: number }[];
}
