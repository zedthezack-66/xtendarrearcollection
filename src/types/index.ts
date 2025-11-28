export type CustomerStatus = 'active' | 'defaulted' | 'paid_off';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'mobile_money' | 'check';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'high' | 'medium' | 'low';
export type UserRole = 'admin' | 'manager' | 'agent' | 'finance';

export interface Customer {
  id: string;
  title: string;
  name: string;
  nrcId: string;
  phoneNumber: string;
  arrearAmount: number;
  employerName: string;
  paymentMethod: PaymentMethod;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  id: string;
  reference: string;
  customerId: string;
  customerName: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignedTo: string;
  assignedToName: string;
  dueDate: string;
  loanReference: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface Payment {
  id: string;
  customerId: string;
  customerName: string;
  amount: number;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  recordedBy: string;
  recordedByName: string;
  ticketId?: string;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
}

export interface DashboardStats {
  totalCustomers: number;
  totalDefaulted: number;
  totalArrearsOutstanding: number;
  openTickets: number;
  paymentsThisMonth: number;
  ticketsResolvedThisWeek: number;
}
