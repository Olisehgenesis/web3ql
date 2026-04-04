'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAppKitAccount } from '@reown/appkit/react'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isConnected, status } = useAppKitAccount()
  const router = useRouter()

  useEffect(() => {
    // Wait until AppKit has resolved connection state before redirecting
    if (status === 'disconnected') {
      router.replace('/login')
    }
  }, [isConnected, status, router])

  // Show nothing while connection state is still resolving
  if (status === 'connecting' || status === 'reconnecting') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-violet-600 border-t-transparent animate-spin" />
          <p className="text-[13px] text-gray-500">Connecting wallet…</p>
        </div>
      </div>
    )
  }

  if (status === 'disconnected') return null

  return <>{children}</>
}
