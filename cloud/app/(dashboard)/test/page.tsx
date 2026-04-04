'use client'

/**
 * /test — Interactive read/write explorer
 *
 * Lets a connected wallet:
 *   1. Browse their databases (via Factory.getUserDatabases)
 *   2. Drill into tables (via Database.listTables / getTable)
 *   3. See records they own (via Table.getOwnerRecords)
 *   4. Decrypt records client-side (via signature-derived X25519 keypair)
 *   5. Write new records through the relay (EIP-712 submit-intent)
 *   6. Delete records they own
 *
 * Encryption model:
 *   Browser signs KEY_DERIVATION_MESSAGE once → X25519 keypair (session).
 *   Records written here are encrypted with that keypair; only this wallet
 *   (after re-signing) can decrypt them back.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  useAccount,
  useSignMessage,
  useSignTypedData,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi'
import { keccak256, encodePacked, parseAbiItem, type Address } from 'viem'
import ConnectButton from '@/components/ConnectButton'
import {
  FACTORY_ADDRESS, FACTORY_ABI, DATABASE_ABI, TABLE_ABI, CHAIN_ID,
} from '@/lib/contracts'
import {
  KEY_DERIVATION_MESSAGE,
  deriveKeypairFromSignature,
  encryptRecord,
  decryptRecord,
  publicKeyToHex,
  hexToPublicKey,
  type BrowserKeypair,
} from '@/lib/browser-crypto'
import { shortAddress } from '@/lib/utils/format'
import { Button }    from '@/components/ui/button'
import { Badge }     from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input }     from '@/components/ui/input'
import { Label }     from '@/components/ui/label'
import { Textarea }  from '@/components/ui/textarea'
import { Skeleton }  from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Database, Table2, FileText, Lock, LockOpen, Plus, RefreshCw, Trash2,
  ChevronRight, KeyRound, AlertTriangle, CheckCircle2, Loader2,
} from 'lucide-react'

// ─── Derivation helpers ───────────────────────────────────────────────────────

/** keccak256(abi.encodePacked(tableName, uint256(recordId))) — mirrors server deriveRecordKey */
function clientRecordKey(tableName: string, recordId: bigint): `0x${string}` {
  return keccak256(encodePacked(['string', 'uint256'], [tableName, recordId]))
}

// ─── Relay info cache ─────────────────────────────────────────────────────────

let _relayInfoCache: { relayAddress: string; relayX25519PubKey: string } | null = null

async function fetchRelayInfo() {
  if (_relayInfoCache) return _relayInfoCache
  const r = await fetch('/api/connector/relay/info')
  if (!r.ok) throw new Error('Could not fetch relay info')
  const data = await r.json()
  if (!data.configured) throw new Error('Relay wallet not configured on server')
  _relayInfoCache = data
  return data
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
      <Icon className="h-4 w-4 text-violet-500" />
      <span className="text-[13px] font-semibold text-gray-700">{children}</span>
    </div>
  )
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-gray-400">
      <Icon className="h-8 w-8 opacity-30" />
      <p className="text-[12px]">{message}</p>
    </div>
  )
}

// ─── Key setup banner ─────────────────────────────────────────────────────────

function KeySetupBanner({
  keypair,
  onDerived,
}: {
  keypair: BrowserKeypair | null
  onDerived: (kp: BrowserKeypair) => void
}) {
  const { signMessageAsync, isPending } = useSignMessage()

  const derive = useCallback(async () => {
    const sig = await signMessageAsync({ message: KEY_DERIVATION_MESSAGE })
    const kp  = deriveKeypairFromSignature(sig)
    // Persist derived keypair pubkey in sessionStorage so we can show it on reload
    sessionStorage.setItem('web3ql_derived_sig', sig)
    onDerived(kp)
  }, [signMessageAsync, onDerived])

  if (keypair) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-2.5 text-[12px]">
        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
        <span className="text-green-700 font-medium">Encryption keys active</span>
        <span className="text-green-600 font-mono ml-1">
          pubkey: {shortAddress(publicKeyToHex(keypair.publicKey))}
        </span>
        <span className="ml-auto text-green-500 text-[11px]">Records can be decrypted this session</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5">
      <KeyRound className="h-4 w-4 text-amber-600 shrink-0" />
      <div className="flex-1">
        <p className="text-[12px] font-medium text-amber-700">
          Derive encryption keys to read &amp; write records
        </p>
        <p className="text-[11px] text-amber-600">
          Sign a derivation message once — no private key is ever exposed
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="border-amber-300 text-amber-700 hover:bg-amber-100 text-[12px] h-7"
        onClick={derive}
        disabled={isPending}
      >
        {isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <KeyRound className="h-3 w-3 mr-1" />}
        Derive Keys
      </Button>
    </div>
  )
}

// ─── Database list panel ──────────────────────────────────────────────────────

function DatabasesPanel({
  address,
  selectedDb,
  onSelect,
}: {
  address: Address
  selectedDb: Address | null
  onSelect: (addr: Address) => void
}) {
  const { data: dbAddresses, isLoading, refetch } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: 'getUserDatabases',
    args: [address],
    chainId: CHAIN_ID,
  })

  // Fetch names for all DB addresses in one multicall
  const { data: nameResults } = useReadContracts({
    contracts: (dbAddresses ?? []).map((addr) => ({
      address: addr as Address,
      abi: DATABASE_ABI,
      functionName: 'databaseName',
      chainId: CHAIN_ID,
    })),
    query: { enabled: !!dbAddresses?.length },
  })

  const { data: tableCountResults } = useReadContracts({
    contracts: (dbAddresses ?? []).map((addr) => ({
      address: addr as Address,
      abi: DATABASE_ABI,
      functionName: 'tableCount',
      chainId: CHAIN_ID,
    })),
    query: { enabled: !!dbAddresses?.length },
  })

  return (
    <div className="flex flex-col h-full">
      <SectionTitle icon={Database}>My Databases</SectionTitle>
      <div className="flex items-center justify-end px-3 py-1.5">
        <button
          onClick={() => refetch()}
          className="text-[11px] text-gray-400 hover:text-violet-600 flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {isLoading && <Skeleton className="h-8 w-full mt-2" />}
        {!isLoading && !dbAddresses?.length && (
          <EmptyState icon={Database} message="No databases found. Create one from the Databases tab." />
        )}
        {(dbAddresses ?? []).map((addr, i) => {
          const name  = (nameResults?.[i]?.result as string) ?? shortAddress(addr)
          const count = (tableCountResults?.[i]?.result as bigint ?? 0n).toString()
          const isActive = addr.toLowerCase() === selectedDb?.toLowerCase()
          return (
            <button
              key={addr}
              onClick={() => onSelect(addr as Address)}
              className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${
                isActive
                  ? 'bg-violet-50 border border-violet-200'
                  : 'hover:bg-gray-50 border border-transparent'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-gray-800 truncate">{name}</span>
                <ChevronRight className={`h-3 w-3 shrink-0 ${isActive ? 'text-violet-500' : 'text-gray-300'}`} />
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] font-mono text-gray-400">{shortAddress(addr)}</span>
                <Badge variant="secondary" className="h-4 text-[10px] py-0">{count} tables</Badge>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tables panel ─────────────────────────────────────────────────────────────

function TablesPanel({
  dbAddress,
  selectedTable,
  onSelect,
}: {
  dbAddress: Address
  selectedTable: { name: string; address: Address } | null
  onSelect: (t: { name: string; address: Address }) => void
}) {
  const { data: tableNames, isLoading, refetch } = useReadContract({
    address: dbAddress,
    abi: DATABASE_ABI,
    functionName: 'listTables',
    chainId: CHAIN_ID,
  })

  const { data: tableAddrs } = useReadContracts({
    contracts: (tableNames ?? []).map((name) => ({
      address: dbAddress,
      abi: DATABASE_ABI,
      functionName: 'getTable',
      args: [name],
      chainId: CHAIN_ID,
    })),
    query: { enabled: !!tableNames?.length },
  })

  const { data: recordCounts } = useReadContracts({
    contracts: (tableAddrs ?? []).map((r) => ({
      address: (r?.result as Address) ?? '0x0',
      abi: TABLE_ABI,
      functionName: 'activeRecords',
      chainId: CHAIN_ID,
    })),
    query: { enabled: !!(tableAddrs?.length && tableAddrs[0]?.result) },
  })

  return (
    <div className="flex flex-col h-full">
      <SectionTitle icon={Table2}>Tables</SectionTitle>
      <div className="flex items-center justify-end px-3 py-1.5">
        <button
          onClick={() => refetch()}
          className="text-[11px] text-gray-400 hover:text-violet-600 flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {isLoading && <Skeleton className="h-8 w-full mt-2" />}
        {!isLoading && !tableNames?.length && (
          <EmptyState icon={Table2} message="No tables in this database." />
        )}
        {(tableNames ?? []).map((name, i) => {
          const addr      = (tableAddrs?.[i]?.result as Address) ?? null
          const count     = (recordCounts?.[i]?.result as bigint ?? 0n).toString()
          const isActive  = addr && addr.toLowerCase() === selectedTable?.address?.toLowerCase()
          if (!addr) return null
          return (
            <button
              key={name}
              onClick={() => onSelect({ name, address: addr })}
              className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${
                isActive
                  ? 'bg-violet-50 border border-violet-200'
                  : 'hover:bg-gray-50 border border-transparent'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-gray-800">{name}</span>
                <ChevronRight className={`h-3 w-3 shrink-0 ${isActive ? 'text-violet-500' : 'text-gray-300'}`} />
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] font-mono text-gray-400">{shortAddress(addr)}</span>
                <Badge variant="secondary" className="h-4 text-[10px] py-0">{count} records</Badge>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Records panel ────────────────────────────────────────────────────────────

type RecordItem = {
  key      : `0x${string}`
  selected : boolean
}

function RecordsPanel({
  tableAddress,
  walletAddress,
  selectedKey,
  onSelect,
  onWriteClick,
}: {
  tableAddress  : Address
  walletAddress : Address
  selectedKey   : `0x${string}` | null
  onSelect      : (key: `0x${string}`) => void
  onWriteClick  : () => void
}) {
  const publicClient = usePublicClient({ chainId: CHAIN_ID })

  const { data: rawOwnerKeys, isLoading: ownedLoading, refetch } = useReadContract({
    address: tableAddress,
    abi: TABLE_ABI,
    functionName: 'getOwnerRecords',
    args: [walletAddress, 0n, 50n],
    chainId: CHAIN_ID,
  })

  // Also find records granted to this user (e.g. written by relay on their behalf)
  const [grantedKeys, setGrantedKeys] = useState<`0x${string}`[]>([])
  const [grantedLoading, setGrantedLoading] = useState(false)

  useEffect(() => {
    if (!publicClient || !tableAddress || !walletAddress) return
    let cancelled = false
    setGrantedLoading(true)
    ;(async () => {
      try {
        const [grantLogs, revokeLogs] = await Promise.all([
          publicClient.getLogs({
            address: tableAddress,
            event: parseAbiItem('event AccessGranted(bytes32 indexed key, address indexed user, uint8 role)'),
            args: { user: walletAddress },
            fromBlock: 0n,
            toBlock: 'latest',
          }),
          publicClient.getLogs({
            address: tableAddress,
            event: parseAbiItem('event AccessRevoked(bytes32 indexed key, address indexed user)'),
            args: { user: walletAddress },
            fromBlock: 0n,
            toBlock: 'latest',
          }),
        ])
        if (cancelled) return
        const revokedSet = new Set(revokeLogs.map(l => l.args.key))
        const active = grantLogs
          .map(l => l.args.key as `0x${string}`)
          .filter((k): k is `0x${string}` => !!k && !revokedSet.has(k))
        // deduplicate — same key may appear multiple times if re-granted
        setGrantedKeys([...new Set(active)])
      } catch { /* chain query failed — show owned only */ }
      finally { if (!cancelled) setGrantedLoading(false) }
    })()
    return () => { cancelled = true }
  }, [publicClient, tableAddress, walletAddress])

  const ownedKeys = (rawOwnerKeys ?? []) as `0x${string}`[]
  // Merge: owned first, then granted-but-not-owned (avoid duplicates)
  const ownedSet  = new Set(ownedKeys)
  const keys = [
    ...ownedKeys,
    ...grantedKeys.filter(k => !ownedSet.has(k)),
  ]
  const isLoading = ownedLoading || grantedLoading

  // Fetch read metadata for all keys (version, updatedAt, owner)
  const { data: metaResults } = useReadContracts({
    contracts: keys.map((k) => ({
      address: tableAddress,
      abi: TABLE_ABI,
      functionName: 'read',
      args: [k],
      chainId: CHAIN_ID,
    })),
    query: { enabled: !!keys.length },
  })

  // bump to re-trigger the granted-keys effect
  const [grantsBump, setGrantsBump] = useState(0)
  useEffect(() => { if (grantsBump > 0) setGrantedKeys([]) }, [grantsBump])

  return (
    <div className="flex flex-col h-full">
      <SectionTitle icon={FileText}>
        Records
        {grantedKeys.length > 0 && (
          <span className="ml-1.5 text-[10px] font-medium text-teal-600">+{grantedKeys.length} shared</span>
        )}
      </SectionTitle>
      <div className="flex items-center justify-between px-3 py-1.5">
        <button
          onClick={() => { refetch(); setGrantsBump(n => n + 1) }}
          className="text-[11px] text-gray-400 hover:text-violet-600 flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
        <Button
          size="sm"
          variant="default"
          className="h-6 text-[11px] bg-violet-600 hover:bg-violet-700 text-white gap-1"
          onClick={onWriteClick}
        >
          <Plus className="h-3 w-3" /> New Record
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {isLoading && <Skeleton className="h-8 w-full mt-2" />}
        {!isLoading && !keys.length && (
          <EmptyState icon={FileText} message="No records yet. Write your first record." />
        )}
        {keys.map((key, i) => {
          const meta     = metaResults?.[i]?.result as readonly [string, boolean, bigint, bigint, string] | undefined
          const deleted  = meta?.[1] ?? false
          const isShared = !ownedSet.has(key)
          const version  = meta?.[2]?.toString() ?? '?'
          const updatedAt = meta?.[3]
            ? new Date(Number(meta[3]) * 1000).toLocaleString()
            : '—'
          const isActive = key === selectedKey
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${
                isActive
                  ? 'bg-violet-50 border border-violet-200'
                  : deleted
                    ? 'opacity-40 hover:bg-gray-50 border border-transparent'
                    : 'hover:bg-gray-50 border border-transparent'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-mono text-gray-700">{key.slice(0, 10)}…{key.slice(-6)}</span>
                <div className="flex items-center gap-1">
                  {isShared && <Badge variant="secondary" className="h-4 text-[10px] bg-teal-50 text-teal-700">shared</Badge>}
                  {deleted
                    ? <Badge variant="danger" className="h-4 text-[10px]">deleted</Badge>
                    : <Badge variant="secondary" className="h-4 text-[10px]">v{version}</Badge>}
                </div>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">{updatedAt}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Record detail panel ──────────────────────────────────────────────────────

type ReadResult = {
  success     : boolean
  ciphertext  : string
  encryptedKey: string
  recordKey   : string
  version     : string
  updatedAt   : string
  owner       : string
}

function RecordDetailPanel({
  tableAddress,
  tableName,
  recordKey,
  walletAddress,
  keypair,
  onDeleted,
}: {
  tableAddress  : Address
  tableName     : string
  recordKey     : `0x${string}`
  walletAddress : Address
  keypair       : BrowserKeypair | null
  onDeleted     : () => void
}) {
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [recordData, setRecordData] = useState<ReadResult | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [plaintext,  setPlaintext]  = useState<string | null>(null)
  const [decryptErr, setDecryptErr] = useState<string | null>(null)

  const { writeContract, data: deleteTxHash, isPending: isDeleting } = useWriteContract()
  const { isSuccess: deleteSuccess } = useWaitForTransactionReceipt({ hash: deleteTxHash })

  // Reset when record key changes
  useEffect(() => {
    setFetchState('idle')
    setRecordData(null)
    setPlaintext(null)
    setFetchError(null)
    setDecryptErr(null)
  }, [recordKey])

  useEffect(() => {
    if (deleteSuccess) onDeleted()
  }, [deleteSuccess, onDeleted])

  const fetchRecord = useCallback(async () => {
    setFetchState('loading')
    setFetchError(null)
    setPlaintext(null)
    try {
      const url = `/api/connector/record/${tableAddress}/0?fromAddress=${walletAddress}&rawKey=${recordKey}`
      const res = await fetch(url)
      const json = await res.json()
      if (!res.ok) {
        setFetchError(json.message ?? 'Fetch failed')
        setFetchState('error')
        return
      }
      setRecordData(json)
      setFetchState('done')
    } catch (e: any) {
      setFetchError(e.message)
      setFetchState('error')
    }
  }, [tableAddress, walletAddress, recordKey])

  const decrypt = useCallback(() => {
    if (!keypair || !recordData) return
    setDecryptErr(null)
    try {
      const pt = decryptRecord(recordData.ciphertext, recordData.encryptedKey, keypair)
      setPlaintext(pt)
    } catch (e: any) {
      setDecryptErr(e.message)
    }
  }, [keypair, recordData])

  const handleDelete = useCallback(() => {
    writeContract({
      address: tableAddress,
      abi: TABLE_ABI,
      functionName: 'deleteRecord',
      args: [recordKey],
      chainId: CHAIN_ID,
    })
  }, [writeContract, tableAddress, recordKey])

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] text-gray-500 mb-0.5">Record Key</p>
          <p className="text-[12px] font-mono text-gray-700 break-all">{recordKey}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="text-[11px] h-7 shrink-0 border-red-200 text-red-600 hover:bg-red-50"
          onClick={handleDelete}
          disabled={isDeleting || deleteSuccess}
        >
          {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </Button>
      </div>

      <Separator />

      {fetchState === 'idle' && (
        <Button size="sm" variant="outline" className="text-[12px] h-7 w-full" onClick={fetchRecord}>
          <FileText className="h-3 w-3 mr-1" /> Fetch from chain
        </Button>
      )}
      {fetchState === 'loading' && (
        <div className="flex items-center gap-2 text-[12px] text-gray-500">
          <Loader2 className="h-3 w-3 animate-spin" /> Fetching record…
        </div>
      )}
      {fetchState === 'error' && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-red-700 text-[12px] font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            {fetchError?.includes('ACCESS_DENIED') ? 'Access Revoked' : 'Error'}
          </div>
          <p className="text-[11px] text-red-600">{fetchError}</p>
          <Button size="sm" variant="outline" className="text-[11px] h-6 mt-1" onClick={fetchRecord}>
            Retry
          </Button>
        </div>
      )}

      {fetchState === 'done' && recordData && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="text-gray-400">Version</span>
              <p className="font-medium text-gray-700">{recordData.version}</p>
            </div>
            <div>
              <span className="text-gray-400">Updated</span>
              <p className="font-medium text-gray-700">
                {new Date(recordData.updatedAt).toLocaleString()}
              </p>
            </div>
            <div className="col-span-2">
              <span className="text-gray-400">Owner</span>
              <p className="font-mono font-medium text-gray-700">{shortAddress(recordData.owner)}</p>
            </div>
          </div>

          <div>
            <p className="text-[11px] text-gray-400 mb-1">Ciphertext (hex)</p>
            <div className="bg-gray-50 rounded p-2 text-[10px] font-mono text-gray-500 break-all max-h-16 overflow-y-auto">
              {recordData.ciphertext.slice(0, 80)}…
            </div>
          </div>

          {!plaintext && (
            <div>
              {keypair ? (
                <Button size="sm" variant="outline" className="text-[12px] h-7 w-full gap-1.5" onClick={decrypt}>
                  <LockOpen className="h-3 w-3" /> Decrypt
                </Button>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-600">
                  <Lock className="h-3 w-3" /> Derive encryption keys above to decrypt
                </div>
              )}
              {decryptErr && (
                <p className="text-[11px] text-red-600 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {decryptErr}
                </p>
              )}
            </div>
          )}

          {plaintext && (
            <div>
              <p className="text-[11px] text-green-600 font-medium mb-1 flex items-center gap-1">
                <LockOpen className="h-3 w-3" /> Decrypted plaintext
              </p>
              <div className="bg-green-50 border border-green-200 rounded p-2 text-[12px] text-gray-800 whitespace-pre-wrap break-all">
                {plaintext}
              </div>
            </div>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="text-[11px] h-6 text-gray-400"
            onClick={fetchRecord}
          >
            <RefreshCw className="h-3 w-3 mr-1" /> Re-fetch
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Write record panel ───────────────────────────────────────────────────────

function WriteRecordPanel({
  tableAddress,
  tableName,
  walletAddress,
  keypair,
  onDeriveKeys,
  onWritten,
  onCancel,
}: {
  tableAddress  : Address
  tableName     : string
  walletAddress : Address
  keypair       : BrowserKeypair | null
  onDeriveKeys  : () => void
  onWritten     : () => void
  onCancel      : () => void
}) {
  const [recordId,  setRecordId]  = useState<string>(() => String(Date.now()))
  const [content,   setContent]   = useState('')
  const [status,    setStatus]    = useState<'idle' | 'encrypting' | 'signing' | 'submitting' | 'done' | 'error'>('idle')
  const [errMsg,    setErrMsg]    = useState<string | null>(null)
  const [txHash,    setTxHash]    = useState<string | null>(null)

  const { signTypedDataAsync } = useSignTypedData()

  const submit = useCallback(async () => {
    if (!keypair) { onDeriveKeys(); return }
    if (!content.trim()) { setErrMsg('Content cannot be empty'); return }
    if (!recordId.trim()) { setErrMsg('Record ID required'); return }
    setErrMsg(null)

    try {
      // 1. Fetch relay info
      setStatus('encrypting')
      const relayInfo  = await fetchRelayInfo()
      const relayPubKey = hexToPublicKey(relayInfo.relayX25519PubKey)

      // 2. Encrypt locally
      const { ciphertextHex, encryptedKeyForSelf, encryptedKeyForRelay } =
        encryptRecord(content, keypair, relayPubKey)

      // 3. Build EIP-712 intent
      setStatus('signing')
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300) // 5 min
      const nonce    = BigInt(Date.now())                           // millis = unique enough
      const recordIdBig = BigInt(recordId)
      const ciphertextHash = keccak256(ciphertextHex as `0x${string}`)

      const chainId = CHAIN_ID
      const domain  = { name: 'Web3QL Relay', version: '1', chainId } as const
      const types   = {
        RelayIntent: [
          { name: 'tableAddress',   type: 'address' },
          { name: 'tableName',      type: 'string'  },
          { name: 'recordId',       type: 'uint256' },
          { name: 'ciphertextHash', type: 'bytes32' },
          { name: 'deadline',       type: 'uint256' },
          { name: 'nonce',          type: 'uint256' },
        ],
      } as const
      const message = {
        tableAddress  : tableAddress,
        tableName,
        recordId      : recordIdBig,
        ciphertextHash,
        deadline,
        nonce,
      } as const

      const signature = await signTypedDataAsync({ domain, types, primaryType: 'RelayIntent', message })

      // 4. Submit intent to relay
      setStatus('submitting')
      const body = {
        tableAddress,
        tableName,
        recordId     : recordIdBig.toString(),
        ciphertext   : ciphertextHex,
        encryptedKeyForRelay,
        encryptedKeyForUser: encryptedKeyForSelf,
        userAddress  : walletAddress,
        userRole     : 2,   // EDITOR — so user can update their own record back
        signature,
        deadline     : deadline.toString(),
        nonce        : nonce.toString(),
      }

      const res = await fetch('/api/connector/relay/submit-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? 'Relay failed')

      setTxHash(json.txHash)
      setStatus('done')
      setTimeout(onWritten, 2000)
    } catch (e: any) {
      setErrMsg(e.message ?? 'Unknown error')
      setStatus('error')
    }
  }, [keypair, content, recordId, tableAddress, tableName, walletAddress, signTypedDataAsync, onDeriveKeys, onWritten])

  const busy = status === 'encrypting' || status === 'signing' || status === 'submitting'

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-gray-700 flex items-center gap-1.5">
          <Plus className="h-4 w-4 text-violet-500" /> New Record
        </h3>
        <button onClick={onCancel} className="text-[11px] text-gray-400 hover:text-gray-600">cancel</button>
      </div>

      {!keypair && (
        <div className="rounded bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-700 flex items-center gap-1.5">
          <KeyRound className="h-3 w-3 shrink-0" />
          Encryption keys required.{' '}
          <button onClick={onDeriveKeys} className="underline font-medium">Derive keys first</button>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="rid" className="text-[11px] text-gray-500">Record ID (uint256)</Label>
        <Input
          id="rid"
          className="h-7 text-[12px] font-mono"
          value={recordId}
          onChange={e => setRecordId(e.target.value)}
          placeholder="e.g. 1234567890"
          disabled={busy}
        />
        <p className="text-[10px] text-gray-400">
          Key will be: keccak256({tableName}, {recordId || '…'})
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="content" className="text-[11px] text-gray-500">Content (plaintext)</Label>
        <Textarea
          id="content"
          className="text-[12px] resize-none"
          rows={4}
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder='{"name":"alice","age":30}'
          disabled={busy}
        />
      </div>

      {errMsg && (
        <p className="text-[11px] text-red-600 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {errMsg}
        </p>
      )}

      {status === 'done' && (
        <div className="flex items-center gap-1.5 text-[11px] text-green-600 font-medium">
          <CheckCircle2 className="h-4 w-4" />
          Written! tx: {txHash ? shortAddress(txHash) : '…'}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="text-[12px] h-7 bg-violet-600 hover:bg-violet-700 text-white flex-1 gap-1"
          onClick={submit}
          disabled={busy || !keypair || status === 'done'}
        >
          {busy ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {status === 'encrypting' ? 'Encrypting…' : status === 'signing' ? 'Sign in wallet…' : 'Submitting…'}
            </>
          ) : (
            <>
              <Lock className="h-3 w-3" /> Encrypt &amp; Write
            </>
          )}
        </Button>
      </div>
      <p className="text-[10px] text-gray-400">
        Data is encrypted client-side. Only you (with your derived keys) can decrypt it.
        The relay pays gas via EIP-712 signed intent.
      </p>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TestPage() {
  const { address, isConnected } = useAccount()

  const [keypair,       setKeypair]       = useState<BrowserKeypair | null>(null)
  const [selectedDb,    setSelectedDb]    = useState<Address | null>(null)
  const [selectedTable, setSelectedTable] = useState<{ name: string; address: Address } | null>(null)
  const [selectedKey,   setSelectedKey]   = useState<`0x${string}` | null>(null)
  const [showWrite,     setShowWrite]     = useState(false)
  const [recordsNonce,  setRecordsNonce]  = useState(0) // bump to force records refetch

  // Restore keypair from sessionStorage on mount
  useEffect(() => {
    const sig = sessionStorage.getItem('web3ql_derived_sig')
    if (sig) {
      try { setKeypair(deriveKeypairFromSignature(sig)) } catch { /* stale */ }
    }
  }, [])

  // Clear selections when parent changes
  const handleDbSelect = useCallback((addr: Address) => {
    setSelectedDb(addr)
    setSelectedTable(null)
    setSelectedKey(null)
    setShowWrite(false)
  }, [])

  const handleTableSelect = useCallback((t: { name: string; address: Address }) => {
    setSelectedTable(t)
    setSelectedKey(null)
    setShowWrite(false)
  }, [])

  if (!isConnected || !address) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Database className="h-12 w-12 text-gray-200" />
        <p className="text-gray-500 text-[14px]">Connect your wallet to explore your data</p>
        <ConnectButton />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-screen-xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-[18px] font-bold text-gray-900">Explorer</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">
          Browse your databases, tables, and records. Read and write encrypted data directly from your wallet.
        </p>
      </div>

      {/* Key derivation banner */}
      <KeySetupBanner keypair={keypair} onDerived={setKeypair} />

      {/* 3-column explorer */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_220px_1fr] gap-4 min-h-[480px]">

        {/* Column 1 — Databases */}
        <Card className="overflow-hidden flex flex-col">
          <DatabasesPanel
            address={address}
            selectedDb={selectedDb}
            onSelect={handleDbSelect}
          />
        </Card>

        {/* Column 2 — Tables */}
        <Card className="overflow-hidden flex flex-col">
          {selectedDb ? (
            <TablesPanel
              dbAddress={selectedDb}
              selectedTable={selectedTable}
              onSelect={handleTableSelect}
            />
          ) : (
            <div className="flex flex-col h-full">
              <SectionTitle icon={Table2}>Tables</SectionTitle>
              <EmptyState icon={Database} message="Select a database" />
            </div>
          )}
        </Card>

        {/* Column 3 — Records + detail */}
        <Card className="overflow-hidden flex flex-col">
          {selectedTable ? (
            <div className="flex flex-col h-full">
              {/* Records list (top half) */}
              <div className="flex-none" style={{ maxHeight: showWrite ? '0px' : '280px', overflow: 'hidden', transition: 'max-height 0.2s' }}>
                <RecordsPanel
                  key={`${selectedTable.address}-${recordsNonce}`}
                  tableAddress={selectedTable.address}
                  walletAddress={address}
                  selectedKey={selectedKey}
                  onSelect={(k) => { setSelectedKey(k); setShowWrite(false) }}
                  onWriteClick={() => { setShowWrite(true); setSelectedKey(null) }}
                />
              </div>

              <Separator />

              {/* Detail / write panel (bottom) */}
              <div className="flex-1 overflow-y-auto">
                {showWrite && (
                  <WriteRecordPanel
                    tableAddress={selectedTable.address}
                    tableName={selectedTable.name}
                    walletAddress={address}
                    keypair={keypair}
                    onDeriveKeys={() => setShowWrite(false)}
                    onWritten={() => {
                      setShowWrite(false)
                      setRecordsNonce(n => n + 1)
                    }}
                    onCancel={() => setShowWrite(false)}
                  />
                )}
                {!showWrite && selectedKey && (
                  <RecordDetailPanel
                    tableAddress={selectedTable.address}
                    tableName={selectedTable.name}
                    recordKey={selectedKey}
                    walletAddress={address}
                    keypair={keypair}
                    onDeleted={() => {
                      setSelectedKey(null)
                      setRecordsNonce(n => n + 1)
                    }}
                  />
                )}
                {!showWrite && !selectedKey && (
                  <EmptyState icon={FileText} message="Select a record to view details" />
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <SectionTitle icon={FileText}>Records</SectionTitle>
              <EmptyState icon={Table2} message="Select a table" />
            </div>
          )}
        </Card>
      </div>

      {/* Feasibility notes */}
      <Card className="bg-gray-50 border-dashed">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-[12px] font-semibold text-gray-600">What works right now</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
            {[
              ['✅', 'List databases owned by your wallet (Factory)'],
              ['✅', 'List tables in any database (Database.listTables)'],
              ['✅', 'List records you own (Table.getOwnerRecords)'],
              ['✅', 'Read encrypted ciphertext + your key copy from chain'],
              ['✅', 'Decrypt records with signature-derived X25519 keys'],
              ['✅', 'Write new records (encrypted, gasless via relay intent)'],
              ['✅', 'Delete records you own (direct on-chain tx)'],
              ['⚠️', 'Records shared WITH you — scan AccessGranted events (coming soon)'],
              ['⚠️', 'Records written via SDK use different key derivation (ETH privkey vs signature)'],
            ].map(([icon, text]) => (
              <p key={text} className="text-gray-500"><span className="mr-1">{icon}</span>{text}</p>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
