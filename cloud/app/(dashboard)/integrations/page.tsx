'use client'

import { useState, useEffect } from 'react'
import { useAccount, useSignMessage, useReadContract, useReadContracts } from 'wagmi'
import { Plus, Copy, Check, Trash2, Code, BookOpen, Server, Zap, Wallet, Loader2, AlertCircle, Database, Table2, Globe, ChevronDown } from 'lucide-react'
import { useAppStore } from '@/store'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { FACTORY_ADDRESS as FACTORY_ADDR, FACTORY_ABI, DATABASE_ABI, TABLE_ABI, CHAIN_ID } from '@/lib/contracts'
import type { Address } from 'viem'

// ─── Types ────────────────────────────────────────────────────────────────────

type ResourceScope =
  | { type: 'all' }
  | { type: 'database'; address: string; name: string }
  | { type: 'table'; tableAddress: string; tableName: string; dbAddress: string; dbName: string }

interface WalletAccess {
  id: string
  name: string
  walletAddress: string
  registered: boolean
  scope: ResourceScope
  createdAt: number
}

// ─── Wallet Access management ─────────────────────────────────────────────────

function useWalletAccess() {
  const STORAGE_KEY = 'web3ql-wallet-access'
  const [wallets, setWallets] = useState<WalletAccess[]>([])

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as WalletAccess[]
      // backfill scope for entries saved before this change
      setWallets(raw.map(w => ({ ...w, scope: w.scope ?? { type: 'all' } })))
    } catch { /* ignore */ }
  }, [])

  const addWallet = (name: string, walletAddress: string, registered = false, scope: ResourceScope = { type: 'all' }) => {
    const entry: WalletAccess = { id: crypto.randomUUID(), name, walletAddress: walletAddress.toLowerCase(), registered, scope, createdAt: Date.now() }
    const updated = [...wallets, entry]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    setWallets(updated)
    return entry
  }

  const removeWallet = (id: string) => {
    const updated = wallets.filter(w => w.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    setWallets(updated)
  }

  return { wallets, addWallet, removeWallet }
}

// ─── Scope badge helper ───────────────────────────────────────────────────────

function ScopeBadge({ scope }: { scope: ResourceScope }) {
  if (scope.type === 'all') return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">all resources</span>
  if (scope.type === 'database') return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 flex items-center gap-1 max-w-[140px] truncate">
      <Database className="h-2.5 w-2.5 shrink-0" />{scope.name}
    </span>
  )
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 flex items-center gap-1 max-w-[140px] truncate">
      <Table2 className="h-2.5 w-2.5 shrink-0" />{scope.tableName}
    </span>
  )
}

// ─── Wallet Access Row ────────────────────────────────────────────────────────

function WalletAccessRow({ wallet, onDelete }: { wallet: WalletAccess; onDelete: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard.writeText(wallet.walletAddress); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  const shortAddr = wallet.walletAddress.slice(0, 6) + '…' + wallet.walletAddress.slice(-4)

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 rounded-xl transition-colors">
      <div className="h-8 w-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
        <Wallet className="h-4 w-4 text-violet-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[13px] font-medium text-gray-900">{wallet.name}</p>
          {wallet.registered
            ? <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-50 text-green-700">registered</span>
            : <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">local only</span>}
          <ScopeBadge scope={wallet.scope} />
        </div>
        <p className="text-[12px] font-mono text-gray-400">{shortAddr}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={copy} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-400">
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button onClick={onDelete} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Resource scope picker ────────────────────────────────────────────────────

function ResourceScopePicker({
  ownerAddress,
  value,
  onChange,
}: {
  ownerAddress: Address | undefined
  value: ResourceScope
  onChange: (s: ResourceScope) => void
}) {
  const [openScope, setOpenScope] = useState<'all' | 'database' | 'table'>('all')
  const [selectedDb, setSelectedDb] = useState<{ address: string; name: string } | null>(null)

  // Fetch user's databases
  const { data: dbAddresses } = useReadContract({
    address: FACTORY_ADDR,
    abi: FACTORY_ABI,
    functionName: 'getUserDatabases',
    args: ownerAddress ? [ownerAddress] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!ownerAddress },
  })

  // Fetch names for all DBs
  const { data: dbNames } = useReadContracts({
    contracts: (dbAddresses ?? []).map(addr => ({
      address: addr as Address,
      abi: DATABASE_ABI,
      functionName: 'databaseName',
      chainId: CHAIN_ID,
    })),
    query: { enabled: !!dbAddresses?.length },
  })

  // Fetch table names for selected DB
  const { data: tableNames } = useReadContract({
    address: selectedDb?.address as Address | undefined,
    abi: DATABASE_ABI,
    functionName: 'listTables',
    chainId: CHAIN_ID,
    query: { enabled: !!selectedDb },
  })

  // Fetch table addresses for selected DB tables
  const { data: tableAddrs } = useReadContracts({
    contracts: (tableNames ?? []).map(name => ({
      address: selectedDb?.address as Address,
      abi: DATABASE_ABI,
      functionName: 'getTable',
      args: [name],
      chainId: CHAIN_ID,
    })),
    query: { enabled: !!selectedDb && !!tableNames?.length },
  })

  const dbs = (dbAddresses ?? []).map((addr, i) => ({
    address: addr as string,
    name: (dbNames?.[i]?.result as string) ?? addr.slice(0, 8) + '…',
  }))

  const tables = (tableNames ?? []).map((name, i) => ({
    tableName: name,
    tableAddress: (tableAddrs?.[i]?.result as string) ?? '',
  }))

  const handleScopeType = (type: 'all' | 'database' | 'table') => {
    setOpenScope(type)
    if (type === 'all') { setSelectedDb(null); onChange({ type: 'all' }) }
    if (type === 'database') onChange(selectedDb ? { type: 'database', address: selectedDb.address, name: selectedDb.name } : { type: 'all' })
    if (type === 'table') { /* wait for user to pick */ }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium text-gray-500">Access scope</p>
      <div className="flex gap-2">
        {[
          { key: 'all',      label: 'All resources', Icon: Globe },
          { key: 'database', label: 'Database',       Icon: Database },
          { key: 'table',    label: 'Table',          Icon: Table2 },
        ].map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => handleScopeType(key as 'all' | 'database' | 'table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors ${
              openScope === key
                ? 'border-violet-400 bg-violet-50 text-violet-700'
                : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Database picker */}
      {(openScope === 'database' || openScope === 'table') && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-gray-400">Select database</p>
          {!dbs.length
            ? <p className="text-[11px] text-gray-400 italic">No databases found for connected wallet.</p>
            : <div className="flex flex-wrap gap-2">
                {dbs.map(db => (
                  <button
                    key={db.address}
                    type="button"
                    onClick={() => {
                      setSelectedDb(db)
                      if (openScope === 'database') onChange({ type: 'database', address: db.address, name: db.name })
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12px] transition-colors ${
                      selectedDb?.address === db.address
                        ? 'border-violet-400 bg-violet-50 text-violet-700 font-medium'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                    }`}
                  >
                    <Database className="h-3 w-3" />
                    {db.name}
                  </button>
                ))}
              </div>
          }
        </div>
      )}

      {/* Table picker */}
      {openScope === 'table' && selectedDb && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-gray-400">Select table in <span className="font-medium text-gray-600">{selectedDb.name}</span></p>
          {!tables.length
            ? <p className="text-[11px] text-gray-400 italic">No tables in this database.</p>
            : <div className="flex flex-wrap gap-2">
                {tables.map(t => {
                  const isActive = value.type === 'table' && value.tableName === t.tableName
                  return (
                    <button
                      key={t.tableName}
                      type="button"
                      disabled={!t.tableAddress}
                      onClick={() => onChange({ type: 'table', tableAddress: t.tableAddress, tableName: t.tableName, dbAddress: selectedDb.address, dbName: selectedDb.name })}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12px] transition-colors disabled:opacity-40 ${
                        isActive
                          ? 'border-teal-400 bg-teal-50 text-teal-700 font-medium'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                      }`}
                    >
                      <Table2 className="h-3 w-3" />
                      {t.tableName}
                    </button>
                  )
                })}
              </div>
          }
        </div>
      )}

      {/* Scope summary */}
      <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
        <span>Scope:</span>
        <ScopeBadge scope={value} />
      </div>
    </div>
  )
}

// ─── Add Wallet Form ──────────────────────────────────────────────────────────

function AddWalletForm({ onAdded }: { onAdded: (name: string, address: string, registered: boolean, scope: ResourceScope) => void }) {
  const [name, setName]       = useState('')
  const [address, setAddress] = useState('')
  const [scope, setScope]     = useState<ResourceScope>({ type: 'all' })
  const [pending, setPending] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const { address: connectedAddress } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const isValid    = name.trim().length > 0 && /^0x[0-9a-fA-F]{40}$/.test(address.trim())
  const scopeReady = scope.type === 'all' || (scope.type === 'database' && !!scope.address) || (scope.type === 'table' && !!scope.tableAddress)
  const isOwnWallet = connectedAddress?.toLowerCase() === address.trim().toLowerCase()

  const add = async () => {
    if (!isValid || !scopeReady || pending) return
    setError(null)
    setPending(true)
    try {
      if (isOwnWallet) {
        const msg = `Register wallet for Web3QL relay: ${address.trim().toLowerCase()}`
        const signature = await signMessageAsync({ message: msg })
        const res  = await fetch('/api/connector/relay/register-wallet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress: address.trim(), signature }),
        })
        const data = await res.json()
        if (!data.success) throw new Error(data.error ?? 'Registration failed')
        onAdded(name.trim(), address.trim(), true, scope)
      } else {
        onAdded(name.trim(), address.trim(), false, scope)
      }
      setName(''); setAddress(''); setScope({ type: 'all' })
    } catch (err: any) {
      if (err.code === 4001 || err.message?.includes('rejected')) setError('Signature rejected.')
      else setError(err.message ?? 'Something went wrong.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input
          placeholder="Name (e.g. my-app)"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-36 shrink-0"
          disabled={pending}
        />
        <Input
          placeholder="0x wallet address"
          value={address}
          onChange={e => { setAddress(e.target.value); setError(null) }}
          onKeyDown={e => e.key === 'Enter' && add()}
          className="flex-1 font-mono text-[12px]"
          disabled={pending}
        />
        {connectedAddress && (
          <button
            type="button"
            onClick={() => { setAddress(connectedAddress); setError(null) }}
            className="shrink-0 text-[12px] px-3 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
            disabled={pending}
          >
            Use mine
          </button>
        )}
      </div>

      {/* Resource scope picker — shown once a valid address is entered */}
      {isValid && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
          <ResourceScopePicker
            ownerAddress={connectedAddress}
            value={scope}
            onChange={setScope}
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={!isValid || !scopeReady || pending}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 text-white text-[13px] font-medium hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {pending
            ? <><Loader2 className="h-4 w-4 animate-spin" />{isOwnWallet ? 'Signing…' : 'Adding…'}</>
            : <><Plus className="h-4 w-4" />{isOwnWallet ? 'Sign & Add' : 'Add'}</>}
        </button>
        {isValid && isOwnWallet && !pending && (
          <p className="text-[11px] text-violet-600">Will ask you to sign a message to prove ownership.</p>
        )}
        {isValid && !isOwnWallet && !pending && (
          <p className="text-[11px] text-gray-400">Third-party wallet — stored locally. Owner must register with the relay separately.</p>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-[12px] text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
        </div>
      )}
    </div>
  )
}

// ─── Snippets ─────────────────────────────────────────────────────────────────

const FACTORY_ADDRESS  = '0x2cfE616062261927fCcC727333d6dD3D5880FDd1'
const REGISTRY_ADDRESS = '0x6379ee47C5087e200589Ea4F03141fc85ec53101'

const RELAY_ENV_SNIPPET = `# api/.env  — run on YOUR server, not client
RELAY_PRIVATE_KEY=<funded-relay-wallet-private-key>
RELAY_ALLOWED_WALLETS=0xABC123,0xDEF456   # paste wallet addresses from above

# Start connector
node api/server.js

# Check relay wallet address (grant this EDITOR access on your table)
curl http://localhost:4000/api/connector/relay/info`

const SDK_SNIPPET = `import { Web3QLClient, TypedTableClient, deriveKeypair } from '@web3ql/sdk'
import { ethers } from 'ethers'

const FACTORY  = '0x2cfE616062261927fCcC727333d6dD3D5880FDd1'
const REGISTRY = '0x6379ee47C5087e200589Ea4F03141fc85ec53101'

// ── Mode A: user signs their own txs (they pay gas) ──────────────────────────
const signer  = new ethers.Wallet(process.env.PRIVATE_KEY, provider)
const keypair = deriveKeypair(process.env.PRIVATE_KEY)

const client = new Web3QLClient(FACTORY, signer, keypair, REGISTRY)
await client.register()          // one-time per wallet

const db    = client.database('0xYOUR_DATABASE_ADDRESS')
const table = db.table('0xYOUR_TABLE_ADDRESS')
const users = new TypedTableClient('users', table)

await users.create(1n, { name: 'Alice', email: 'alice@example.com' })
const alice = await users.findUnique(1n)
console.log(alice?.data)         // { name: 'Alice', email: '...' }

// ── Mode B: relay — YOU pay gas, user signs an EIP-712 intent ───────────────
// Requires: connector running with RELAY_PRIVATE_KEY + RELAY_ALLOWED_WALLETS
// 1. User registers their wallet once via POST /relay/register-wallet
// 2. User signs a RelayIntent (no gas needed — relay pays)
// 3. Relay verifies signature + allowlist, executes on-chain
const intentRes = await fetch('https://your-connector/api/connector/relay/submit-intent', {
  method  : 'POST',
  headers : { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tableAddress        : '0xYOUR_TABLE_ADDRESS',
    tableName           : 'users',
    recordId            : 1,
    ciphertext          : '0x...',          // NaCl-encrypted payload (client-side)
    encryptedKeyForRelay: '0x...',          // symmetric key wrapped for relay wallet pubkey
    encryptedKeyForUser : '0x...',          // symmetric key wrapped for user wallet pubkey
    userAddress         : '0xUSER_WALLET', // user signs the intent below
    signature           : '0x...',          // EIP-712 RelayIntent signature
    deadline            : Math.floor(Date.now()/1000) + 300,
    nonce               : Date.now(),
  }),
})
const { txHash } = await intentRes.json()
console.log('Written on-chain, relay paid gas:', txHash)`

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const { activeDatabase } = useAppStore()
  const { wallets, addWallet, removeWallet } = useWalletAccess()

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Integrations</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">API keys, SDK usage, and developer resources</p>
      </div>

      <div className="max-w-3xl">
        <Tabs defaultValue="apikeys">
          <TabsList>
            <TabsTrigger value="apikeys">
              <Wallet className="h-3.5 w-3.5 mr-1.5" />Wallets
            </TabsTrigger>
            <TabsTrigger value="relay">
              <Zap className="h-3.5 w-3.5 mr-1.5" />Relay Setup
            </TabsTrigger>
            <TabsTrigger value="sdk">
              <Code className="h-3.5 w-3.5 mr-1.5" />SDK
            </TabsTrigger>
            <TabsTrigger value="docs">
              <BookOpen className="h-3.5 w-3.5 mr-1.5" />Docs
            </TabsTrigger>
          </TabsList>

          {/* Wallets */}
          <TabsContent value="apikeys">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-[15px] font-semibold text-gray-900">Wallet Access</h2>
                <p className="text-[12px] text-gray-500 mt-0.5">
                  Register wallets that are allowed to submit signed intents through your relay.
                  Users sign EIP-712 messages with their own wallet — no gas needed on their end.
                  Add each address to{' '}
                  <code className="font-mono bg-gray-100 px-1 rounded">RELAY_ALLOWED_WALLETS</code> in your connector env to persist across restarts.
                </p>
              </div>
              <div className="px-4 py-3 border-b border-gray-100">
                <AddWalletForm onAdded={(name, address, registered, scope) => addWallet(name, address, registered, scope)} />
              </div>
              {wallets.length === 0 ? (
                <div className="py-10 text-center text-gray-400">
                  <Wallet className="h-8 w-8 mx-auto mb-3 text-gray-300" />
                  <p className="text-[13px]">No wallets registered yet. Add one above.</p>
                </div>
              ) : (
                <div className="px-2 py-2">
                  {wallets.map((w) => (
                    <WalletAccessRow key={w.id} wallet={w} onDelete={() => removeWallet(w.id)} />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Relay Setup */}
          <TabsContent value="relay">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              <div className="px-6 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="h-4 w-4 text-violet-600" />
                  <h2 className="text-[15px] font-semibold text-gray-900">Sponsored Relay (Gasless for your users)</h2>
                </div>
                <p className="text-[12px] text-gray-500">
                  Run the connector with a funded relay wallet. Your users write/read with just an API key — no wallet, no gas.
                </p>
              </div>
              <div className="px-6 py-5 space-y-5">
                {/* How it works */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { step: '1', title: 'You fund a relay wallet', desc: 'A separate wallet on Celo Sepolia with a small CELO balance. Its private key lives only in your server env.' },
                    { step: '2', title: 'Users register their wallet', desc: 'Users add their wallet address in the Wallets tab. No secret key distributed — they only sign messages.' },
                    { step: '3', title: 'Users sign intents, relay pays', desc: 'Users sign EIP-712 RelayIntents (free). Your relay verifies the signature and submits the tx, paying all gas.' },
                  ].map(({ step, title, desc }) => (
                    <div key={step} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                      <div className="h-6 w-6 rounded-full bg-violet-100 text-violet-700 text-[11px] font-bold flex items-center justify-center mb-2">{step}</div>
                      <p className="text-[13px] font-medium text-gray-900 mb-0.5">{title}</p>
                      <p className="text-[11px] text-gray-500">{desc}</p>
                    </div>
                  ))}
                </div>

                {/* Setup snippet */}
                <div>
                  <p className="text-[12px] font-medium text-gray-500 mb-2">Configuration</p>
                  <pre className="bg-gray-950 rounded-xl px-4 py-3 text-[12px] font-mono text-green-400 overflow-x-auto whitespace-pre">
                    {RELAY_ENV_SNIPPET}
                  </pre>
                </div>

                {/* Endpoints */}
                <div>
                  <p className="text-[12px] font-medium text-gray-500 mb-2">Relay endpoints</p>
                  <div className="space-y-1.5">
                    {[
                      { method: 'GET',  path: '/api/connector/relay/info',            desc: 'Get relay address + X25519 pubkey' },
                      { method: 'POST', path: '/api/connector/relay/register-wallet', desc: 'Register your wallet (prove ownership via signature)' },
                      { method: 'POST', path: '/api/connector/relay/submit-intent',   desc: 'Gasless write — sign an EIP-712 intent, relay pays gas' },
                    ].map(({ method, path, desc }) => (
                      <div key={path} className="flex items-start gap-3 rounded-xl border border-gray-100 px-3 py-2">
                        <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${method === 'GET' ? 'bg-blue-50 text-blue-600' : 'bg-violet-50 text-violet-700'}`}>{method}</span>
                        <code className="text-[12px] font-mono text-gray-700 flex-1">{path}</code>
                        <span className="text-[11px] text-gray-400 shrink-0">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <Server className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[12px] font-medium text-amber-900">Encryption stays client-side</p>
                      <p className="text-[11px] text-amber-700 mt-0.5">
                        The relay server never sees plaintext. Clients encrypt their data locally and pass the
                        ciphertext + their symmetric key (wrapped with the relay wallet&apos;s X25519 pubkey) to the relay.
                        The user&apos;s Ethereum private key never leaves their device — they only sign an EIP-712 intent.
                        Include <code className="font-mono bg-amber-100 px-0.5 rounded">encryptedKeyForUser</code> so
                        the relay automatically grants them read-back access to their own record.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* SDK */}
          <TabsContent value="sdk">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-[15px] font-semibold text-gray-900">JavaScript/TypeScript SDK</h2>
              </div>
              <div className="px-6 py-4 space-y-4">
                <div>
                  <p className="text-[12px] font-medium text-gray-500 mb-2">Install</p>
                  <pre className="bg-gray-50 rounded-xl border border-gray-200 px-4 py-3 text-[12px] font-mono text-gray-700">
                    npm install @web3ql/sdk ethers
                  </pre>
                </div>
                <div>
                  <p className="text-[12px] font-medium text-gray-500 mb-2">Usage — direct SDK (Mode A) &amp; relay API (Mode B)</p>
                  <pre className="bg-gray-950 rounded-xl px-4 py-3 text-[12px] font-mono text-green-400 overflow-x-auto whitespace-pre">
                    {SDK_SNIPPET}
                  </pre>
                </div>
                {activeDatabase && (
                  <div>
                    <p className="text-[12px] font-medium text-gray-500 mb-2">Your active database</p>
                    <pre className="bg-violet-50 rounded-xl border border-violet-200 px-4 py-3 text-[12px] font-mono text-violet-700">
                      {activeDatabase.address}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Docs */}
          <TabsContent value="docs">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-[15px] font-semibold text-gray-900">Documentation</h2>
              </div>
              <div className="px-6 py-4 space-y-3">
                {[
                  { title: 'Getting Started', desc: 'Connect your wallet and create your first database', href: '#' },
                  { title: 'Schema Builder', desc: 'Define table schemas with visual or SQL interfaces', href: '#' },
                  { title: 'Records API', desc: 'Create, read, update, and delete on-chain records', href: '#' },
                  { title: 'Access Control', desc: 'Per-record role-based permissions', href: '#' },
                  { title: 'SDK Reference', desc: 'Full TypeScript API reference', href: '#' },
                ].map((doc) => (
                  <a
                    key={doc.title}
                    href={doc.href}
                    className="flex items-start gap-3 rounded-xl p-3 hover:bg-gray-50 transition-colors"
                  >
                    <BookOpen className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[13px] font-medium text-gray-900">{doc.title}</p>
                      <p className="text-[12px] text-gray-500">{doc.desc}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
