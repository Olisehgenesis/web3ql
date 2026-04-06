/**
 * @file   typed-table.ts
 * @notice High-level Prisma-style API for Web3QL encrypted tables.
 *
 * v1.1 upgrades:
 *   • Optional SchemaDefinition support — auto validates, encodes, and decodes
 *     fields using the extended type system (TIMESTAMP, UUID, ENUM, DECIMAL, etc.)
 *   • NOT NULL + DEFAULT enforcement on write
 *   • findMany with full query builder support: where/orderBy/limit/select/distinct
 *   • findAll — convenience method (fetches + decrypts all records in batches)
 *   • aggregate — COUNT/SUM/AVG/MIN/MAX over filtered decrypted records
 *   • seed — bulk insert an array of records
 *
 * Usage (basic, schema-less — identical to v1.0):
 * ─────────────────────────────────────────────────────────────
 *   const users = new TypedTableClient<User>('users', db.table('0xTABLE'))
 *   await users.create(1n, { id: 1n, name: 'Alice' })
 *   const alice = await users.findUnique(1n)
 *
 * Usage (with schema for validation + type coercion):
 * ─────────────────────────────────────────────────────────────
 *   const schema: SchemaDefinition = [
 *     { name: 'id',        type: 'INT',       primaryKey: true },
 *     { name: 'name',      type: 'TEXT',       notNull: true },
 *     { name: 'email',     type: 'TEXT',       notNull: true },
 *     { name: 'createdAt', type: 'TIMESTAMP',  default: () => new Date() },
 *     { name: 'role',      type: 'ENUM',       enumValues: ['user','admin'], default: 'user' },
 *   ]
 *   const users = new TypedTableClient<User>('users', db.table('0xADDR'), schema)
 *
 *   // findMany with query builder
 *   const admins = await users.findMany(ownerAddr, {
 *     where:   [['role', 'eq', 'admin']],
 *     orderBy: [['createdAt', 'desc']],
 *     limit:   20,
 *     select:  ['id', 'name', 'email'],
 *   })
 * ─────────────────────────────────────────────────────────────
 */

import { ethers }                    from 'ethers';
import type { EncryptedTableClient } from './table-client.js';
import {
  SchemaDefinition,
  validateAndEncode,
  decodeRow,
}                                    from './types.js';
import {
  query as buildQuery,
  WhereOperator,
  SortDirection,
  AggregateOptions,
  AggregateResult,
}                                    from './query.js';
import { RecordNotFoundError }       from './errors.js';

export type { SchemaDefinition }     from './types.js';

// ─────────────────────────────────────────────────────────────
//  Public API types
// ─────────────────────────────────────────────────────────────

/** A single WHERE clause expressed as a tuple. */
export type WhereTuple =
  | [field: string, op: 'isNull' | 'isNotNull']
  | [field: string, op: 'in' | 'notIn',        values: unknown[]]
  | [field: string, op: 'between',              range: [unknown, unknown]]
  | [field: string, op: WhereOperator,          value: unknown];

export interface FindManyOptions {
  /**
   * Starting index into the owner's record list when fetching from chain.
   * Applied BEFORE client-side filtering — increase if paginating large tables.
   * Default: 0.
   */
  chainOffset?: bigint;
  /**
   * Maximum records to fetch from chain per page.
   * Default: 200 (raised from v1.0's 50 to allow client-side filtering).
   */
  chainLimit?: bigint;
  /** WHERE conditions — ANDed together. Applied after decrypt. */
  where?: WhereTuple[];
  /** Sort order — applied after filtering. */
  orderBy?: [field: string, dir?: SortDirection][];
  /** Max records returned after filtering (client-side LIMIT). */
  limit?: number;
  /** Skip N records after filtering (client-side OFFSET). */
  offset?: number;
  /** Return only these fields. */
  select?: string[];
  /** Deduplicate on this field value. */
  distinct?: string;
}

export interface RecordWithId<T> {
  /**
   * The uint256 primary key cannot be recovered from the on-chain bytes32 key alone
   * (it is a keccak256 hash). This field is always `0n` when records are fetched via
   * `findMany()`. Store the primary key inside your data payload and read it from
   * `record.data.id` instead.
   */
  id       : bigint;
  /** Decrypted, typed record data. */
  data     : T;
  /** bytes32 on-chain key (hex string). */
  recordKey: string;
}

// ─────────────────────────────────────────────────────────────
//  TypedTableClient
// ─────────────────────────────────────────────────────────────

export class TypedTableClient<T extends Record<string, unknown>> {
  private tableName : string;
  private inner     : EncryptedTableClient;
  private schema?   : SchemaDefinition;

  /**
   * @param tableName  Must match the name used in the SQL schema and createTable().
   * @param inner      An EncryptedTableClient from DatabaseClient.table(address).
   * @param schema     Optional field descriptors — enables validation, type coercion,
   *                   NOT NULL enforcement, and DEFAULT values.
   */
  constructor(tableName: string, inner: EncryptedTableClient, schema?: SchemaDefinition) {
    this.tableName = tableName;
    this.inner     = inner;
    this.schema    = schema;
  }

  // ── Key helper ─────────────────────────────────────────────

  /** Derive the canonical bytes32 on-chain key for a given primary key id. */
  key(id: bigint): string {
    return this.inner.deriveKey(this.tableName, id);
  }

  // ── Internal encode/decode ──────────────────────────────────

  private encode(data: T, schemaVersion = 0): string {
    const base = this.schema
      ? validateAndEncode(this.schema, data as Record<string, unknown>)
      : (data as Record<string, unknown>);
    // Stamp __v so MigrationRunner can determine which migrations to apply on read.
    return JSON.stringify({ __v: schemaVersion, ...base });
  }

  private decode(plaintext: string): T {
    const parsed = JSON.parse(plaintext) as Record<string, unknown>;
    // Strip the protocol-internal __v field before returning to caller.
    const { __v: _version, ...rest } = parsed;
    void _version;
    if (this.schema) return decodeRow(this.schema, rest) as T;
    return rest as T;
  }

  // ── Write ───────────────────────────────────────────────────

  /**
   * Validate, encode, encrypt, and store a new record.
   * Throws if a non-deleted record with the same id already exists.
   */
  async create(id: bigint, data: T): Promise<ethers.TransactionReceipt> {
    const schemaVersion = await this.inner.getSchemaVersion();
    return this.inner.writeRaw(this.key(id), this.encode(data, schemaVersion));
  }

  /**
   * Bulk-insert an array of records. Each record must include the primary key field.
   * Records are written sequentially — fails on first error.
   */
  async seed(
    rows: { id: bigint; data: T }[],
  ): Promise<ethers.TransactionReceipt[]> {
    const receipts: ethers.TransactionReceipt[] = [];
    for (const row of rows) {
      receipts.push(await this.create(row.id, row.data));
    }
    return receipts;
  }

  // ── Read ────────────────────────────────────────────────────

  /**
   * Read and decrypt a single record by primary key.
   * Returns `null` if the record does not exist or has been deleted.
   */
  async findUnique(id: bigint): Promise<T | null> {
    try {
      const exists = await this.inner.exists(this.key(id));
      if (!exists) return null;
      const plaintext = await this.inner.readPlaintext(this.key(id));
      return this.decode(plaintext);
    } catch (err: unknown) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('deleted') || msg.includes('not found') || msg.includes('RecordMeta')) {
        return null;
      }
      throw err;
    }
  }

  /**
   * List and decrypt all records owned by `ownerAddress`, with optional
   * client-side filtering, sorting, pagination, and projection.
   *
   * ⚠  Records are decrypted client-side. Use `chainLimit` to constrain
   *    chain reads on large tables. For production scale, use the relay-
   *    maintained index endpoint (v1.2) instead.
   */
  async findMany(
    ownerAddress : string,
    options      : FindManyOptions = {},
  ): Promise<RecordWithId<Partial<T>>[]> {
    const chainOffset = options.chainOffset ?? 0n;
    const chainLimit  = options.chainLimit  ?? 200n;

    const keys: string[] = await this.inner.listOwnerRecords(ownerAddress, chainOffset, chainLimit);
    const raw: RecordWithId<T>[] = [];

    // Decrypt in parallel (capped at 20 concurrent RPCs)
    const BATCH = 20;
    for (let i = 0; i < keys.length; i += BATCH) {
      const batch = keys.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map(async (recordKey) => {
          const plaintext = await this.inner.readPlaintext(recordKey);
          return { id: 0n, data: this.decode(plaintext), recordKey };
        }),
      );
      for (const r of settled) {
        if (r.status === 'fulfilled') raw.push(r.value);
        // silently skip inaccessible / deleted records
      }
    }

    // Build query
    let q = buildQuery(raw.map((r) => r.data as Record<string, unknown>));

    if (options.where) {
      for (const clause of options.where) {
        if (clause[1] === 'isNull' || clause[1] === 'isNotNull') {
          q = q.where(clause[0], clause[1]);
        } else if (clause[1] === 'in' || clause[1] === 'notIn') {
          q = q.where(clause[0], clause[1], clause[2] as unknown[]);
        } else if (clause[1] === 'between') {
          q = q.where(clause[0], clause[1], clause[2] as [unknown, unknown]);
        } else {
          q = q.where(clause[0], clause[1] as WhereOperator, clause[2]);
        }
      }
    }
    if (options.orderBy) {
      for (const [field, dir] of options.orderBy) q = q.orderBy(field, dir ?? 'asc');
    }
    if (options.limit  != null) q = q.limit(options.limit);
    if (options.offset != null) q = q.offset(options.offset);
    if (options.select)         q = q.select(options.select);
    if (options.distinct)       q = q.distinct(options.distinct);

    const filteredData = q.execute() as Partial<T>[];

    // Remap back to RecordWithId — match by index since we decrypted in order
    return filteredData.map((data, idx) => ({
      id       : 0n,
      data,
      recordKey: raw[idx]?.recordKey ?? '',
    }));
  }

  /**
   * Convenience: fetch and decrypt ALL records the wallet owns (no chain limit).
   * Useful for small tables or full exports. Decrypts in parallel batches of 20.
   */
  async findAll(ownerAddress: string): Promise<RecordWithId<T>[]> {
    const total = Number(await this.inner.ownerRecordCount(ownerAddress));
    return this.findMany(ownerAddress, {
      chainOffset: 0n,
      chainLimit : BigInt(total),
    }) as Promise<RecordWithId<T>[]>;
  }

  /**
   * Aggregate over owner's records: COUNT, SUM, AVG, MIN, MAX, GROUP BY.
   *
   * @example
   *   await users.aggregate(ownerAddress, { count: '*', groupBy: 'role' })
   *   // => [{ group: 'admin', count: 3 }, { group: 'user', count: 47 }]
   */
  async aggregate(
    ownerAddress  : string,
    opts          : AggregateOptions,
    where?        : WhereTuple[],
    chainLimit?   : bigint,
  ): Promise<AggregateResult[]> {
    const records = await this.findMany(ownerAddress, {
      chainLimit,
      where,
    });
    const rows = records.map((r) => r.data as Record<string, unknown>);
    return buildQuery(rows).aggregate(opts);
  }

  // ── Update ──────────────────────────────────────────────────

  /**
   * Fetch existing data, merge with `patch`, re-encrypt, and update on-chain.
   */
  async update(id: bigint, patch: Partial<T>): Promise<ethers.TransactionReceipt> {
    const current = await this.findUnique(id);
    if (current === null) throw new Error(`TypedTableClient.update: record ${id} not found`);
    const merged = { ...current, ...patch } as T;
    return this.inner.updateRaw(this.key(id), this.encode(merged));
  }

  /**
   * Replace a record's data entirely (no merge).
   * More gas-efficient when you have the full new payload ready.
   */
  async replace(id: bigint, data: T): Promise<ethers.TransactionReceipt> {
    return this.inner.updateRaw(this.key(id), this.encode(data));
  }

  // ── Delete ──────────────────────────────────────────────────

  /**
   * Soft-delete a record. The symmetric key is scrubbed for all collaborators.
   * Only the record owner can call this.
   */
  async remove(id: bigint): Promise<ethers.TransactionReceipt> {
    return this.inner.deleteRecord(this.key(id));
  }

  // ── Helpers ─────────────────────────────────────────────────

  /** Total number of records ever written by `ownerAddress` (including deleted). */
  async count(ownerAddress: string): Promise<bigint> {
    return this.inner.ownerRecordCount(ownerAddress);
  }

  /** True if a live (non-deleted) record exists for the given id. */
  async exists(id: bigint): Promise<boolean> {
    return this.inner.exists(this.key(id));
  }
}
