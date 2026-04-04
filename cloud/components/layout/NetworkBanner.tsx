'use client'

import { useChainId, useSwitchChain } from 'wagmi'
import { CHAIN_ID } from '@/lib/contracts'
import { AlertTriangle } from 'lucide-react'

export function NetworkBanner() {
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()

  if (chainId === CHAIN_ID) return null

  return (
    <div className="w-full bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-3">
      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
      <p className="text-[13px] text-amber-800 flex-1">
        Wrong network detected. Switch to <strong>Celo Sepolia</strong> to use the app.
      </p>
      <button
        onClick={() => switchChain({ chainId: CHAIN_ID })}
        className="text-[12px] font-semibold text-amber-700 hover:text-amber-900 border border-amber-300 hover:border-amber-500 rounded-lg px-3 py-1 transition-colors shrink-0"
      >
        Switch Network
      </button>
    </div>
  )
}
