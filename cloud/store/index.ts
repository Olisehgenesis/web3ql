import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { FACTORY_ADDRESS } from '@/lib/contracts'

interface ActiveDatabase {
  address: string
  name: string
}

interface AppStore {
  activeDatabase: ActiveDatabase | null
  setActiveDatabase: (database: ActiveDatabase) => void
  clearActiveDatabase: () => void
  /** Custom factory address — overrides the default when set */
  customFactoryAddress: string | null
  setCustomFactoryAddress: (addr: string | null) => void
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      activeDatabase: null,
      setActiveDatabase: (database) => set({ activeDatabase: database }),
      clearActiveDatabase: () => set({ activeDatabase: null }),
      customFactoryAddress: null,
      setCustomFactoryAddress: (addr) => set({ customFactoryAddress: addr || null }),
    }),
    {
      name: 'web3ql-app-store',
      partialize: (state) => ({
        activeDatabase: state.activeDatabase,
        customFactoryAddress: state.customFactoryAddress,
      }),
    }
  )
)

/** Returns the user's custom factory if set, otherwise the default. */
export function useFactoryAddress(): `0x${string}` {
  const custom = useAppStore((s) => s.customFactoryAddress)
  return (custom ?? FACTORY_ADDRESS) as `0x${string}`
}
