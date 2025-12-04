export type PaymentStatus = 'Not Paid' | 'Partially Paid' | 'Fully Paid';
export type TicketStatus = 'Open' | 'In Progress' | 'Resolved';
export type TicketPriority = 'High' | 'Medium' | 'Low';
export type PaymentMethod = 'Mobile Money' | 'Bank';
export type AgentName = string;

// Batch - represents a CSV upload batch
export interface Batch {
  id: string;
  name: string; // e.g., "MTN Loans Nov 2025"
  institutionName: string;
  uploadDate: Date;
  customerCount: number;
  totalAmount: number;
}

// Master Customer - global registry with NRC as unique identifier
export interface MasterCustomer {
  id: string;
  nrcNumber: string; // Unique identifier across all batches
  name: string;
  mobileNumber: string; // Contact number
  totalPaid: number;
  totalOwed: number; // Sum of all amounts from all batches
  outstandingBalance: number;
  paymentStatus: PaymentStatus;
  callNotes: string;
  ticketId: string; // Single global ticket
  assignedAgent: AgentName;
  createdDate: Date;
  lastUpdated: Date;
}

// Batch Customer - links a batch entry to a master customer
export interface BatchCustomer {
  id: string;
  batchId: string;
  masterCustomerId: string;
  nrcNumber: string;
  name: string;
  mobileNumber: string;
  amountOwed: number; // Amount from this specific batch
  linkedToMaster: boolean;
  createdDate: Date;
}

// Legacy Customer type for backwards compatibility
export interface Customer {
  id: string;
  nrcNumber: string;
  name: string;
  amountOwed: number;
  totalPaid: number;
  paymentStatus: PaymentStatus;
  callNotes: string;
  assignedAgent: AgentName;
  ticketId: string;
  createdDate: Date;
  lastUpdated: Date;
}

export interface Ticket {
  id: string;
  masterCustomerId: string;
  customerId: string; // For backwards compatibility
  customerName: string;
  nrcNumber: string;
  mobileNumber: string;
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
  masterCustomerId: string;
  customerId: string; // For backwards compatibility
  customerName: string;
  amount: number;
  paymentMethod: PaymentMethod;
  date: Date;
  notes: string;
  createdDate: Date;
}

export interface AppSettings {
  agent1Name: string;
  agent2Name: string;
  agent3Name: string;
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
