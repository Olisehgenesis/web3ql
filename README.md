# Web3QL

> End-to-end encrypted, on-chain SQL-like storage on Celo.
> No back-end, no indexer — every record is a smart contract slot.

[![Celo Sepolia](https://img.shields.io/badge/network-Celo%20Sepolia-35D07F)](https://celo-sepolia.blockscout.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What is Web3QL?

Web3QL lets you store structured, encrypted data directly on the Celo blockchain. The browser encrypts records with NaCl before they leave your device. A relay wallet handles gas so end-users never need CELO.

**Write flow:** Browser signs derivation message → X25519 keypair → encrypt record (NaCl secretbox) → submit signed intent to relay → relay pays gas → ciphertext + encrypted key written on-chain.

**Read flow:** Fetch ciphertext + encrypted symmetric key from chain → decrypt key with your X25519 private key → decrypt record → plaintext.

## Monorepo structure

```
web3ql/
  protocol/   Solidity contracts (Hardhat + OpenZeppelin UUPS)
  sdk/        TypeScript client SDK (@web3ql/sdk)
  cloud/      Next.js 15 dashboard + relay API
  tests/      Integration tests for relay endpoints
```

## Deployed contracts — Celo Sepolia

| Contract | Address |
|---|---|
| Factory | `0x2cfE616062261927fCcC727333d6dD3D5880FDd1` |
| PublicKeyRegistry | `0x6379ee47C5087e200589Ea4F03141fc85ec53101` |
| Chain ID | `11142220` |
| RPC | `https://forno.celo-sepolia.celo-testnet.org` |

## Quick start

### Cloud dashboard

```bash
cd cloud
cp .env.example .env.local   # add RELAY_PRIVATE_KEY + RELAY_API_KEY
pnpm install && pnpm dev     # http://localhost:3004
```

### SDK

```bash
npm install @web3ql/sdk ethers tweetnacl @noble/hashes
```

```typescript
import { Web3QLClient, EncryptedTableClient, deriveKeypairFromWallet } from '@web3ql/sdk'
import { ethers } from 'ethers'

const wallet  = new ethers.Wallet(process.env.PRIVATE_KEY!, provider)
const keypair = await deriveKeypairFromWallet(wallet)  // browser-compatible

const client = new Web3QLClient('0x2cfE616062261927fCcC727333d6dD3D5880FDd1', wallet)
const db     = await client.createDatabase('my_app')
const table  = await db.createTable('users', '{"name":"string"}')

const enc = new EncryptedTableClient(table.address, wallet, keypair)
await enc.writeString('user_001', JSON.stringify({ name: 'Alice' }))
```

### Deploy your own contracts

```bash
cd protocol
pnpm install
cp .env.example .env   # set PRIVATE_KEY
pnpm deploy:sepolia    # deploys Factory + impls, updates web3ql.config.json
```

Then set `NEXT_PUBLIC_FACTORY_ADDRESS` in `cloud/.env.local`, or use
**Settings → Custom Deployment** in the dashboard.

## Architecture

```
Web3QLFactory (UUPS proxy)
  └── Web3QLDatabase (per user)
        └── Web3QLTable (per table)
              └── Web3QLAccess (OWNER / EDITOR / VIEWER)

PublicKeyRegistry (global — stores X25519 pubkeys for key sharing)
```

## Encryption

- X25519 keypair derived from wallet signature (deterministic, no separate key storage)
- NaCl secretbox (XSalsa20-Poly1305) for record data
- NaCl box (X25519 ECDH) for per-recipient key wrapping
- Same derivation in browser (MetaMask `personal_sign`) and SDK (`deriveKeypairFromWallet`)

## License

MIT
