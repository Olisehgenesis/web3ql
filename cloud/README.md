# Web3QL — Cloud Dashboard

Next.js 15 front-end and relay API for the Web3QL protocol. All chain reads go directly to Celo Sepolia via wagmi/viem — no indexer, no server DB.

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 15 (App Router) |
| Chain reads | wagmi v3 + viem |
| Encryption | NaCl secretbox + X25519 (tweetnacl) |
| Relay (gas) | Ethers v6 server-side wallet |
| Styling | Tailwind CSS v4 |
| State | Zustand (persisted) |

## Environment variables

Create `cloud/.env.local`:

```env
NEXT_PUBLIC_PROJECT_ID=your_reown_project_id
RELAY_PRIVATE_KEY=0x...
RELAY_API_KEY=your_secret_key
NEXT_PUBLIC_FACTORY_ADDRESS=0x2cfE616062261927fCcC727333d6dD3D5880FDd1
NEXT_PUBLIC_REGISTRY_ADDRESS=0x6379ee47C5087e200589Ea4F03141fc85ec53101
```

## Running locally

```bash
cd cloud
pnpm install
pnpm dev          # http://localhost:3004
```

## Key directories

```
app/(dashboard)/
  databases/    List + create on-chain databases
  tables/       Table browser
  test/         Explorer — browse records, encrypt/decrypt, write
  docs/         Developer documentation page
  integrations/ Register wallets with relay, set resource scope
  settings/     Network info + custom factory address
app/api/connector/relay/[action]/  Relay endpoints
lib/browser-crypto.ts              Signature-derived X25519 + NaCl
lib/contracts.ts                   ABIs + addresses
store/index.ts                     Zustand (activeDatabase, customFactoryAddress)
```

## Custom factory

Go to **Settings → Custom Deployment** to point the entire dashboard at your own deployed factory.
