/**
 * @file   typed-table.ts
 * @notice High-level Prisma-style API for Web3QL encrypted tables.
 *
 * TypedTableClient wraps EncryptedTableClient and adds:
 *   • Auto serialize/deserialize — no manual JSON.stringify/parse
 *   • Typed generics — IDE autocompletion for your schema fields
 *   • findUnique, findMany, create, update, remove — Prisma-familiar names
 *   • findMany supports pagination over owner's records
 *
 * Usage:
 * ─────────────────────────────────────────────────────────────
 *   import { Web3QLClient, TypedTableClient, deriveKeypair } from '@web3ql/sdk'
 *   import { ethers } from 'ethers'
 *
 *   const signer  = new ethers.Wallet(process.env.PRIVATE_KEY, provider)
 *   const keypair = deriveKeypair(process.env.PRIVATE_KEY)
 *
 *   const db    = (new Web3QLClient(FACTORY, signer, keypair, REGISTRY)).database('0xDB')
 *   const users = new TypedTableClient<{ id: bigint; name: string; email: string }>(
 *     'users',
 *     db.table('0xTABLE_ADDRESS'),
 *   )
 *
 *   // Create (encrypts automatically)
 *   await users.create(1n, { id: 1n, name: 'Alice', email: 'alice@example.com' })
 *
 *   // Read (decrypts automatically)
 *   const alice = await users.findUnique(1n)
 *
 *   // List all records the current wallet owns (paginated, decrypts each)
 *   const all = await users.findMany(await signer.getAddress())
 *
 *   // Update
 *   await users.update(1n, { name: 'Alice Smith' })
 *
 *   // Delete
 *   await users.remove(1n)
 * ─────────────────────────────────────────────────────────────
 */

import { ethers }                from 'ethers';
import type { EncryptedTableClient } from './table-client.js';

export interface FindManyOptions {
  /** Starting index into the owner's record list (default: 0). */
  offset?: bigint;
  /** Maximum number of records to return (default: 50). */
  limit?: bigint;
}

export interface RecordWithId<T> {
  /**
   * The uint256 primary key cannot be recovered from the on-chain bytes32 key alone
   * (it is a keccak256 hash). This field is always `0n` when records are fetched via
   * `findMany()`. The actual primary key should be stored inside your data payload and
   * read from `data` directly (e.g. `record.data.id`).
   */
  id       : bigint;
  /** Decrypted, typed record data. */
  data     : T;
  /** bytes32 on-chain key (hex string). */
  recordKey: string;
}

export class TypedTableClient<T extends Record<string, unknown>> {
  private tableName : string;
  private inner     : EncryptedTableClient;

  /**
   * @param tableName  Must match the name used in the SQL schema and createTable().
   * @param inner      An EncryptedTableClient from DatabaseClient.table(address).
   */
  constructor(tableName: string, inner: EncryptedTableClient) {
    this.tableName = tableName;
    this.inner     = inner;
  }

  // ── Key helper ─────────────────────────────────────────────

  /** Derive the canonical bytes32 on-chain key for a given primary key id. */
  key(id: bigint): string {
    return this.inner.deriveKey(this.tableName, id);
  }

  // ── Write ───────────────────────────────────────────────────

  /**
   * Encrypt and store a new record.
   * Throws if a non-deleted record with the same id already exists.
   *
   * @param id    Numeric primary key (must match the INT PRIMARY KEY column).
   * @param data  Plain object to encrypt and store.
   */
  async create(id: bigint, data: T): Promise<ethers.TransactionReceipt> {
    return this.inner.writeRaw(this.key(id), JSON.stringify(data));
  }

  // ── Read ────────────────────────────────────────────────────

  /**
   * Read and decrypt a single record by primary key.
   * Returns `null` if the record does not exist or has been deleted.
   * Throws if the caller has no access key for this record.
   */
  async findUnique(id: bigint): Promise<T | null> {
    try {
      const exists = await this.inner.exists(this.key(id));
      if (!exists) return null;
      const plaintext = await this.inner.readPlaintext(this.key(id));
      return JSON.parse(plaintext) as T;
    } catch (err: unknown) {
      const msg = (err as Error).message ?? '';
      // Record deleted or not found — return null instead of throwing
      if (msg.includes('deleted') || msg.includes('not found') || msg.includes('RecordMeta')) {
        return null;
      }
      throw err;
    }
  }

  /**
   * List and decrypt all records owned by `ownerAddress`.
   *
   * ⚠  All records are decrypted client-side one by one — use `limit` to bound
   *    the number of chain calls, especially on large tables.
   *
   * @param ownerAddress  Wallet address whose records to fetch.
   * @param options       Pagination options (offset, limit).
   */
  async findMany(
    ownerAddress : string,
    options      : FindManyOptions = {},
  ): Promise<RecordWithId<T>[]> {
    const offset = options.offset ?? 0n;
    const limit  = options.limit  ?? 50n;

    const keys: string[] = await this.inner.listOwnerRecords(ownerAddress, offset, limit);
    const results: RecordWithId<T>[] = [];

    for (const recordKey of keys) {
      try {
        // readPlaintext internally calls readRaw + getMyEncryptedKey (2 RPCs).
        // If the record is deleted, readRaw throws and the catch block skips it.
        const plaintext = await this.inner.readPlaintext(recordKey);
        const data = JSON.parse(plaintext) as T;

        // id cannot be recovered from the bytes32 key — store 0n as sentinel.
        // Read the primary key from data directly (e.g. record.data.id).
        results.push({ id: 0n, data, recordKey });
      } catch {
        // Skip records we can't decrypt (no access or deleted)
        continue;
      }
    }

    return results;
  }

  // ── Update ──────────────────────────────────────────────────

  /**
   * Fetch existing data, merge with `patch`, re-encrypt, and update on-chain.
   * Rotates the symmetric key — existing collaborators must be re-shared after this.
   *
   * @param id     Primary key of the record to update.
   * @param patch  Partial object — merged over the current decrypted data.
   */
  async update(id: bigint, patch: Partial<T>): Promise<ethers.TransactionReceipt> {
    const current = await this.findUnique(id);
    if (current === null) throw new Error(`TypedTableClient.update: record ${id} not found`);
    const merged = { ...current, ...patch };
    return this.inner.updateRaw(this.key(id), JSON.stringify(merged));
  }

  /**
   * Replace a record's data entirely (no merge with existing data).
   * More gas-efficient than update() when you have the full new payload ready.
   */
  async replace(id: bigint, data: T): Promise<ethers.TransactionReceipt> {
    return this.inner.updateRaw(this.key(id), JSON.stringify(data));
  }

  // ── Delete ──────────────────────────────────────────────────

  /**
   * Soft-delete a record.
   * The symmetric key copies for ALL collaborators are scrubbed on-chain.
   * The ciphertext remains but is permanently unreadable.
   * Only the record owner can call this.
   */
  async remove(id: bigint): Promise<ethers.TransactionReceipt> {
    return this.inner.deleteRecord(this.key(id));
  }

  // ── Count ───────────────────────────────────────────────────

  /**
   * Total number of records (including deleted ones) ever written by `ownerAddress`.
   */
  async count(ownerAddress: string): Promise<bigint> {
    return this.inner.ownerRecordCount(ownerAddress);
  }

  // ── Existence ───────────────────────────────────────────────

  /** True if a live (non-deleted) record exists for the given id. */
  async exists(id: bigint): Promise<boolean> {
    return this.inner.exists(this.key(id));
  }
}
