import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  Batch, 
  MasterCustomer, 
  BatchCustomer, 
  Ticket, 
  Payment, 
  AppSettings, 
  PaymentStatus,
  PaymentMethod
} from '@/types';

interface AppState {
  // Batch system
  batches: Batch[];
  activeBatchId: string | null;
  
  // Master customer registry (global)
  masterCustomers: MasterCustomer[];
  
  // Batch-specific customers
  batchCustomers: BatchCustomer[];
  
  // Global tickets (one per customer)
  tickets: Ticket[];
  
  // Global payments
  payments: Payment[];
  
  settings: AppSettings;
  
  // Batch actions
  createBatch: (name: string, institutionName: string) => string;
  setActiveBatch: (batchId: string | null) => void;
  deleteBatch: (batchId: string) => void;
  
  // Customer actions
  addCustomerToBatch: (
    batchId: string, 
    nrcNumber: string, 
    name: string, 
    amountOwed: number,
    assignedAgent: string,
    mobileNumber?: string
  ) => void;
  updateMasterCustomer: (id: string, updates: Partial<MasterCustomer>) => void;
  
  // Ticket actions
  updateTicket: (id: string, updates: Partial<Ticket>) => void;
  
  // Payment actions
  addPayment: (payment: Omit<Payment, 'id' | 'createdDate'>) => void;
  
  // Settings actions
  updateSettings: (settings: Partial<AppSettings>) => void;
  
  // Utility
  clearAllData: () => void;
  
  // Getters
  getActiveBatchCustomers: () => (MasterCustomer & { batchAmount: number })[];
  getBatchById: (batchId: string) => Batch | undefined;
  getMasterCustomerByNrc: (nrcNumber: string) => MasterCustomer | undefined;
}

const generateId = () => Math.random().toString(36).substring(2, 11);

const calculatePaymentStatus = (totalOwed: number, totalPaid: number): PaymentStatus => {
  if (totalPaid >= totalOwed) return 'Fully Paid';
  if (totalPaid > 0) return 'Partially Paid';
  return 'Not Paid';
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      batches: [],
      activeBatchId: null,
      masterCustomers: [],
      batchCustomers: [],
      tickets: [],
      payments: [],
      settings: {
        agent1Name: 'Mike',
        agent2Name: 'Cathy',
        agent3Name: 'Martin',
      },
      
      createBatch: (name, institutionName) => {
        const batchId = generateId();
        const now = new Date();
        
        set((state) => ({
          batches: [
            ...state.batches,
            {
              id: batchId,
              name,
              institutionName,
              uploadDate: now,
              customerCount: 0,
              totalAmount: 0,
            },
          ],
          activeBatchId: batchId,
        }));
        
        return batchId;
      },
      
      setActiveBatch: (batchId) => set({ activeBatchId: batchId }),
      
      deleteBatch: (batchId) => set((state) => {
        // Remove batch customers but keep master customers and their data
        const batchCustomersToRemove = state.batchCustomers.filter(bc => bc.batchId === batchId);
        
        // Update master customers' totalOwed by subtracting batch amounts
        const updatedMasterCustomers = state.masterCustomers.map(mc => {
          const batchCustomer = batchCustomersToRemove.find(bc => bc.masterCustomerId === mc.id);
          if (batchCustomer) {
            const newTotalOwed = mc.totalOwed - batchCustomer.amountOwed;
            return {
              ...mc,
              totalOwed: newTotalOwed,
              outstandingBalance: newTotalOwed - mc.totalPaid,
              paymentStatus: calculatePaymentStatus(newTotalOwed, mc.totalPaid),
              lastUpdated: new Date(),
            };
          }
          return mc;
        });
        
        return {
          batches: state.batches.filter(b => b.id !== batchId),
          batchCustomers: state.batchCustomers.filter(bc => bc.batchId !== batchId),
          masterCustomers: updatedMasterCustomers,
          activeBatchId: state.activeBatchId === batchId ? null : state.activeBatchId,
        };
      }),
      
      addCustomerToBatch: (batchId, nrcNumber, name, amountOwed, assignedAgent, mobileNumber = '') => {
        const now = new Date();
        const existingMaster = get().masterCustomers.find(mc => mc.nrcNumber === nrcNumber);
        
        set((state) => {
          let masterCustomerId: string;
          let updatedMasterCustomers = [...state.masterCustomers];
          let updatedTickets = [...state.tickets];
          
          if (existingMaster) {
            // Link to existing master customer
            masterCustomerId = existingMaster.id;
            
            // Update master customer's total owed and mobile number if provided
            updatedMasterCustomers = updatedMasterCustomers.map(mc => 
              mc.id === masterCustomerId
                ? {
                    ...mc,
                    totalOwed: mc.totalOwed + amountOwed,
                    outstandingBalance: mc.totalOwed + amountOwed - mc.totalPaid,
                    paymentStatus: calculatePaymentStatus(mc.totalOwed + amountOwed, mc.totalPaid),
                    mobileNumber: mobileNumber || mc.mobileNumber,
                    lastUpdated: now,
                  }
                : mc
            );
            
            // Update existing ticket amount
            updatedTickets = updatedTickets.map(t =>
              t.masterCustomerId === masterCustomerId
                ? {
                    ...t,
                    amountOwed: t.amountOwed + amountOwed,
                    lastUpdated: now,
                  }
                : t
            );
          } else {
            // Create new master customer
            masterCustomerId = generateId();
            const ticketId = generateId();
            
            updatedMasterCustomers.push({
              id: masterCustomerId,
              nrcNumber,
              name,
              mobileNumber,
              totalPaid: 0,
              totalOwed: amountOwed,
              outstandingBalance: amountOwed,
              paymentStatus: 'Not Paid',
              callNotes: '',
              ticketId,
              assignedAgent,
              createdDate: now,
              lastUpdated: now,
            });
            
            // Create new ticket
            updatedTickets.push({
              id: ticketId,
              masterCustomerId,
              customerId: masterCustomerId,
              customerName: name,
              nrcNumber,
              amountOwed,
              priority: 'High',
              status: 'Open',
              assignedAgent,
              callNotes: '',
              createdDate: now,
              resolvedDate: null,
              lastUpdated: now,
            });
          }
          
          // Create batch customer entry
          const batchCustomer: BatchCustomer = {
            id: generateId(),
            batchId,
            masterCustomerId,
            nrcNumber,
            name,
            mobileNumber,
            amountOwed,
            linkedToMaster: !!existingMaster,
            createdDate: now,
          };
          
          // Update batch stats
          const updatedBatches = state.batches.map(b =>
            b.id === batchId
              ? {
                  ...b,
                  customerCount: b.customerCount + 1,
                  totalAmount: b.totalAmount + amountOwed,
                }
              : b
          );
          
          return {
            masterCustomers: updatedMasterCustomers,
            batchCustomers: [...state.batchCustomers, batchCustomer],
            tickets: updatedTickets,
            batches: updatedBatches,
          };
        });
      },
      
      updateMasterCustomer: (id, updates) => set((state) => ({
        masterCustomers: state.masterCustomers.map((mc) =>
          mc.id === id ? { ...mc, ...updates, lastUpdated: new Date() } : mc
        ),
        tickets: state.tickets.map((t) =>
          t.masterCustomerId === id
            ? { 
                ...t, 
                callNotes: updates.callNotes ?? t.callNotes,
                lastUpdated: new Date() 
              }
            : t
        ),
      })),
      
      updateTicket: (id, updates) => set((state) => ({
        tickets: state.tickets.map((t) =>
          t.id === id ? { ...t, ...updates, lastUpdated: new Date() } : t
        ),
      })),
      
      addPayment: (paymentData) => set((state) => {
        const payment: Payment = {
          ...paymentData,
          id: generateId(),
          createdDate: new Date(),
        };
        
        const masterCustomer = state.masterCustomers.find(mc => mc.id === payment.masterCustomerId);
        if (!masterCustomer) return state;
        
        const newTotalPaid = masterCustomer.totalPaid + payment.amount;
        const newPaymentStatus = calculatePaymentStatus(masterCustomer.totalOwed, newTotalPaid);
        const isFullyPaid = newPaymentStatus === 'Fully Paid';
        
        return {
          payments: [...state.payments, payment],
          masterCustomers: state.masterCustomers.map((mc) =>
            mc.id === payment.masterCustomerId
              ? {
                  ...mc,
                  totalPaid: newTotalPaid,
                  outstandingBalance: mc.totalOwed - newTotalPaid,
                  paymentStatus: newPaymentStatus,
                  lastUpdated: new Date(),
                }
              : mc
          ),
          tickets: state.tickets.map((t) =>
            t.masterCustomerId === payment.masterCustomerId
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
        batches: [],
        activeBatchId: null,
        masterCustomers: [],
        batchCustomers: [],
        tickets: [],
        payments: [],
      }),
      
      getActiveBatchCustomers: () => {
        const state = get();
        if (!state.activeBatchId) return [];
        
        const batchCustomers = state.batchCustomers.filter(
          bc => bc.batchId === state.activeBatchId
        );
        
        return batchCustomers.map(bc => {
          const master = state.masterCustomers.find(mc => mc.id === bc.masterCustomerId);
          if (!master) return null;
          return {
            ...master,
            batchAmount: bc.amountOwed,
          };
        }).filter(Boolean) as (MasterCustomer & { batchAmount: number })[];
      },
      
      getBatchById: (batchId) => get().batches.find(b => b.id === batchId),
      
      getMasterCustomerByNrc: (nrcNumber) => 
        get().masterCustomers.find(mc => mc.nrcNumber === nrcNumber),
    }),
    {
      name: 'loan-collections-storage-v2',
      partialize: (state) => ({
        batches: state.batches,
        activeBatchId: state.activeBatchId,
        masterCustomers: state.masterCustomers,
        batchCustomers: state.batchCustomers,
        tickets: state.tickets,
        payments: state.payments,
        settings: state.settings,
      }),
    }
  )
);

// Helper function for CSV import
export const processCSVBatch = (
  batchId: string,
  rows: { name: string; nrcNumber: string; amountOwed: number; mobileNumber: string }[],
  settings: AppSettings,
  addCustomerToBatch: AppState['addCustomerToBatch']
) => {
  const agents = [settings.agent1Name, settings.agent2Name, settings.agent3Name];
  
  rows.forEach((row, index) => {
    const assignedAgent = agents[index % 3];
    addCustomerToBatch(batchId, row.nrcNumber, row.name, row.amountOwed, assignedAgent, row.mobileNumber);
  });
};
