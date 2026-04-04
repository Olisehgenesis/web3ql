# Web3QL — Known Issues & Bugs

> Audit date: 2026-04-03 | Last updated: 2026-04-04  
> Scope: `protocol/`, `cloud/`, `api/`, `sdk/`

---

## 🔴 Critical

### 1. ~~`totalRecords` never increments — `Web3QLTable.sol`~~ — ✅ RESOLVED

**File:** `protocol/contracts/Web3QLTable.sol`

Fixed by capturing `bool isNew = (rec.owner == address(0))` **before** assigning `rec.owner = msg.sender`, then using `if (isNew) totalRecords++`. Redeployed 2026-04-04.

---

### 2. ~~Private keys transmitted in HTTP request body~~ — ✅ RESOLVED

**File:** `api/connector.js` — fixed in rewrite.

All write endpoints now use a **prepare → sign (client-side) → broadcast** model:
- `POST /tx-intent/<action>` returns an unsigned transaction to the client
- Client signs locally (private key never leaves the client)
- `POST /broadcast` relays the pre-signed tx via `eth_sendRawTransaction`

---

### 3. ~~Encryption scheme fragmentation — connector vs SDK incompatible~~ — ✅ RESOLVED

**Files:** `sdk/keyManager.js`, `sdk/src/crypto.ts`

`sdk/keyManager.js` was fully rewritten to use **NaCl X25519/XSalsa20-Poly1305** — identical to `sdk/src/crypto.ts`. Both layers now share the same wire format:
- Record blob: `0x` + hex(`[ nonce(24B) | ciphertext+MAC ]`)
- Wrapped key: `0x` + hex(`[ nonce(24B) | encrypted_key+MAC(48B) ]`) = 72 bytes

All 46 unit tests pass (`npm test`).

---

### 4. ~~Wrong default RPC — Alfajores instead of Celo Sepolia~~ — ✅ RESOLVED

All three files (`api/connector.js`, `sdk/walletUtils.js`, `sdk/keyManager.js`) now use `https://forno.celo-sepolia.celo-testnet.org` (chainId 11142220) as default, overridable via `CELO_RPC_URL` env var.

---

### 5. ~~Record key derivation mismatch — connector vs SDK~~ — ✅ RESOLVED

**File:** `api/connector.js`

All layers now use a single canonical derivation:
```
recordKey = solidityPackedKeccak256(['string', 'uint256'], [tableName, id])
```
Matches `sdk/src/table-client.ts` and the Solidity compiler. `tableName` is required on all write/update/delete/grant/revoke API calls.

---

## 🟡 Protocol Design Concerns

### 6. "Delete" does not erase archive node history

**File:** `protocol/contracts/Web3QLTable.sol` — `deleteRecord()`

`deleteRecord()` overwrites *current on-chain state* of `_encryptedKeys` with garbage derived from `block.prevrandao`. However, blockchain state history is immutable — any archive node can replay to the pre-deletion block and read the original encrypted key values.

**Impact:** Forward secrecy is not achieved. A compromised archived node exposes previously-authorised keys.

**Recommendation:** Document this as a known limitation. For sensitive data, do per-record key rotation before deletion. Blockchain storage is not GDPR/right-to-be-forgotten compliant.

---

### 7. `block.prevrandao` as entropy for key scrubbing is semi-predictable

**File:** `protocol/contracts/Web3QLTable.sol` — `deleteRecord()`, `revokeAccess()`

Celo uses PBFT/PoS consensus where validators influence `prevrandao`. The scrubbed "garbage" key is deterministic from public block data. The original key is gone, but the replacement is not secret.

**Recommendation:** Acceptable for this use case — document it. Do not rely on `prevrandao` for any forward-secrecy guarantee.

---

### 8. No upgrade timelock on UUPS contracts

**Files:** `protocol/contracts/Web3QLFactory.sol`, `Web3QLDatabase.sol`, `Web3QLTable.sol`, `PublicKeyRegistry.sol`

All contracts allow the owner to silently upgrade with no delay, no governance, no user notification.

**Recommendation:** Add a `TimelockController` (OpenZeppelin) of 48–72 hours. Emit an `UpgradeScheduled` event so users can exit before the upgrade takes effect.

---

## 🟠 Minor

### 9. Schema parser restricts PRIMARY KEY to `INT` only

**File:** `protocol/compiler/parser.ts`

Wallet addresses (`ADDRESS`) and text slugs (`TEXT`) cannot be used as primary keys.

**Fix (future):** Allow `INT` and `ADDRESS` as valid PK types in v1. `TEXT` PKs can be added in v2.

---

### 10. ~~`getUncompressedPublicKey()` broken dead code~~ — ✅ RESOLVED (by deletion)

`api/connector.js` was rewritten; the broken non-async helper no longer exists.

---

### 11. ~~Symmetric encryption key returned in API response body~~ — ✅ RESOLVED

The server never performs or touches encryption. All crypto is client-side only.

---

### 12. `findMany()` cannot recover primary key from `bytes32`

**File:** `sdk/src/typed-table.ts`

`listOwnerRecords()` returns `bytes32` record keys (keccak256 hashes). The original `uint256` primary key cannot be reverse-derived from the hash. `RecordWithId.id` is always `0n` when using `findMany()`.

**Workaround:** Store the primary key as a field inside your data payload (e.g. `{ id: 1n, ...fields }`) and read it from `record.data.id`.

---

## Summary Table

| # | Severity | Location | Issue |
|---|---|---|---|
| 1 | ✅ Fixed | `Web3QLTable.sol` | `totalRecords` never incremented — fixed + redeployed |
| 2 | ✅ Fixed | `connector.js` | Private keys in HTTP request body |
| 3 | ✅ Fixed | `keyManager.js` | AES-GCM vs NaCl — unified to NaCl X25519 |
| 4 | ✅ Fixed | `walletUtils.js` / `keyManager.js` | Wrong default RPC (Alfajores → Celo Sepolia) |
| 5 | ✅ Fixed | `connector.js` / SDK | Record key derivation mismatch — unified |
| 6 | 🟡 Design | `Web3QLTable.sol` | Delete doesn't erase archive node history |
| 7 | 🟡 Crypto | `Web3QLTable.sol` | `prevrandao` entropy is semi-predictable |
| 8 | 🟡 Trust | All contracts | No upgrade timelock |
| 9 | 🟠 UX | `parser.ts` | INT-only primary keys |
| 10 | ✅ Fixed | `connector.js` | Broken non-async helper function — removed |
| 11 | ✅ Fixed | `connector.js` | Symmetric key leak in API response |
| 12 | 🟠 Design | `typed-table.ts` | `findMany` `id` field always `0n` — by design limitation |

---

## Deployment (2026-04-04) — Celo Sepolia

| Contract | Address |
|---|---|
| Web3QLFactory proxy | `0x2cfE616062261927fCcC727333d6dD3D5880FDd1` |
| Web3QLDatabase impl | `0x54d136CcdD9E9865803280ca6254D10130a3495b` |
| Web3QLTable impl | `0xd14deBb23004b93d731E00C320C389D9A4B933c6` |
| PublicKeyRegistry proxy | `0x6379ee47C5087e200589Ea4F03141fc85ec53101` |


---

## 🔴 Critical

### 1. `totalRecords` never increments — `Web3QLTable.sol`

**File:** `protocol/contracts/Web3QLTable.sol`

`rec.owner` is assigned to `msg.sender` **before** the `if (rec.owner == address(0))` guard, so that condition is always `false`. `totalRecords` remains permanently 0.

```solidity
// BUG — owner is already set when this evaluates
rec.owner = msg.sender;
...
if (rec.owner == address(0)) { // always false
    totalRecords++;
}
```

**Fix:** capture `bool isNew = (rec.owner == address(0))` before overwriting the field, then use `if (isNew) totalRecords++`.

---

### 2. ~~Private keys transmitted in HTTP request body~~ — ✅ RESOLVED

**File:** `api/connector.js` — fixed in rewrite.

All write endpoints now use a **prepare → sign (client-side) → broadcast** model:
- `POST /tx-intent/<action>` returns an unsigned transaction to the client
- Client signs locally (private key never leaves the client)
- `POST /broadcast` relays the pre-signed tx via `eth_sendRawTransaction`

Read endpoints use `eth_call` with `from=walletAddress` — only a public address is required.

**5 Solution Options (for reference):**

| # | Approach | How it works | Trust model | Complexity |
|---|---|---|---|---|
| **A** | **Client-side signing (best)** | Client signs a Web3QL-specific payload with their wallet (e.g. MetaMask `eth_signTypedData`). Server receives signature + message only — never the key. Server verifies the signature on-chain or off-chain to authenticate. | Fully non-custodial | Medium |
| **B** | **Session-based key derivation** | Client performs ECDH once at session start to establish a shared session secret with the server's ephemeral keypair. Private key stays on the client; all subsequent requests use the session token for auth. | Semi-custodial (session only) | Medium |
| **C** | **Move signing entirely to client (SDK-only model)** | Remove the connector API entirely. All writes are signed and broadcast directly from the browser/client app using `wagmi` / `viem` or the TypeScript SDK. Server becomes read-only or is removed. | Fully non-custodial | Low (for new flows) |
| **D** | **Hardware-encrypted key vault (server-side)** | Accept client public key at registration. Client encrypts their private key with the server's RSA/ECDH public key before sending. Server decrypts in a TEE (AWS Nitro, Azure Confidential) or HSM. Key never hits disk or logs. | Custodial but auditable | High |
| **E** | **Bearer token + delegated signer** | Issue the user a time-limited ERC-4337 `UserOperation` session key (a temporary sub-key with narrow permissions). User signs and sends this session key — not their master wallet key — which expires after N minutes/blocks. | Non-custodial (scoped) | High |

**Recommended path:** Option **A** short-term (client-side signing) + Option **C** long-term (remove connector for write operations, use SDK directly).

---

### 3. Encryption scheme fragmentation — connector vs SDK incompatible

**Files:** `api/keyManager.js`, `sdk/src/crypto.ts`

| Layer | Cipher scheme |
|---|---|
| `keyManager.js` (API connector) | ECDH secp256k1 + AES-256-GCM |
| `sdk/src/crypto.ts` | X25519 + NaCl secretbox (XSalsa20-Poly1305) |

Records written via the connector cannot be decrypted by the SDK and vice versa — they share the same on-chain slots but use different wire formats. **Decrypt will silently return garbage.**

**Fix:** Pick one canonical scheme and re-implement the other to match. NaCl (X25519/XSalsa20) is the stronger recommendation — audited, side-channel resistant, widely supported.

---

### 4. ~~Wrong default RPC — Alfajores instead of Celo Sepolia~~ — ✅ RESOLVED

**Files:** `sdk/walletUtils.js:18`, `sdk/keyManager.js:30`

Fixed in `api/connector.js` — the connector now defaults to `https://forno.celo.org` and reads from `CELO_RPC_URL` env var.

> Fixed in `sdk/walletUtils.js` and `sdk/keyManager.js` as well — all three files now use `https://forno.celo-sepolia.celo-testnet.org` (chainId 11142220).

---

### 5. Record key derivation mismatch — connector vs SDK

**File:** `api/connector.js:92`

- **Connector:** `keccak256(abi.encodePacked(tableAddress, recordId))`
- **SDK:** `keccak256(abi.encode(['string','uint256'], [tableName, id]))`

These produce different `bytes32` keys for the same logical record. Records written by one layer are invisible to the other. The connector comment acknowledges this but doesn't resolve it.

**Fix:** Standardise on one derivation scheme across all layers. The SDK's `abi.encode` form (with table name) is safer as it includes the table as a namespace, preventing cross-table key collisions.

---

## 🟡 Protocol Design Concerns

### 6. "Delete" does not erase archive node history

**File:** `protocol/contracts/Web3QLTable.sol` — `deleteRecord()`

`deleteRecord()` overwrites *current on-chain state* of `_encryptedKeys` with garbage derived from `block.prevrandao`. However, blockchain state history is immutable — any archive node can replay to the pre-deletion block and read the original encrypted key values.

**Impact:** Forward secrecy is not achieved. A compromised archived node exposes previously-authorised keys.

**Recommendation:** Document this prominently as a known limitation. For truly sensitive data, consider per-record re-encryption with key rotation before deletion, or accept that blockchain storage is not GDPR/right-to-be-forgotten compliant.

---

### 7. `block.prevrandao` as entropy for key scrubbing is semi-predictable

**File:** `protocol/contracts/Web3QLTable.sol` — `deleteRecord()`, `revokeAccess()`

Celo uses PBFT/PoS consensus where validators influence `prevrandao`. The scrubbed "garbage" key is deterministic from public block data. While this doesn't expose the *original* key, it means the scrubbed value can be independently computed by anyone.

**Recommendation:** Acceptable for this use case (you're destroying the real key, not hiding the replacement), but document it. Do not rely on `prevrandao` for any security property other than "the original value is gone."

---

### 8. No upgrade timelock on UUPS contracts

**Files:** `protocol/contracts/Web3QLFactory.sol`, `Web3QLDatabase.sol`, `Web3QLTable.sol`

All contracts allow the owner to silently upgrade the implementation with no delay, no governance, and no user notification. For a system marketing itself as a trustless database, this is a meaningful centralisation risk.

**Recommendation:** Add a `TimelockController` (OpenZeppelin) of 48–72 hours minimum. Emit an `UpgradeScheduled` event so users can exit before the upgrade takes effect.

---

## 🟠 Minor

### 9. Schema parser restricts PRIMARY KEY to `INT` only

**File:** `protocol/compiler/parser.ts:90`

Wallet addresses (`ADDRESS`) and text slugs (`TEXT`) cannot be used as primary keys. This forces all records to use an integer PK even when the natural key is an address.

**Fix:** Allow `INT` and `ADDRESS` as valid PK types in v1. `TEXT` PKs add variable-length concerns but could be added in v2.

---

### 10. `getUncompressedPublicKey()` is broken dead code

**File:** `api/connector.js:127`

The function uses `await import(...)` inside a **non-async** function — a runtime syntax error. It is never called (the write endpoint inlines the ECDH logic directly), but it will crash immediately if invoked.

**Fix:** Either make the function `async` and use it consistently, or delete it.

---

### 11. ~~Symmetric encryption key returned in API response body~~ — ✅ RESOLVED

**File:** `api/connector.js` — fixed in rewrite.

The server no longer performs any encryption. The client generates and manages the symmetric key locally, encrypts data before calling `/tx-intent/write`, and only transmits the already-encrypted `ciphertext` and `encryptedKey` blobs. No plaintext keys appear anywhere in the server request/response cycle.

---

## Summary Table

| # | Severity | Location | Issue |
|---|---|---|---|
| 1 | 🔴 Bug | `Web3QLTable.sol` | `totalRecords` never increments |
| 2 | ✅ Fixed | `connector.js` | Private keys in HTTP request body |
| 3 | 🔴 Compat | `keyManager.js` / `crypto.ts` | AES-GCM vs NaCl — cross-layer decryption fails |
| 4 | ✅ Fixed (connector) | `walletUtils.js` / `keyManager.js` | Wrong default RPC (Alfajores vs Celo Sepolia) |
| 5 | 🔴 Compat | `connector.js` / SDK | Record key derivation mismatch |
| 6 | 🟡 Design | `Web3QLTable.sol` | Delete doesn't erase archive node history |
| 7 | 🟡 Crypto | `Web3QLTable.sol` | `prevrandao` entropy is semi-predictable |
| 8 | 🟡 Trust | All contracts | No upgrade timelock |
| 9 | 🟠 UX | `parser.ts` | INT-only primary keys |
| 10 | 🟠 Code | `connector.js` | Broken non-async helper function |
| 11 | ✅ Fixed | `connector.js` | Symmetric key leaks in API response |
