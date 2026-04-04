'use client'

import { use, useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useWatchContractEvent } from 'wagmi'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Table2,
  Plus,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react'
import {
  useDatabaseName,
  useDatabaseOwner,
  useListTables,
  useTableCount,
  useGetTableAddress,
  useCreateTable,
  useActiveRecords,
  useTotalRecords,
} from '@/lib/web3/hooks'
import { useAppStore } from '@/store'
import { shortAddress } from '@/lib/utils/format'
import { DATABASE_ABI } from '@/lib/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { SchemaBuilder } from '@/components/tables/SchemaBuilder'
import type { SchemaField } from '@/lib/utils/schema'
import { schemaToSQL } from '@/lib/utils/schema'

// ─── Table row in the list ────────────────────────────────────────────────────

function TableRow({
  dbAddress,
  tableName,
}: {
  dbAddress: string
  tableName: string
}) {
  const { data: tableAddr } = useGetTableAddress(dbAddress as `0x${string}`, tableName)
  const resolvedAddr = (tableAddr && tableAddr !== '0x0000000000000000000000000000000000000000'
    ? tableAddr : undefined) as `0x${string}` | undefined
  const { data: activeRecs } = useActiveRecords(resolvedAddr)

  return (
    <Link
      href={`/databases/${dbAddress}/tables/${encodeURIComponent(tableName)}`}
      className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors duration-150 group"
    >
      <div className="h-8 w-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
        <Table2 className="h-4 w-4 text-violet-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-gray-900 group-hover:text-violet-700 transition-colors">
          {tableName}
        </p>
        {resolvedAddr ? (
          <p className="text-[11px] font-mono text-gray-400">{shortAddress(resolvedAddr, 4)}</p>
        ) : (
          <Skeleton className="h-3 w-20 mt-0.5" />
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-[13px] text-gray-500">
          {activeRecs !== undefined ? `${Number(activeRecs)} records` : <Skeleton className="h-3.5 w-14 inline-block" />}
        </span>
        <Badge variant="secondary">Active</Badge>
      </div>
    </Link>
  )
}

// Shown for optimistic (not-yet-chained) table entries
function PendingTableRow({ tableName }: { tableName: string }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-xl opacity-60">
      <div className="h-8 w-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0 animate-pulse">
        <Table2 className="h-4 w-4 text-violet-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-gray-700">{tableName}</p>
        <p className="text-[11px] text-gray-400">Syncing with chain…</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-[12px] text-gray-400 animate-pulse">Deploying…</span>
        <Badge variant="outline" className="text-gray-400 border-gray-200">Pending</Badge>
      </div>
    </div>
  )
}

// ─── Create table dialog ──────────────────────────────────────────────────────

function CreateTableDialog({
  dbAddress,
  open,
  onClose,
  onCreated,
}: {
  dbAddress: string
  open: boolean
  onClose: () => void
  onCreated?: (tableName: string) => void
}) {
  const [name, setName] = useState('')
  const [fields, setFields] = useState<SchemaField[]>([
    { name: 'id', type: 'TEXT', primaryKey: true },
  ])
  const { createTable, isPending, isSuccess, error, isError } = useCreateTable()

  useEffect(() => {
    if (isSuccess) {
      toast.dismiss('create-table')
      toast.success(`Table “${name}” created!`, {
        description: 'Your on-chain table is live.',
      })
      onCreated?.(name)
      onClose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  useEffect(() => {
    if (isError && error) {
      toast.dismiss('create-table')
      toast.error('Failed to create table', {
        description: (error as Error)?.message?.slice(0, 120) ?? 'Transaction rejected.',
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !fields.length) return
    toast.loading(`Deploying “${name}”…`, { id: 'create-table' })
    const sql = schemaToSQL(name.trim(), fields)
    createTable(dbAddress as `0x${string}`, name.trim(), sql)
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Table</DialogTitle>
          <DialogDescription>
            Define the schema for your new on-chain table.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="table-name">Table name</Label>
            <Input
              id="table-name"
              placeholder="e.g. users"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Schema</Label>
            <SchemaBuilder fields={fields} onChange={setFields} />
          </div>
          {isError && (
            <p className="text-[12px] text-red-600 bg-red-50 rounded-xl px-3 py-2 border border-red-100">
              {(error as Error)?.message ?? 'Transaction failed'}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? 'Deploying…' : 'Deploy Table'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Copy address button ──────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy} className="p-1 rounded hover:bg-gray-100 transition-colors" title="Copy address">
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-gray-400" />}
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DatabaseDetailPage({
  params,
}: {
  params: Promise<{ dbAddress: string }>
}) {
  const { dbAddress } = use(params)
  const [createOpen, setCreateOpen] = useState(false)
  const [optimisticTables, setOptimisticTables] = useState<string[]>([])
  const { setActiveDatabase } = useAppStore()

  const { data: name, isLoading: nameLoading } = useDatabaseName(dbAddress as `0x${string}`)
  const { data: owner } = useDatabaseOwner(dbAddress as `0x${string}`)
  const { data: tables, isLoading: tablesLoading, refetch } = useListTables(dbAddress as `0x${string}`)
  const { data: tableCount } = useTableCount(dbAddress as `0x${string}`)

  // Drop optimistic entries once chain data includes them
  useEffect(() => {
    if (!tables) return
    const chainList = tables as string[]
    setOptimisticTables(prev => prev.filter(t => !chainList.includes(t)))
  }, [tables])

  // Merge chain list + still-pending optimistic names (deduped)
  const allTables = useMemo(() => {
    const chain = (tables as string[] | undefined) ?? []
    const extra = optimisticTables.filter(t => !chain.includes(t))
    return [...chain, ...extra]
  }, [tables, optimisticTables])

  const handleTableCreated = (tableName: string) => {
    setOptimisticTables(prev => prev.includes(tableName) ? prev : [...prev, tableName])
    refetch()
  }

  // Poll every 2 s while there are pending optimistic tables —
  // the useEffect([tables]) above will clear them as soon as the RPC catches up
  useEffect(() => {
    if (optimisticTables.length === 0) return
    const id = setInterval(() => { refetch() }, 2000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimisticTables.length])

  // Live update: refetch + clear pending when a TableCreated event fires on this DB
  useWatchContractEvent({
    address: dbAddress as `0x${string}`,
    abi: DATABASE_ABI,
    eventName: 'TableCreated',
    onLogs: () => {
      setOptimisticTables([])
      refetch()
    },
  })

  // Set as active database when visiting — must be in useEffect to avoid
  // "Cannot update a component while rendering a different component" error.
  useEffect(() => {
    if (name && dbAddress) {
      setActiveDatabase({ address: dbAddress, name: name as string })
    }
  }, [name, dbAddress, setActiveDatabase])

  return (
    <div className="p-6 md:p-8">
      {/* Back + header */}
      <div className="mb-6">
        <Link
          href="/databases"
          className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-900 transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All Databases
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            {nameLoading ? (
              <Skeleton className="h-8 w-48 mb-2" />
            ) : (
              <h1 className="text-2xl font-semibold text-gray-900">{name as string ?? 'Unnamed Database'}</h1>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="font-mono text-[12px] text-gray-400">{dbAddress}</span>
              <CopyButton text={dbAddress} />
              <a
                href={`https://celo-sepolia.blockscout.com/address/${dbAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[12px] text-gray-400 hover:text-violet-600 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Explorer
              </a>
            </div>
          </div>

          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Table
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
          <p className="text-[12px] text-gray-500 mb-1">Tables</p>
          {tablesLoading ? (
            <Skeleton className="h-7 w-12" />
          ) : (
            <p className="text-2xl font-semibold text-gray-900">{Number(tableCount ?? 0)}</p>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
          <p className="text-[12px] text-gray-500 mb-1">Owner</p>
          <p className="text-[13px] font-mono text-gray-700">{owner ? shortAddress(owner as string, 4) : '—'}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
          <p className="text-[12px] text-gray-500 mb-1">Network</p>
          <p className="text-[13px] font-medium text-gray-700">Celo Sepolia</p>
        </div>
      </div>

      {/* Tables section */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-[15px] font-semibold text-gray-900">Tables</h2>
          <button
            onClick={() => refetch()}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-gray-400 ${tablesLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {tablesLoading && (
          <div className="px-4 py-3 space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="flex-1"><Skeleton className="h-4 w-32 mb-1" /><Skeleton className="h-3 w-24" /></div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        )}

        {!tablesLoading && allTables.length === 0 && (
          <div className="flex flex-col items-center py-12 text-center">
            <Table2 className="h-8 w-8 text-gray-300 mb-3" />
            <p className="text-[14px] font-medium text-gray-700 mb-1">No tables yet</p>
            <p className="text-[13px] text-gray-400 mb-4">Create your first table to start storing data.</p>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />Create Table
            </Button>
          </div>
        )}

        {(!tablesLoading || allTables.length > 0) && allTables.length > 0 && (
          <div className="px-2 py-2 divide-y divide-gray-50">
            {(tables as string[] ?? []).map((tName) => (
              <TableRow key={tName} dbAddress={dbAddress} tableName={tName} />
            ))}
            {optimisticTables.map((tName) => (
              <PendingTableRow key={`pending-${tName}`} tableName={tName} />
            ))}
          </div>
        )}
      </div>

      <CreateTableDialog
        dbAddress={dbAddress}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleTableCreated}
      />
    </div>
  )
}
