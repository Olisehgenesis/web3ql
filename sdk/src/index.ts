/**
 * @web3ql/sdk — Public API
 *
 * ─────────────────────────────────────────────────────────────
 *  import {
 *    Web3QLClient,          // top-level entry point
 *    DatabaseClient,        // per-user database
 *    EncryptedTableClient,  // per-table encrypted storage
 *    PublicKeyRegistryClient,
 *    deriveKeypair,         // keypair from Ethereum private key
 *    Role,
 *  } from '@web3ql/sdk';
 * ─────────────────────────────────────────────────────────────
 */

// Core clients
export { Web3QLClient, DatabaseClient }       from './factory-client.js';
export { EncryptedTableClient, Role }         from './table-client.js';
export type { RawRecord }                     from './table-client.js';
export { PublicKeyRegistryClient }            from './registry.js';

// High-level typed API (Prisma-style)
export { TypedTableClient }                   from './typed-table.js';
export type { FindManyOptions, RecordWithId } from './typed-table.js';

// Crypto primitives (available for advanced use)
export {
  KEY_DERIVATION_MESSAGE,
  deriveKeypairFromWallet,  // ✅ browser-compatible (recommended)
  deriveKeypair,            // ⚠️  deprecated: different keypair from browser
  publicKeyFromPrivate,
  generateSymmetricKey,
  encryptData,
  decryptData,
  encryptKeyForSelf,
  encryptKeyForRecipient,
  decryptKeyForSelf,
  decryptKeyFromSender,
  publicKeyToHex,
  hexToPublicKey,
}                                             from './crypto.js';
export type { EncryptionKeypair }             from './crypto.js';
