'use client'

import { useAccount } from 'wagmi'
import { useDatabaseOwner } from '@/lib/web3/hooks'
import { useAppStore } from '@/store'
import { shortAddress } from '@/lib/utils/format'
import { Users, Shield, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

export default function TeamPage() {
  const { address } = useAccount()
  const { activeDatabase } = useAppStore()
  const { data: owner } = useDatabaseOwner(
    activeDatabase?.address as `0x${string}` | undefined
  )

  const isOwner = address && owner && address.toLowerCase() === (owner as string).toLowerCase()

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Team</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">Database ownership and collaborator access</p>
      </div>

      <div className="max-w-2xl space-y-4">
        {/* Info */}
        <div className="flex items-start gap-3 rounded-2xl bg-blue-50 border border-blue-100 p-4">
          <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-[13px] text-blue-700">
            Access control in Web3QL is per-record. Grant collaborators access to specific records
            from the table detail page. Database ownership is set at deploy time and cannot be changed.
          </p>
        </div>

        {/* Database owner */}
        {activeDatabase ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-[15px] font-semibold text-gray-900">Database Owner</h2>
              <p className="text-[12px] text-gray-500 mt-0.5">{activeDatabase.name}</p>
            </div>
            <div className="px-6 py-4">
              {owner ? (
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback>{(owner as string).slice(2, 4).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-[13px] font-mono text-gray-700">{shortAddress(owner as string, 6)}</p>
                    {isOwner && <p className="text-[12px] text-violet-600 font-medium">You</p>}
                  </div>
                  <Badge variant="default" className="ml-auto">Owner</Badge>
                </div>
              ) : (
                <p className="text-[13px] text-gray-400">Loading ownership data…</p>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm py-12 text-center">
            <Users className="h-8 w-8 text-gray-300 mx-auto mb-3" />
            <p className="text-[14px] font-medium text-gray-700 mb-1">No active database</p>
            <p className="text-[13px] text-gray-400">Select a database to view ownership.</p>
          </div>
        )}

        {/* Access model explanation */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-[15px] font-semibold text-gray-900">Access Model</h2>
          </div>
          <div className="px-6 py-4 space-y-3">
            {[
              { role: 'OWNER', color: 'default', desc: 'Full control: write, update, delete, grant/revoke access' },
              { role: 'EDITOR', color: 'secondary', desc: 'Can write and update records' },
              { role: 'VIEWER', color: 'outline', desc: 'Read-only access to shared records' },
            ].map((r) => (
              <div key={r.role} className="flex items-start gap-3">
                <Badge variant={r.color as any} className="mt-0.5 shrink-0">{r.role}</Badge>
                <p className="text-[13px] text-gray-600">{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
