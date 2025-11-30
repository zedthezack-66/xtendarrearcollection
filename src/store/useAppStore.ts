import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Customer, Ticket, Payment, AppSettings, PaymentStatus } from '@/types';

interface AppState {
  customers: Customer[];
  tickets: Ticket[];
  payments: Payment[];
  settings: AppSettings;
  
  // Customer actions
  addCustomers: (customers: Customer[]) => void;
  updateCustomer: (id: string, updates: Partial<Customer>) => void;
  
  // Ticket actions
  addTickets: (tickets: Ticket[]) => void;
  updateTicket: (id: string, updates: Partial<Ticket>) => void;
  
  // Payment actions
  addPayment: (payment: Payment) => void;
  
  // Settings actions
  updateSettings: (settings: Partial<AppSettings>) => void;
  
  // Utility
  clearAllData: () => void;
}

const generateId = () => Math.random().toString(36).substring(2, 11);

const calculatePaymentStatus = (amountOwed: number, totalPaid: number): PaymentStatus => {
  if (totalPaid >= amountOwed) return 'Fully Paid';
  if (totalPaid > 0) return 'Partially Paid';
  return 'Not Paid';
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      customers: [],
      tickets: [],
      payments: [],
      settings: {
        agent1Name: 'Agent 1',
        agent2Name: 'Agent 2',
      },
      
      addCustomers: (newCustomers) => set((state) => ({
        customers: [...state.customers, ...newCustomers],
      })),
      
      updateCustomer: (id, updates) => set((state) => ({
        customers: state.customers.map((c) =>
          c.id === id ? { ...c, ...updates, lastUpdated: new Date() } : c
        ),
      })),
      
      addTickets: (newTickets) => set((state) => ({
        tickets: [...state.tickets, ...newTickets],
      })),
      
      updateTicket: (id, updates) => set((state) => ({
        tickets: state.tickets.map((t) =>
          t.id === id ? { ...t, ...updates, lastUpdated: new Date() } : t
        ),
      })),
      
      addPayment: (payment) => set((state) => {
        const customer = state.customers.find((c) => c.id === payment.customerId);
        const ticket = state.tickets.find((t) => t.id === payment.ticketId);
        
        if (!customer || !ticket) return state;
        
        const newTotalPaid = customer.totalPaid + payment.amount;
        const newPaymentStatus = calculatePaymentStatus(customer.amountOwed, newTotalPaid);
        const isFullyPaid = newPaymentStatus === 'Fully Paid';
        
        return {
          payments: [...state.payments, payment],
          customers: state.customers.map((c) =>
            c.id === payment.customerId
              ? {
                  ...c,
                  totalPaid: newTotalPaid,
                  paymentStatus: newPaymentStatus,
                  lastUpdated: new Date(),
                }
              : c
          ),
          tickets: state.tickets.map((t) =>
            t.id === payment.ticketId
              ? {
                  ...t,
                  status: isFullyPaid ? 'Resolved' : t.status,
                  resolvedDate: isFullyPaid ? new Date() : t.resolvedDate,
                  lastUpdated: new Date(),
                }
              : t
          ),
        };
      }),
      
      updateSettings: (newSettings) => set((state) => ({
        settings: { ...state.settings, ...newSettings },
      })),
      
      clearAllData: () => set({
        customers: [],
        tickets: [],
        payments: [],
      }),
    }),
    {
      name: 'loan-collections-storage',
      partialize: (state) => ({
        customers: state.customers,
        tickets: state.tickets,
        payments: state.payments,
        settings: state.settings,
      }),
    }
  )
);

// Helper function to create customers and tickets from CSV
export const createCustomersAndTicketsFromCSV = (
  rows: { name: string; nrcNumber: string; amountOwed: number }[],
  settings: AppSettings
): { customers: Customer[]; tickets: Ticket[] } => {
  const customers: Customer[] = [];
  const tickets: Ticket[] = [];
  const agents = [settings.agent1Name, settings.agent2Name];
  
  rows.forEach((row, index) => {
    const customerId = generateId();
    const ticketId = generateId();
    const assignedAgent = agents[index % 2]; // 50/50 distribution
    const now = new Date();
    
    customers.push({
      id: customerId,
      nrcNumber: row.nrcNumber,
      name: row.name,
      amountOwed: row.amountOwed,
      totalPaid: 0,
      paymentStatus: 'Not Paid',
      callNotes: '',
      willPayTomorrow: false,
      noCall: false,
      assignedAgent,
      ticketId,
      createdDate: now,
      lastUpdated: now,
    });
    
    tickets.push({
      id: ticketId,
      customerId,
      customerName: row.name,
      nrcNumber: row.nrcNumber,
      amountOwed: row.amountOwed,
      priority: 'High',
      status: 'Open',
      assignedAgent,
      callNotes: '',
      createdDate: now,
      resolvedDate: null,
      lastUpdated: now,
    });
  });
  
  return { customers, tickets };
};
