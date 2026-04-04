'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount, useChainId, useSwitchChain, useWatchContractEvent } from 'wagmi'
import { toast } from 'sonner'
import { parseEventLogs } from 'viem'
import {
  Database,
  Plus,
  RefreshCw,
  Table2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react'
import { useUserDatabases, useTableCount, useDatabaseName, useCreateDatabase } from '@/lib/web3/hooks'
import { useAppStore, useFactoryAddress } from '@/store'
import { shortAddress } from '@/lib/utils/format'
import { CHAIN_ID, FACTORY_ADDRESS, FACTORY_ABI } from '@/lib/contracts'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

// ─── Create database dialog ───────────────────────────────────────────────────

function CreateDatabaseDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated?: (newDbAddress?: string, newDbName?: string) => void
}) {
  const [name, setName] = useState('')
  const { createDatabase, isPending, isSuccess, isError, error, receiptData } = useCreateDatabase()

  // Must use useEffect — calling setState-setters during render causes the
  // "Cannot update a component while rendering a different component" error.
  useEffect(() => {
    if (isSuccess) {
      toast.dismiss('create-db')
      // Parse the new DB address straight from the receipt logs so we can
      // show the card immediately without waiting for a chain refetch.
      let newDbAddress: string | undefined
      if (receiptData?.logs) {
        try {
          const parsed = parseEventLogs({ abi: FACTORY_ABI, eventName: 'DatabaseCreated', logs: receiptData.logs })
          newDbAddress = (parsed[0]?.args as { db?: string })?.db ?? undefined
        } catch { /* ignore */ }
      }
      toast.success(`Database “${name}” created!`, {
        description: 'Your on-chain database is live on Celo Sepolia.',
      })
      onCreated?.(newDbAddress, name)
      onClose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  useEffect(() => {
    if (isError && error) {
      toast.dismiss('create-db')
      toast.error('Failed to create database', {
        description: (error as Error)?.message?.slice(0, 120) ?? 'Transaction rejected.',
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    toast.loading(`Deploying "${name}"…`, { id: 'create-db' })
    createDatabase(name.trim())
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Database</DialogTitle>
          <DialogDescription>
            Deploy a new on-chain database contract to Celo Sepolia.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="db-name">Database name</Label>
            <Input
              id="db-name"
              placeholder="e.g. my_app_db"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
              autoFocus
            />
            <p className="text-[12px] text-gray-400">
              Alphanumeric name stored immutably on-chain.
            </p>
          </div>

          {isError && (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-100 p-3">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-[12px] text-red-600">{(error as Error)?.message ?? 'Transaction failed'}</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? 'Deploying…' : 'Deploy Database'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Database card ────────────────────────────────────────────────────────────

function DatabaseCard({ address, optimisticName, onSelect }: { address: string; optimisticName?: string; onSelect: (name: string) => void }) {
  const router = useRouter()
  const { data: name, isLoading: nameLoading } = useDatabaseName(address as `0x${string}`)
  const { data: tableCount, isLoading: countLoading } = useTableCount(address as `0x${string}`)

  // Use the chain name once resolved, fall back to the optimistic name while loading
  const displayName = (!nameLoading && name) ? name : (optimisticName ?? (nameLoading ? '' : 'Unnamed'))
  const showSkeleton = nameLoading && !optimisticName
  const tables = countLoading ? null : Number(tableCount ?? 0)

  const handleCardClick = () => {
    onSelect(displayName)
    router.push(`/databases/${address}`)
  }

  const handleExplorerClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.open(
      `https://celo-sepolia.blockscout.com/address/${address}`,
      '_blank',
      'noopener,noreferrer'
    )
  }

  return (
    // div instead of Link avoids <a> inside <a> hydration error
    <div
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleCardClick()}
      className="block bg-white rounded-2xl border border-gray-200 shadow-sm p-6 hover:border-violet-200 hover:shadow-md transition-all duration-150 group cursor-pointer"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="h-10 w-10 rounded-xl bg-violet-50 flex items-center justify-center">
          <Database className="h-5 w-5 text-violet-600" />
        </div>
        <Badge variant="secondary">Active</Badge>
      </div>

      {showSkeleton ? (
        <Skeleton className="h-5 w-32 mb-1" />
      ) : (
        <h3 className="text-[15px] font-semibold text-gray-900 group-hover:text-violet-700 transition-colors">
          {displayName}
        </h3>
      )}

      <p className="text-[12px] font-mono text-gray-400 mt-0.5">{shortAddress(address, 6)}</p>

      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
        <div className="flex items-center gap-1.5">
          <Table2 className="h-3.5 w-3.5 text-gray-400" />
          {countLoading ? (
            <Skeleton className="h-4 w-8" />
          ) : (
            <span className="text-[13px] text-gray-600">
              {tables} {tables === 1 ? 'table' : 'tables'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleExplorerClick}
          className="flex items-center gap-1 text-[12px] text-gray-400 hover:text-violet-600 transition-colors ml-auto"
        >
          Explorer
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-16 w-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
        <Database className="h-8 w-8 text-gray-400" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">No databases yet</h3>
      <p className="text-[13px] text-gray-500 max-w-sm mb-6">
        Create your first on-chain database. Each database is a smart contract deployed to Celo Sepolia.
      </p>
      <Button onClick={onNew}>
        <Plus className="h-4 w-4 mr-2" />
        Create Database
      </Button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DatabasesPage() {
  const [createOpen, setCreateOpen] = useState(false)
  // Optimistic list: addresses added instantly from receipt before chain refetch
  const [optimisticDbs, setOptimisticDbs] = useState<string[]>([])
  const [optimisticNames, setOptimisticNames] = useState<Record<string, string>>({})
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const { setActiveDatabase } = useAppStore()

  const { data: databases, isLoading, refetch } = useUserDatabases(address)

  // Once the chain data catches up, drop addresses that are now in the real list
  useEffect(() => {
    if (databases && optimisticDbs.length > 0) {
      const chainList = databases as string[]
      setOptimisticDbs(prev => prev.filter(a => !chainList.includes(a)))
      setOptimisticNames(prev => {
        const next = { ...prev }
        chainList.forEach(a => delete next[a])
        return next
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databases])

  // Merge: real chain data first (deduped), then any still-pending optimistic ones
  const allDatabases = useMemo(() => {
    const chain = (databases as string[] | undefined) ?? []
    const extra = optimisticDbs.filter(a => !chain.includes(a))
    return [...chain, ...extra]
  }, [databases, optimisticDbs])

  const handleCreated = (newDbAddress?: string, newDbName?: string) => {
    if (newDbAddress) {
      setOptimisticDbs(prev =>
        prev.includes(newDbAddress) ? prev : [...prev, newDbAddress]
      )
      if (newDbName) {
        setOptimisticNames(prev => ({ ...prev, [newDbAddress]: newDbName }))
      }
    }
    refetch()
  }

  const activeFactory = useFactoryAddress()

  // Automatically refetch when any DatabaseCreated event fires for this user —
  // this makes newly-created databases appear without a page reload.
  useWatchContractEvent({
    address: activeFactory,
    abi: FACTORY_ABI,
    eventName: 'DatabaseCreated',
    args: address ? { owner: address } : undefined,
    onLogs: () => { refetch() },
    enabled: isConnected && !!address,
  })

  const wrongChain = isConnected && chainId !== CHAIN_ID

  if (!isConnected) {
    return (
      <div className="p-6 md:p-8">
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Database className="h-10 w-10 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Connect your wallet</h3>
            <p className="text-[13px] text-gray-500">Connect your wallet to view and manage your databases.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Databases</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            {databases?.length ?? 0} database{databases?.length !== 1 ? 's' : ''} on Celo Sepolia
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="h-9 w-9 flex items-center justify-center rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 text-gray-500 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Database
          </Button>
        </div>
      </div>

      {/* Wrong chain warning */}
      {wrongChain && (
        <div className="flex items-center gap-3 rounded-2xl bg-orange-50 border border-orange-200 p-4 mb-6">
          <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-orange-800">Wrong network</p>
            <p className="text-[12px] text-orange-600">Switch to Celo Sepolia to interact with databases.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => switchChain({ chainId: CHAIN_ID })}
            className="shrink-0 border-orange-300 text-orange-700 hover:bg-orange-100"
          >
            Switch Network
          </Button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 p-6">
              <Skeleton className="h-10 w-10 rounded-xl mb-4" />
              <Skeleton className="h-5 w-32 mb-1" />
              <Skeleton className="h-4 w-24 mb-4" />
              <Skeleton className="h-px w-full mb-4" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && allDatabases.length === 0 && (
        <EmptyState onNew={() => setCreateOpen(true)} />
      )}

      {/* Database grid */}
      {(!isLoading || allDatabases.length > 0) && allDatabases.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {allDatabases.map((dbAddress) => (
            <DatabaseCard
              key={dbAddress}
              address={dbAddress}
              optimisticName={optimisticNames[dbAddress]}
              onSelect={(name) => setActiveDatabase({ address: dbAddress, name })}
            />
          ))}
        </div>
      )}

      <CreateDatabaseDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  )
}
