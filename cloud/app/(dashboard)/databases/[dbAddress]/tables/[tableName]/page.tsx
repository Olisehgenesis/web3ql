'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  FileText,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import {
  useGetTableAddress,
  useTableName,
  useTableSchema,
  useTotalRecords,
  useActiveRecords,
  useOwnerRecordCount,
  useOwnerRecordKeys,
  useRecord,
  useWriteRecord,
  useDeleteRecord,
  decodeCiphertext,
} from '@/lib/web3/hooks'
import { shortAddress, formatRelativeTime } from '@/lib/utils/format'
import { parseSQLToFields } from '@/lib/utils/schema'
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
import {
  Table, TableHeader, TableBody, TableHead,
  TableRow, TableCell,
} from '@/components/ui/table'

// ─── Write record dialog ──────────────────────────────────────────────────────

function WriteRecordDialog({
  tableAddress,
  tableName,
  open,
  onClose,
  onWritten,
}: {
  tableAddress: string
  tableName: string
  open: boolean
  onClose: () => void
  onWritten?: () => void
}) {
  const [primaryKey, setPrimaryKey] = useState('')
  const [data, setData] = useState('')
  const { writeRecord, isPending, isSuccess, isError, error } = useWriteRecord()

  if (isSuccess) { onWritten?.(); onClose() }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Write Record</DialogTitle>
          <DialogDescription>
            Store a new record on-chain. Data is stored as plaintext hex in demo mode.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!primaryKey.trim() || !data.trim()) return
            writeRecord(tableAddress as `0x${string}`, primaryKey.trim(), tableName, data.trim())
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="pk">Primary Key</Label>
            <Input
              id="pk"
              placeholder="e.g. user_001"
              value={primaryKey}
              onChange={(e) => setPrimaryKey(e.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="data">Data (JSON)</Label>
            <Input
              id="data"
              placeholder='{"name":"Alice","age":30}'
              value={data}
              onChange={(e) => setData(e.target.value)}
              disabled={isPending}
            />
            <p className="text-[12px] text-gray-400">Enter data as JSON. Stored as UTF-8 bytes on-chain.</p>
          </div>
          {isError && (
            <p className="text-[12px] text-red-600 bg-red-50 rounded-xl px-3 py-2 border border-red-100">
              {(error as Error)?.message ?? 'Transaction failed'}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending || !primaryKey.trim() || !data.trim()}>
              {isPending ? 'Writing…' : 'Write Record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Single record row (expandable) ──────────────────────────────────────────

function RecordRowItem({
  tableAddress,
  tableName,
  recordKeyHex,
  onDeleted,
}: {
  tableAddress: string
  tableName: string
  recordKeyHex: `0x${string}`
  onDeleted?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { data: record, isLoading } = useRecord(tableAddress as `0x${string}`, recordKeyHex)
  const { deleteRecord, deleteRecordByKey, isPending } = useDeleteRecord()

  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={4}><Skeleton className="h-4 w-full" /></TableCell>
      </TableRow>
    )
  }

  if (!record || (record as any)[1]) return null // deleted

  const [ciphertext, , version, updatedAt] = record as [`0x${string}`, boolean, bigint, bigint, string]
  const decoded = decodeCiphertext(ciphertext)
  const keyShort = shortAddress(recordKeyHex, 4)

  let displayData = decoded
  try { displayData = JSON.stringify(JSON.parse(decoded), null, 2) } catch {}

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-[12px] text-gray-500">{keyShort}</TableCell>
        <TableCell className="max-w-xs truncate font-mono text-[12px]">{decoded.slice(0, 60)}{decoded.length > 60 ? '…' : ''}</TableCell>
        <TableCell className="text-[12px] text-gray-500">v{Number(version)}</TableCell>
        <TableCell className="text-[12px] text-gray-500">{formatRelativeTime(updatedAt)}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1 justify-end">
            <button
              onClick={() => setExpanded(!expanded)}
              className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
            </button>
            <button
              onClick={() => {
                deleteRecordByKey(tableAddress as `0x${string}`, recordKeyHex)
                onDeleted?.()
              }}
              disabled={isPending}
              className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={5} className="bg-gray-50">
            <pre className="text-[12px] font-mono text-gray-700 whitespace-pre-wrap break-all p-2">
              {displayData}
            </pre>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// ─── Records tab ──────────────────────────────────────────────────────────────

function RecordsTab({
  tableAddress,
  tableName,
}: {
  tableAddress: string
  tableName: string
}) {
  const [writeOpen, setWriteOpen] = useState(false)
  const { address } = useAccount()
  const { data: keyCount } = useOwnerRecordCount(tableAddress as `0x${string}`, address)
  const {
    data: keys,
    isLoading,
    refetch,
  } = useOwnerRecordKeys(tableAddress as `0x${string}`, address, BigInt(0), BigInt(20))

  const recordKeys = keys as `0x${string}`[] | undefined

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13px] text-gray-500">
          {keyCount !== undefined ? `${Number(keyCount)} record${Number(keyCount) !== 1 ? 's' : ''} owned by you` : ''}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="h-8 w-8 flex items-center justify-center rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-gray-400 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <Button size="sm" onClick={() => setWriteOpen(true)} disabled={!address}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Write Record
          </Button>
        </div>
      </div>

      {!address && (
        <div className="rounded-2xl bg-gray-50 border border-gray-200 py-12 text-center">
          <p className="text-[14px] text-gray-500">Connect your wallet to view and write records.</p>
        </div>
      )}

      {address && isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}
        </div>
      )}

      {address && !isLoading && (!recordKeys || recordKeys.length === 0) && (
        <div className="rounded-2xl bg-gray-50 border border-gray-200 py-12 text-center">
          <FileText className="h-8 w-8 text-gray-300 mx-auto mb-3" />
          <p className="text-[14px] font-medium text-gray-700 mb-1">No records yet</p>
          <p className="text-[13px] text-gray-400 mb-4">Write your first record to this table.</p>
          <Button size="sm" onClick={() => setWriteOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />Write Record
          </Button>
        </div>
      )}

      {address && !isLoading && recordKeys && recordKeys.length > 0 && (
        <div className="rounded-2xl border border-gray-200 overflow-hidden bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recordKeys.map((key) => (
                <RecordRowItem
                  key={key}
                  tableAddress={tableAddress}
                  tableName={tableName}
                  recordKeyHex={key}
                  onDeleted={() => refetch()}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <WriteRecordDialog
        tableAddress={tableAddress}
        tableName={tableName}
        open={writeOpen}
        onClose={() => setWriteOpen(false)}
        onWritten={() => refetch()}
      />
    </div>
  )
}

// ─── Schema tab ───────────────────────────────────────────────────────────────

function SchemaTab({ tableAddress }: { tableAddress: string }) {
  const { schema, isLoading } = useTableSchema(tableAddress as `0x${string}`)

  if (isLoading) return <Skeleton className="h-32 w-full rounded-xl" />

  if (!schema) {
    return (
      <div className="text-center py-8 text-gray-400 text-[13px]">No schema available.</div>
    )
  }

  const fields = parseSQLToFields(schema)

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Constraints</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((f) => (
              <TableRow key={f.name}>
                <TableCell className="font-medium text-gray-900">{f.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{f.type}</Badge>
                </TableCell>
                <TableCell className="text-gray-500">
                  {[f.primaryKey && 'PRIMARY KEY', f.notNull && 'NOT NULL'].filter(Boolean).join(', ') || '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <p className="text-[12px] text-gray-400 mb-2 font-medium">Raw SQL Schema</p>
        <pre className="bg-gray-50 rounded-xl border border-gray-200 p-4 text-[12px] font-mono text-gray-700 overflow-x-auto">
          {schema}
        </pre>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TableDetailPage({
  params,
}: {
  params: Promise<{ dbAddress: string; tableName: string }>
}) {
  const { dbAddress, tableName: encodedTableName } = use(params)
  const tableName = decodeURIComponent(encodedTableName)

  const { data: tableAddress, isLoading: addrLoading } = useGetTableAddress(
    dbAddress as `0x${string}`,
    tableName
  )
  const { data: activeRecs } = useActiveRecords(tableAddress as `0x${string}` | undefined)
  const { data: totalRecs } = useTotalRecords(tableAddress as `0x${string}` | undefined)

  return (
    <div className="p-6 md:p-8">
      {/* Back */}
      <Link
        href={`/databases/${dbAddress}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-900 transition-colors mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Database
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{tableName}</h1>
          {tableAddress && (
            <div className="flex items-center gap-2 mt-1.5">
              <span className="font-mono text-[12px] text-gray-400">{shortAddress(tableAddress as string, 6)}</span>
              <a
                href={`https://celo-sepolia.blockscout.com/address/${tableAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[12px] text-gray-400 hover:text-violet-600 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
          <p className="text-[12px] text-gray-500 mb-1">Active Records</p>
          <p className="text-2xl font-semibold text-gray-900">{activeRecs !== undefined ? Number(activeRecs) : '—'}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
          <p className="text-[12px] text-gray-500 mb-1">Total Records</p>
          <p className="text-2xl font-semibold text-gray-900">{totalRecs !== undefined ? Number(totalRecs) : '—'}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
          <p className="text-[12px] text-gray-500 mb-1">Table</p>
          <p className="text-[13px] font-medium text-gray-700">{tableName}</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="schema">Schema</TabsTrigger>
        </TabsList>

        <TabsContent value="records">
          {tableAddress ? (
            <RecordsTab tableAddress={tableAddress as string} tableName={tableName} />
          ) : addrLoading ? (
            <Skeleton className="h-32 w-full rounded-2xl" />
          ) : (
            <p className="text-[13px] text-gray-400 py-8 text-center">Table contract not found.</p>
          )}
        </TabsContent>

        <TabsContent value="schema">
          {tableAddress ? (
            <SchemaTab tableAddress={tableAddress as string} />
          ) : addrLoading ? (
            <Skeleton className="h-32 w-full rounded-2xl" />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}
