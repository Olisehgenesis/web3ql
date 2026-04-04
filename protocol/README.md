# Web3QL — Protocol

Solidity smart contracts for the Web3QL on-chain encrypted database system, built with Hardhat and OpenZeppelin UUPS upgradeable proxies.

## Contracts

| Contract | Role |
|---|---|
| `Web3QLFactory` | Deploys + tracks Database proxies per user |
| `Web3QLDatabase` | Owns tables; deploys Table proxies |
| `Web3QLTable` | Stores encrypted records on-chain |
| `Web3QLAccess` | Role-based access (OWNER/EDITOR/VIEWER) inherited by Table |
| `PublicKeyRegistry` | Global on-chain map of address → X25519 public key |

## Deployed — Celo Sepolia

| Contract | Address |
|---|---|
| Factory | `0x2cfE616062261927fCcC727333d6dD3D5880FDd1` |
| PublicKeyRegistry | `0x6379ee47C5087e200589Ea4F03141fc85ec53101` |

See `web3ql.config.json` for full deployment history.

## Setup

```bash
cd protocol
pnpm install
cp .env.example .env   # set PRIVATE_KEY
```

## Scripts

```bash
pnpm compile           # Compile all contracts
pnpm test              # Run Hardhat tests
pnpm deploy:sepolia    # Deploy Factory + impls to Celo Sepolia
pnpm deploy:cloud      # Deploy shared Cloud Database + Registry
pnpm typechain         # Regenerate TypeChain types
```

## Architecture

```
Web3QLFactory (UUPS proxy, global)
  └── Web3QLDatabase (UUPS proxy, one per user)
        └── Web3QLTable (UUPS proxy, one per table)
              └── Web3QLAccess (OWNER / EDITOR / VIEWER roles)

PublicKeyRegistry (UUPS proxy, global)
  └── address → bytes32 X25519 public key
```

### Record storage model

Each `Web3QLTable.write(key, ciphertext, encryptedKey)` stores:

- `ciphertext` — NaCl secretbox blob (plaintext encrypted with a random symmetric key)
- `encryptedKey` — symmetric key box-encrypted for the relay wallet
- `_ownerKeys[msg.sender]` appended, enabling `getOwnerRecords()`
- `_access[key][user]` — EDITOR role granted via `grantAccess()` after write
- Emits `AccessGranted(key, user, role)` for off-chain event scanning
