/**
 * @file   public-table-client.ts
 * @notice SDK client for Web3QLPublicTable contracts.
 *
 * Public tables store plaintext (no encryption). Key properties:
 *   • Anyone can write by default (restrictedWrites = false).
 *   • The writer becomes record owner — can update/delete their own record.
 *   • The table admin (contract owner) has override on ALL records.
 *   • EDITOR role can be granted per-record (update-only, no delete).
 *   • All data and metadata are fully visible on-chain.
 *   • On-chain schema validation: contract rejects writes missing required fields.
 *   • Client-side validation runs first for cleaner error messages.
 *
 * Usage:
 * ─────────────────────────────────────────────────────────────
 *   const client = new PublicTableClient(tableAddress, signer);
 *
 *   // Write (anyone, open table)
 *   await client.write(1n, { id: 1n, name: 'Alice', score: 100n });
 *
 *   // Read — returns plaintext directly
 *   const { data } = await client.readJSON<{ name: string }>(1n);
 *   console.log(data.name); // 'Alice'
 *
 *   // Update (record owner or table admin)
 *   await client.update(1n, { id: 1n, name: 'Alice', score: 200n });
 *
 *   // Delete (record owner or table admin)
 *   await client.deleteRecord(1n);
 *
 *   // Grant editor role to Bob on record 1
 *   await client.grantEditor(1n, bobAddress);
 * ─────────────────────────────────────────────────────────────
 */

import { ethers } from 'ethers';
import type { SchemaDefinition, FieldDescriptor } from './types.js';

// ─────────────────────────────────────────────────────────────
//  ABI — Web3QLPublicTable
// ─────────────────────────────────────────────────────────────

const PUBLIC_TABLE_ABI = [
  // Write
  'function write(bytes32 key, bytes32[] calldata fieldKeys, bytes calldata data) external',
  // Read (unrestricted)
  'function read(bytes32 key) external view returns (bytes memory data, bool deleted, uint32 version, uint48 updatedAt, address owner)',
  // Update
  'function update(bytes32 key, bytes32[] calldata fieldKeys, bytes calldata data, uint32 expectedVersion) external',
  // Delete
  'function deleteRecord(bytes32 key) external',
  // Per-record access control
  'function grantEditor(bytes32 key, address user) external',
  'function revokeEditor(bytes32 key, address user) external',
  'function getRole(bytes32 resource, address user) external view returns (uint8)',
  // Record views
  'function recordExists(bytes32 key) external view returns (bool)',
  'function recordOwner(bytes32 key) external view returns (address)',
  'function ownerRecordCount(address addr) external view returns (uint256)',
  'function getOwnerRecords(address addr, uint256 start, uint256 limit) external view returns (bytes32[] memory)',
  'function getActiveOwnerRecords(address addr, uint256 start, uint256 limit) external view returns (bytes32[] memory)',
  // Table metadata
  'function tableName() external view returns (string memory)',
  'function schemaBytes() external view returns (bytes memory)',
  'function schemaVersion() external view returns (uint32)',
  'function requiredFieldHashes() external view returns (bytes32[] memory)',
  'function totalRecords() external view returns (uint128)',
  'function activeRecords() external view returns (uint128)',
  // Write-access management (table admin only)
  'function restrictedWrites() external view returns (bool)',
  'function tableWriters(address writer) external view returns (bool)',
  'function addTableWriter(address writer) external',
  'function removeTableWriter(address writer) external',
  'function setRestrictedWrites(bool restricted) external',
  'function updateSchema(bytes calldata newSchemaBytes) external',
  // Counters
  'function counterValue(bytes32 targetKey, bytes32 field) external view returns (uint256)',
] as const;

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

export interface PublicRawRecord {
  data      : Uint8Array;
  deleted   : boolean;
  version   : number;   // uint32 on-chain
  updatedAt : number;   // uint48 unix seconds
  owner     : string;
}

export interface PublicRecordResult<T> {
  data      : T;
  version   : number;
  updatedAt : number;
  owner     : string;
  key       : string;
}

export interface PublicFindManyOptions {
  /** Starting index in the owner's record list on-chain. Default: 0 */
  chainOffset?  : bigint;
  /** Max records to fetch per page. Default: 200 */
  chainLimit?   : bigint;
  /** Whether to skip soft-deleted records (uses getActiveOwnerRecords). Default: true */
  activeOnly?   : boolean;
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Compute the bytes32 record key matching the contract derivation:
 *   keccak256(abi.encodePacked(tableName, id))
 */
export function derivePublicKey(tableName: string, id: bigint): string {
  return ethers.solidityPackedKeccak256(['string', 'uint256'], [tableName, id]);
}

/**
 * Compute fieldKeys for a data object.
 * fieldKeys[i] = keccak256(utf8(fieldName)) for each key in `data`.
 * Matches the contract's _requiredFieldHashes computation.
 */
export function computeFieldKeys(data: Record<string, unknown>): string[] {
  return Object.keys(data).map((name) =>
    ethers.keccak256(ethers.toUtf8Bytes(name)),
  );
}

/**
 * Client-side required-field validation against a schema.
 * Runs before the transaction is sent, giving cleaner error messages
 * than an on-chain revert.
 */
export function validatePublicRecord(
  data  : Record<string, unknown>,
  schema: SchemaDefinition,
): void {
  const errors: string[] = [];
  for (const field of schema) {
    const val = data[field.name];
    if (field.notNull && !field.primaryKey && (val === null || val === undefined)) {
      errors.push(`required field '${field.name}' is missing`);
    }
  }
  if (errors.length > 0) {
    throw new PublicTableValidationError(errors);
  }
}

export class PublicTableValidationError extends Error {
  constructor(public readonly violations: string[]) {
    super(`PublicTable validation failed: ${violations.join('; ')}`);
    this.name = 'PublicTableValidationError';
  }
}

// ─────────────────────────────────────────────────────────────
//  PublicTableClient
// ─────────────────────────────────────────────────────────────

export class PublicTableClient {
  readonly tableAddress: string;
  protected contract  : ethers.Contract;
  protected signer    : ethers.Signer;

  /** Optional schema for client-side validation before writes. */
  private schema: SchemaDefinition | undefined;

  /** Cached table name (lazy-loaded). */
  private _tableName: string | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get c(): any { return this.contract; }

  constructor(
    tableAddress : string,
    signer       : ethers.Signer,
    schema?      : SchemaDefinition,
  ) {
    this.tableAddress = tableAddress;
    this.signer       = signer;
    this.schema       = schema;
    this.contract     = new ethers.Contract(tableAddress, PUBLIC_TABLE_ABI, signer);
  }

  // ── Key derivation ─────────────────────────────────────────

  async deriveKey(id: bigint): Promise<string> {
    const name = await this.getTableName();
    return derivePublicKey(name, id);
  }

  deriveKeySync(tableName: string, id: bigint): string {
    return derivePublicKey(tableName, id);
  }

  async getTableName(): Promise<string> {
    if (!this._tableName) {
      this._tableName = await this.c.tableName() as string;
    }
    return this._tableName;
  }

  // ── Write ──────────────────────────────────────────────────

  /**
   * Write a new record by primary-key id.
   * Derives the bytes32 key automatically from (tableName, id).
   * Runs client-side schema validation if a schema was provided.
   *
   * @param id    The primary key value (uint256 as bigint).
   * @param data  Plaintext data object.
   */
  async write(
    id   : bigint,
    data : Record<string, unknown>,
  ): Promise<ethers.TransactionReceipt> {
    const key = await this.deriveKey(id);
    return this.writeRaw(key, data);
  }

  /**
   * Write a record using a pre-computed bytes32 key.
   * Use this when you control key derivation externally.
   */
  async writeRaw(
    key  : string,
    data : Record<string, unknown>,
  ): Promise<ethers.TransactionReceipt> {
    if (this.schema) validatePublicRecord(data, this.schema);

    const fieldKeys = computeFieldKeys(data);
    const payload   = new TextEncoder().encode(JSON.stringify(data));

    const tx = await this.c.write(key, fieldKeys, payload);
    return tx.wait();
  }

  // ── Read ───────────────────────────────────────────────────

  /**
   * Read and parse a record as JSON.
   * Returns the typed data object plus metadata.
   */
  async readJSON<T = Record<string, unknown>>(
    id: bigint,
  ): Promise<PublicRecordResult<T>> {
    const key = await this.deriveKey(id);
    return this.readJSONRaw<T>(key);
  }

  /**
   * Read and parse by pre-computed bytes32 key.
   */
  async readJSONRaw<T = Record<string, unknown>>(
    key: string,
  ): Promise<PublicRecordResult<T>> {
    const raw  = await this.readRaw(key);
    if (raw.deleted) throw new Error(`Web3QLPublicTable: record ${key} is deleted`);
    const data = JSON.parse(new TextDecoder().decode(raw.data)) as T;
    return { data, version: raw.version, updatedAt: raw.updatedAt, owner: raw.owner, key };
  }

  /**
   * Read raw bytes for the record — no JSON parsing.
   */
  async readText(id: bigint): Promise<string> {
    const key = await this.deriveKey(id);
    const raw = await this.readRaw(key);
    if (raw.deleted) throw new Error(`Web3QLPublicTable: record deleted`);
    return new TextDecoder().decode(raw.data);
  }

  /**
   * Fetch raw on-chain record — still-encoded bytes + metadata.
   */
  async readRaw(key: string): Promise<PublicRawRecord> {
    const [data, deleted, version, updatedAt, owner] = await this.c.read(key);
    return {
      data     : ethers.getBytes(data as string),
      deleted  : deleted as boolean,
      version  : Number(version),
      updatedAt: Number(updatedAt),
      owner    : owner as string,
    };
  }

  // ── Update ─────────────────────────────────────────────────

  /**
   * Overwrite an existing record by id.
   * Pass `expectedVersion` to enable optimistic locking (0 = skip check).
   */
  async update(
    id              : bigint,
    data            : Record<string, unknown>,
    expectedVersion : number = 0,
  ): Promise<ethers.TransactionReceipt> {
    const key = await this.deriveKey(id);
    return this.updateRaw(key, data, expectedVersion);
  }

  /**
   * Overwrite a record by pre-computed bytes32 key.
   */
  async updateRaw(
    key             : string,
    data            : Record<string, unknown>,
    expectedVersion : number = 0,
  ): Promise<ethers.TransactionReceipt> {
    if (this.schema) validatePublicRecord(data, this.schema);

    const fieldKeys = computeFieldKeys(data);
    const payload   = new TextEncoder().encode(JSON.stringify(data));

    const tx = await this.c.update(key, fieldKeys, payload, expectedVersion);
    return tx.wait();
  }

  // ── Delete ─────────────────────────────────────────────────

  /**
   * Soft-delete a record by id (record owner or table admin only).
   */
  async deleteRecord(id: bigint): Promise<ethers.TransactionReceipt> {
    const key = await this.deriveKey(id);
    const tx  = await this.c.deleteRecord(key);
    return tx.wait();
  }

  async deleteRaw(key: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.c.deleteRecord(key);
    return tx.wait();
  }

  // ── Access control ─────────────────────────────────────────

  /**
   * Grant EDITOR role to `user` on record `id`.
   * Caller must be record owner or table admin.
   */
  async grantEditor(id: bigint, user: string): Promise<ethers.TransactionReceipt> {
    const key = await this.deriveKey(id);
    const tx  = await this.c.grantEditor(key, user);
    return tx.wait();
  }

  /**
   * Revoke EDITOR role from `user` on record `id`.
   */
  async revokeEditor(id: bigint, user: string): Promise<ethers.TransactionReceipt> {
    const key = await this.deriveKey(id);
    const tx  = await this.c.revokeEditor(key, user);
    return tx.wait();
  }

  // ── Enumeration ────────────────────────────────────────────

  /**
   * Fetch a page of all records written by an address.
   * Returns raw bytes32 keys — use readJSONRaw() to decode each.
   */
  async getOwnerRecordKeys(
    owner  : string,
    start  : bigint = 0n,
    limit  : bigint = 50n,
    active : boolean = true,
  ): Promise<string[]> {
    const fn = active ? 'getActiveOwnerRecords' : 'getOwnerRecords';
    const keys = await this.c[fn](owner, start, limit) as string[];
    return keys;
  }

  /**
   * Fetch and decode all active records for `owner`.
   * Uses concurrent eth_call reads for speed.
   */
  async findMany<T = Record<string, unknown>>(
    owner  : string,
    options: PublicFindManyOptions = {},
  ): Promise<PublicRecordResult<T>[]> {
    const {
      chainOffset = 0n,
      chainLimit  = 200n,
      activeOnly  = true,
    } = options;

    const keys = await this.getOwnerRecordKeys(owner, chainOffset, chainLimit, activeOnly);
    if (keys.length === 0) return [];

    // Concurrent reads — all eth_call, safe to parallelise
    const raws = await Promise.all(keys.map((k) => this.readRaw(k)));

    return raws
      .map((raw, i) => {
        if (raw.deleted) return null;
        try {
          const data = JSON.parse(new TextDecoder().decode(raw.data)) as T;
          return { data, version: raw.version, updatedAt: raw.updatedAt, owner: raw.owner, key: keys[i] };
        } catch {
          return null; // skip unparseable records
        }
      })
      .filter((r): r is PublicRecordResult<T> => r !== null);
  }

  // ── Table-admin: writer management ─────────────────────────

  async setRestrictedWrites(restricted: boolean): Promise<ethers.TransactionReceipt> {
    const tx = await this.c.setRestrictedWrites(restricted);
    return tx.wait();
  }

  async addTableWriter(writer: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.c.addTableWriter(writer);
    return tx.wait();
  }

  async removeTableWriter(writer: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.c.removeTableWriter(writer);
    return tx.wait();
  }

  // ── Views ──────────────────────────────────────────────────

  async exists(id: bigint): Promise<boolean> {
    const key = await this.deriveKey(id);
    return this.c.recordExists(key) as Promise<boolean>;
  }

  async owner(id: bigint): Promise<string> {
    const key = await this.deriveKey(id);
    return this.c.recordOwner(key) as Promise<string>;
  }

  async totalRecords(): Promise<bigint> {
    return this.c.totalRecords() as Promise<bigint>;
  }

  async activeRecords(): Promise<bigint> {
    return this.c.activeRecords() as Promise<bigint>;
  }

  async isRestrictedWrites(): Promise<boolean> {
    return this.c.restrictedWrites() as Promise<boolean>;
  }

  async isTableWriter(address: string): Promise<boolean> {
    return this.c.tableWriters(address) as Promise<boolean>;
  }

  async getSchemaVersion(): Promise<number> {
    return Number(await this.c.schemaVersion());
  }

  async counterValue(recordId: bigint, fieldName: string): Promise<bigint> {
    const key       = await this.deriveKey(recordId);
    const fieldHash = ethers.keccak256(ethers.toUtf8Bytes(fieldName));
    return this.c.counterValue(key, fieldHash) as Promise<bigint>;
  }
}
