import { create } from 'zustand';
import { persist } from 'zustand/middleware';






export const useUIStore = create()(
  persist(
    (set) => ({
      activeBatchId: null,
      setActiveBatch: (batchId) => set({ activeBatchId: batchId }),
    }),
    {
      name: 'ui-storage',
    }
  )
);
