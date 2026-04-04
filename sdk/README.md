# @web3ql/sdk

TypeScript client SDK for the Web3QL on-chain encrypted database system. End-to-end NaCl encryption — plaintext never touches the chain.

## Install

```bash
npm install @web3ql/sdk ethers tweetnacl @noble/hashes
```

## Quick start

```typescript
import { Web3QLClient, EncryptedTableClient, deriveKeypairFromWallet } from '@web3ql/sdk'
import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider('https://forno.celo-sepolia.celo-testnet.org')
const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY!, provider)

// Derive keypair — same result as browser Explorer
const keypair = await deriveKeypairFromWallet(wallet)

const client = new Web3QLClient('0x2cfE616062261927fCcC727333d6dD3D5880FDd1', wallet)
const db     = await client.createDatabase('my_app')
const table  = await db.createTable('users', '{"name":"string"}')

const enc = new EncryptedTableClient(table.address, wallet, keypair)
await enc.writeString('user_001', JSON.stringify({ name: 'Alice' }))
const plain = await enc.readString('user_001')  // decrypts on read
```

## Key exports

| Export | Description |
|---|---|
| `Web3QLClient` | Top-level: createDatabase(), getUserDatabases() |
| `DatabaseClient` | createTable(), getTable(), listTables() |
| `EncryptedTableClient` | write/read/update/delete + grantAccess() |
| `TypedTableClient` | Prisma-style: create(), findMany(), updateById() |
| `PublicKeyRegistryClient` | register(), getPublicKey(), hasKey() |
| `deriveKeypairFromWallet(signer)` | ✅ Recommended — browser-compatible |
| `deriveKeypair(privKey)` | ⚠️ Deprecated — different keypair from browser |

## Key derivation

```typescript
// Signs 'Web3QL encryption key derivation v1' deterministically
// SHA-256(signature) → X25519 seed → NaCl keypair
// Identical result in browser (MetaMask) and server (ethers Wallet)
const keypair = await deriveKeypairFromWallet(wallet)
```

Always use `deriveKeypairFromWallet` so SDK-written records are readable in the Web3QL Cloud Explorer browser UI.

## Encryption model

- Per-record random 32-byte symmetric key → NaCl secretbox (XSalsa20-Poly1305)
- Symmetric key wrapped per recipient → NaCl box (X25519 ECDH)
- `secretbox blob = [ 24-byte nonce | encrypted(plaintext, symKey) ]`
- `key envelope   = [ 24-byte nonce | box(symKey, myPriv, recipientPub) ]`

## Build

```bash
cd sdk && pnpm install && pnpm build
```
