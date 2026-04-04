'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAppKit, useAppKitAccount } from '@reown/appkit/react'
import { Database, Zap, Lock, Globe } from 'lucide-react'

const FEATURES = [
  { icon: Database, title: '100% On-chain',  desc: 'All data lives on Celo Sepolia. No servers, no storage fees.' },
  { icon: Lock,     title: 'Access Control', desc: 'Per-record role-based permissions with encrypted keys.' },
  { icon: Zap,      title: 'SQL Interface',  desc: 'Familiar SQL schema builder with a visual field editor.' },
  { icon: Globe,    title: 'Open Protocol',  desc: 'Permissionless, composable, and censorship-resistant.' },
]

export default function LoginPage() {
  const { open } = useAppKit()
  const { isConnected } = useAppKitAccount()
  const router = useRouter()

  useEffect(() => {
    if (isConnected) router.replace('/databases')
  }, [isConnected, router])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-[420px]">
        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <div className="h-10 w-10 rounded-xl bg-violet-600 flex items-center justify-center">
              <Database className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-gray-900">Web3QL Cloud</p>
              <p className="text-[12px] text-gray-500">On-chain database dashboard</p>
            </div>
          </div>

          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Connect your wallet</h1>
          <p className="text-[14px] text-gray-500 mb-6">
            Sign in with your wallet to access your on-chain databases on Celo Sepolia.
          </p>

          <button
            onClick={() => open()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-600 text-white text-[14px] font-semibold hover:bg-violet-700 active:scale-[0.99] transition-all duration-150"
          >
            Connect Wallet
          </button>

          <p className="mt-4 text-center text-[12px] text-gray-400">
            Supports MetaMask, Rainbow, WalletConnect, and more
          </p>
        </div>

        {/* Feature list */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          {FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <div key={f.title} className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
                <Icon className="h-4 w-4 text-violet-600 mb-2" />
                <p className="text-[13px] font-medium text-gray-900">{f.title}</p>
                <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">{f.desc}</p>
              </div>
            )
          })}
        </div>

        <p className="mt-6 text-center text-[12px] text-gray-400">
          Network: Celo Sepolia Testnet · Chain ID 11142220
        </p>
      </div>
    </div>
  )
}
