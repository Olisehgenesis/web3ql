'use client'

import { useState } from 'react'
import {
  Book,
  Code2,
  Database,
  ExternalLink,
  Key,
  Layers,
  Package,
  Plug,
  Shield,
  Terminal,
  Zap,
  ChevronRight,
  Copy,
  Check,
} from 'lucide-react'
import { FACTORY_ADDRESS, REGISTRY_ADDRESS, CHAIN_ID } from '@/lib/contracts'

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button
      onClick={copy}
      className="absolute top-3 right-3 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
      title="Copy"
    >
      {copied
        ? <Check className="h-3.5 w-3.5 text-green-400" />
        : <Copy className="h-3.5 w-3.5 text-gray-400" />}
    </button>
  )
}

function CodeBlock({ code, lang = 'ts' }: { code: string; lang?: string }) {
  return (
    <div className="relative">
      <pre className="bg-gray-900 text-gray-100 rounded-xl p-4 text-[12px] leading-relaxed overflow-x-auto font-mono">
        <code>{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  )
}

// ─── Section primitives ───────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="h-9 w-9 rounded-xl bg-violet-50 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="h-4.5 w-4.5 text-violet-600" style={{ height: '18px', width: '18px' }} />
      </div>
      <div>
        <h2 className="text-[17px] font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-[13px] text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

function Card({ children, className = '', id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={`bg-white rounded-2xl border border-gray-200 shadow-sm p-6 ${className}`}>
      {children}
    </div>
  )
}

function Note({ children, variant = 'info' }: { children: React.ReactNode; variant?: 'info' | 'warn' | 'tip' }) {
  const styles = {
    info: 'bg-blue-50 border-blue-100 text-blue-800',
    warn: 'bg-orange-50 border-orange-100 text-orange-800',
    tip:  'bg-violet-50 border-violet-100 text-violet-800',
  }
  return (
    <div className={`rounded-xl border px-4 py-3 text-[12.5px] leading-relaxed ${styles[variant]}`}>
      {children}
    </div>
  )
}

function KV({ label, value, mono, href }: { label: string; value: string; mono?: boolean; href?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-gray-100 last:border-0">
      <span className="text-[12.5px] text-gray-500 shrink-0 w-32">{label}</span>
      {mono ? (
        <span className="font-mono text-[11.5px] text-gray-800 break-all text-right">{value}</span>
      ) : (
        <span className="text-[12.5px] text-gray-900 text-right">{value}</span>
      )}
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="shrink-0 ml-2">
          <ExternalLink className="h-3 w-3 text-gray-400 hover:text-violet-600" />
        </a>
      )}
    </div>
  )
}

// ─── Nav anchors ──────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'quickstart',  label: 'Quick Start' },
  { id: 'sdk',         label: 'SDK' },
  { id: 'relay',       label: 'Relay API' },
  { id: 'crypto',      label: 'Encryption' },
  { id: 'contracts',   label: 'Contracts' },
  { id: 'self-deploy', label: 'Self-Host' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState('overview')

  return (
    <div className="flex gap-0 min-h-screen">
      {/* Left nav */}
      <aside className="hidden xl:flex flex-col w-52 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] border-r border-gray-100 py-6 px-3">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3 px-2">On this page</p>
        <nav className="space-y-0.5">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setActiveSection(s.id)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors ${
                activeSection === s.id
                  ? 'bg-violet-50 text-violet-700 font-medium'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <ChevronRight className="h-3 w-3 shrink-0" />
              {s.label}
            </a>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 p-6 md:p-8 max-w-3xl space-y-10">

        {/* Hero */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Book className="h-5 w-5 text-violet-600" />
            <span className="text-[12px] font-semibold text-violet-600 uppercase tracking-wide">Developer Docs</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Web3QL</h1>
          <p className="text-[15px] text-gray-600 leading-relaxed max-w-xl">
            End-to-end encrypted, on-chain SQL-like storage on Celo. No back-end, no indexer —
            every database, table, and record is a smart contract. Data is encrypted in the browser
            before it ever leaves your device.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            {['Celo Sepolia', 'EVM', 'NaCl encryption', 'UUPS proxies', 'Gasless writes'].map((t) => (
              <span key={t} className="text-[11px] font-medium bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">{t}</span>
            ))}
          </div>
        </div>

        {/* ── Overview ── */}
        <Card id="overview">
          <SectionHeader icon={Layers} title="Architecture" subtitle="How the pieces fit together" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {[
              { icon: Shield, label: 'protocol/', desc: 'Solidity contracts (Hardhat + OZ UUPS). Factory → Database → Table on-chain.' },
              { icon: Package, label: 'sdk/',      desc: 'TypeScript client. Encrypts records, calls contracts, manages keypairs.' },
              { icon: Zap,    label: 'cloud/',     desc: 'Next.js 15 dashboard. Relay API for gasless writes. Browser crypto.' },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="rounded-xl bg-gray-50 border border-gray-100 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-4 w-4 text-violet-600" />
                  <span className="text-[13px] font-semibold text-gray-800 font-mono">{label}</span>
                </div>
                <p className="text-[12px] text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 text-[12.5px] text-gray-600 leading-relaxed space-y-1.5">
            <p><strong>Write flow:</strong> Browser signs derivation message → X25519 keypair → encrypt record with NaCl secretbox → submit signed intent to relay API → relay pays gas → record + your encrypted key written on-chain.</p>
            <p><strong>Read flow:</strong> Fetch ciphertext + encrypted symmetric key from chain → decrypt key with your X25519 private key → decrypt record → show plaintext.</p>
            <p><strong>Access control:</strong> Relay grants EDITOR role via <code className="bg-gray-200 px-1 rounded text-[11px]">grantAccess(key, user, EDITOR)</code> — emits <code className="bg-gray-200 px-1 rounded text-[11px]">AccessGranted</code> event. The cloud UI scans these events to show shared records.</p>
          </div>
        </Card>

        {/* ── Quick Start ── */}
        <Card id="quickstart">
          <SectionHeader icon={Terminal} title="Quick Start" subtitle="Up and running in 3 steps" />
          <div className="space-y-4">

            <div>
              <p className="text-[13px] font-semibold text-gray-700 mb-2">1 — Install the SDK</p>
              <CodeBlock lang="bash" code={`npm install @web3ql/sdk ethers tweetnacl @noble/hashes`} />
            </div>

            <div>
              <p className="text-[13px] font-semibold text-gray-700 mb-2">2 — Create a database</p>
              <CodeBlock code={`import { Web3QLClient } from '@web3ql/sdk'
import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider('https://forno.celo-sepolia.celo-testnet.org')
const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY!, provider)

const client = new Web3QLClient(
  '${FACTORY_ADDRESS}',  // factory on Celo Sepolia
  wallet
)

const db = await client.createDatabase('my_app')
console.log('Database deployed at:', db.address)`} />
            </div>

            <div>
              <p className="text-[13px] font-semibold text-gray-700 mb-2">3 — Write &amp; read an encrypted record</p>
              <CodeBlock code={`import { deriveKeypairFromWallet, EncryptedTableClient } from '@web3ql/sdk'

// Derive keypair from wallet signature (same as browser)
const keypair = await deriveKeypairFromWallet(wallet)

const table = await db.createTable('users', '{"name":"string","email":"string"}')
const enc   = new EncryptedTableClient(table.address, wallet, keypair)

// Write
const recordId = 'user_001'
await enc.writeString(recordId, JSON.stringify({ name: 'Alice', email: 'alice@example.com' }))

// Read back
const plaintext = await enc.readString(recordId)
console.log(JSON.parse(plaintext)) // { name: 'Alice', email: 'alice@...' }`} />
            </div>

          </div>
        </Card>

        {/* ── SDK ── */}
        <Card id="sdk">
          <SectionHeader icon={Package} title="SDK Reference" subtitle="@web3ql/sdk — full TypeScript, ethers v6" />

          <p className="text-[13px] font-semibold text-gray-700 mb-2">Key exports</p>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 pr-4 font-semibold text-gray-600 w-56">Export</th>
                  <th className="text-left py-2 font-semibold text-gray-600">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[
                  ['Web3QLClient', 'Top-level entry point. createDatabase(), getUserDatabases()'],
                  ['DatabaseClient', 'createTable(), getTable(), listTables()'],
                  ['EncryptedTableClient', 'write(), read(), update(), delete(), grantAccess()'],
                  ['TypedTableClient', 'Prisma-style: findMany(), create(), updateById()'],
                  ['PublicKeyRegistryClient', 'register(), getPublicKey(), hasKey()'],
                  ['deriveKeypairFromWallet(signer)', '✅ Recommended — matches browser derivation'],
                  ['deriveKeypair(privKey)', '⚠️ Deprecated — incompatible with browser'],
                  ['generateSymmetricKey()', 'Random 32-byte key for one record'],
                  ['encryptRecord()', 'NaCl secretbox + box envelope'],
                  ['decryptRecord()', 'Inverse of encryptRecord'],
                ].map(([name, desc]) => (
                  <tr key={name}>
                    <td className="py-2 pr-4 font-mono text-violet-700">{name}</td>
                    <td className="py-2 text-gray-600">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Note variant="tip">
            Always use <code className="font-mono text-[11px]">deriveKeypairFromWallet(signer)</code> — it calls <code className="font-mono text-[11px]">signer.signMessage('Web3QL encryption key derivation v1')</code> deterministically, producing the same keypair as MetaMask in the browser. Records written with the SDK will then be readable in the Cloud Explorer.
          </Note>
        </Card>

        {/* ── Relay API ── */}
        <Card id="relay">
          <SectionHeader icon={Plug} title="Relay API" subtitle="Gasless write endpoints — hosted at /api/connector/relay" />

          <Note variant="info" >
            All relay endpoints require the header <code className="font-mono text-[11px]">x-api-key: &lt;RELAY_API_KEY&gt;</code>. Set <code className="font-mono text-[11px]">RELAY_API_KEY</code> in your cloud environment.
          </Note>

          <div className="mt-4 space-y-4">
            {[
              {
                method: 'POST', path: '/api/connector/relay/submit-intent',
                desc: 'Main write endpoint. Accepts an EIP-712 signed intent, decrypts the record key share, writes the record on-chain, and grants EDITOR access to the signer.',
                body: `{
  tableAddress : "0x...",
  tableName    : "users",
  recordId     : "user_001",
  ciphertext   : "0x...",        // NaCl secretbox blob
  encryptedKey : "0x...",        // symmetric key box-encrypted for relay
  signerAddress: "0x...",
  signature    : "0x..."         // EIP-712 sig over the intent hash
}`,
              },
              {
                method: 'POST', path: '/api/connector/relay/write',
                desc: 'Direct write (no intent). Relay decrypts the key share, writes record, grants access. Use when the relay is trusted and you don\'t need EIP-712 proof.',
                body: `{
  tableAddress : "0x...",
  tableName    : "users",
  recordId     : "user_001",
  ciphertext   : "0x...",
  encryptedKey : "0x..."
}`,
              },
              {
                method: 'POST', path: '/api/connector/relay/update',
                desc: 'Update an existing record. Relay must be the owner or have EDITOR role.',
                body: `{ tableAddress, tableName, recordId, ciphertext, encryptedKey }`,
              },
              {
                method: 'POST', path: '/api/connector/relay/delete',
                desc: 'Soft-delete a record (sets deleted flag on-chain).',
                body: `{ tableAddress, tableName, recordId }`,
              },
              {
                method: 'POST', path: '/api/connector/relay/register-wallet',
                desc: 'Register a wallet + its X25519 public key with the relay allowlist. Returns a signed registration proof.',
                body: `{ address, publicKey, signature, scope? }`,
              },
              {
                method: 'GET', path: '/api/connector/relay/info',
                desc: 'Returns relay wallet address + X25519 public key. Call this to encrypt the key share for the relay before submitting an intent.',
                body: null,
              },
            ].map(({ method, path, desc, body }) => (
              <div key={path} className="rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${method === 'GET' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{method}</span>
                  <code className="font-mono text-[12px] text-gray-800">{path}</code>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <p className="text-[12.5px] text-gray-600">{desc}</p>
                  {body && <CodeBlock lang="json" code={body} />}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Encryption ── */}
        <Card id="crypto">
          <SectionHeader icon={Key} title="Encryption Model" subtitle="NaCl X25519-XSalsa20-Poly1305 + secretbox" />
          <div className="space-y-3 text-[13px] text-gray-600 leading-relaxed">
            <p>
              Each record gets a <strong>random 32-byte symmetric key</strong> (secretbox). The symmetric key is
              encrypted separately for each authorised party using <strong>NaCl box</strong> (X25519 key agreement +
              XSalsa20-Poly1305). Only the encrypted blobs are ever written on-chain.
            </p>
            <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 font-mono text-[11.5px] space-y-1 text-gray-700">
              <p>secretbox blob  =  [ 24-byte nonce | XSalsa20-Poly1305(plaintext, symKey) ]</p>
              <p>key envelope    =  [ 24-byte nonce | box(symKey, myPriv, recipientPub) ]</p>
            </div>
            <p>
              <strong>Keypair derivation:</strong> The wallet signs the fixed message{' '}
              <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[11px] font-mono">"Web3QL encryption key derivation v1"</code>{' '}
              with <code className="font-mono text-[11px]">personal_sign</code>. SHA-256 of the signature bytes becomes the
              32-byte X25519 seed. Because Ethereum personal_sign is deterministic (RFC 6979), the same wallet always
              derives the same keypair — in the browser <em>and</em> in the SDK.
            </p>
          </div>
          <div className="mt-4">
            <CodeBlock code={`// Browser (cloud/lib/browser-crypto.ts)
const sig    = await signMessage({ message: 'Web3QL encryption key derivation v1' })
const keypair = deriveKeypairFromSignature(sig)   // SHA-256(sig) → X25519

// SDK (sdk/src/crypto.ts)
const keypair = await deriveKeypairFromWallet(wallet)  // identical result`} />
          </div>
        </Card>

        {/* ── Contracts ── */}
        <Card id="contracts">
          <SectionHeader icon={Database} title="Deployed Contracts" subtitle="Celo Sepolia (chain ID 11142220)" />
          <div className="divide-y divide-gray-100">
            <KV
              label="Factory"
              value={FACTORY_ADDRESS}
              mono
              href={`https://celo-sepolia.blockscout.com/address/${FACTORY_ADDRESS}`}
            />
            <KV
              label="Registry"
              value={REGISTRY_ADDRESS}
              mono
              href={`https://celo-sepolia.blockscout.com/address/${REGISTRY_ADDRESS}`}
            />
            <KV label="Network" value="Celo Sepolia (Testnet)" />
            <KV label="RPC" value="https://forno.celo-sepolia.celo-testnet.org" mono />
            <KV label="Explorer" value="https://celo-sepolia.blockscout.com" mono />
          </div>
          <div className="mt-4 space-y-2 text-[12.5px] text-gray-600">
            <p className="font-semibold text-gray-700">Contract hierarchy</p>
            <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 font-mono text-[11.5px] leading-relaxed text-gray-700">
              <p>Web3QLFactory (UUPS proxy)</p>
              <p className="ml-4">└── Web3QLDatabase (UUPS proxy, per user)</p>
              <p className="ml-8">└── Web3QLTable (UUPS proxy, per table)</p>
              <p className="ml-12">└── Web3QLAccess (inherited)</p>
              <p className="mt-2">PublicKeyRegistry (UUPS proxy, global)</p>
            </div>
          </div>
        </Card>

        {/* ── Self-host ── */}
        <Card id="self-deploy">
          <SectionHeader icon={Code2} title="Self-Host / Custom Deployment" subtitle="Deploy your own contracts and point the cloud UI at them" />
          <div className="space-y-4 text-[13px] text-gray-600 leading-relaxed">
            <div>
              <p className="font-semibold text-gray-700 mb-2">1 — Deploy contracts</p>
              <CodeBlock lang="bash" code={`cd protocol
cp .env.example .env          # add PRIVATE_KEY + RPC_URL
pnpm deploy:sepolia           # deploys Factory + impls to Celo Sepolia
# Output: web3ql.config.json updated with new addresses`} />
            </div>
            <div>
              <p className="font-semibold text-gray-700 mb-2">2 — Point the UI at your factory</p>
              <p className="text-[12.5px] text-gray-500 mb-2">
                Either set the env var for a permanent change, or use{' '}
                <strong>Settings → Custom Deployment</strong> in the cloud UI for a per-browser override:
              </p>
              <CodeBlock lang="bash" code={`# cloud/.env.local
NEXT_PUBLIC_FACTORY_ADDRESS=0xYourFactoryAddress`} />
            </div>
            <div>
              <p className="font-semibold text-gray-700 mb-2">3 — Configure relay</p>
              <CodeBlock lang="bash" code={`# cloud/.env.local
RELAY_PRIVATE_KEY=0x...          # wallet that pays gas
RELAY_API_KEY=your-secret-key    # shared secret for /api/connector/relay/*
NEXT_PUBLIC_REGISTRY_ADDRESS=0x... # if you deployed your own registry`} />
            </div>
            <Note variant="warn">
              The relay wallet needs a non-zero CELO balance on Celo Sepolia to pay gas. Get testnet CELO at{' '}
              <a href="https://faucet.celo.org/alfajores" className="underline" target="_blank" rel="noopener noreferrer">faucet.celo.org</a>.
            </Note>
          </div>
        </Card>

        {/* Footer */}
        <div className="flex items-center justify-between py-4 border-t border-gray-100 text-[12px] text-gray-400">
          <span>Web3QL — Celo Sepolia Testnet</span>
          <a
            href="https://github.com/Olisehgenesis/web3ql"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-gray-700 transition-colors"
          >
            GitHub <ExternalLink className="h-3 w-3" />
          </a>
        </div>

      </div>
    </div>
  )
}
