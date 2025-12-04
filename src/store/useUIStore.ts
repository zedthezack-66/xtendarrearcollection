import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  activeBatchId: string | null;
  setActiveBatch: (batchId: string | null) => void;
}

export const useUIStore = create<UIState>()(
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
