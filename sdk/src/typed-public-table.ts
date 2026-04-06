/**
 * @file   typed-public-table.ts
 * @notice Prisma-style typed API for Web3QLPublicTable (plaintext / public tables).
 *
 * Mirrors the TypedTableClient API but wraps PublicTableClient instead of
 * EncryptedTableClient.  Key differences from the private-table equivalent:
 *
 *   ✅ NO encryption — no NaCl, no key management, no keypair required
 *   ✅ Saves ~80-100k gas per write  (no encryptedKey SSTORE, no box overhead)
 *   ✅ Reads need only a provider — any eth_call works, no wallet required
 *   ✅ On-chain schema validation prevents invalid writes at the contract level
 *   ✅ Per-record owner + EDITOR role-based access control
 *   ✅ Optimistic locking via expectedVersion on update()
 *   ✅ MigrationRunner applied transparently on every read
 *   ⚠️  All stored data is publicly visible on chain — do NOT store secrets here
 *
 * Usage:
 * ─────────────────────────────────────────────────────────────
 *   const projects = new TypedPublicTableClient<Project>(
 *     'projects',
 *     new PublicTableClient(tableAddress, signer, projectSchema),
 *     projectSchema,
 *     projectMigrations,   // optional MigrationRunner
 *   );
 *
 *   // Write (table admin when restrictedWrites = true)
 *   await projects.create(1n, { id: 1n, title: 'Web3QL', status: 'active', ... });
 *
 *   // Read — requires only a provider, no wallet or decryption
 *   const p = await projects.findUnique(1n);
 *
 *   // Update with optimistic lock
 *   await projects.update(1n, updatedData, currentVersion);
 *
 *   // Query your own records with filtering + sorting
 *   const active = await projects.findMany(adminAddress, {
 *     where:   [['status', 'eq', 'active']],
 *     orderBy: [['createdAt', 'desc']],
 *     limit:   20,
 *   });
 * ─────────────────────────────────────────────────────────────
 */

import { ethers }                 from 'ethers';
import {
  PublicTableClient,
  derivePublicKey,
}                                 from './public-table-client.js';
import type { PublicFindManyOptions } from './public-table-client.js';
import {
  validateAndEncode,
  decodeRow,
}                                 from './types.js';
import type { SchemaDefinition }  from './types.js';
import {
  query as buildQuery,
  QueryBuilder,
}                                 from './query.js';
import type { WhereOperator, SortDirection } from './query.js';
import { MigrationRunner }        from './migrations.js';
import { RecordNotFoundError }    from './errors.js';

export type { SchemaDefinition }  from './types.js';

// ─────────────────────────────────────────────────────────────
//  Public API types
// ─────────────────────────────────────────────────────────────

/** A WHERE clause tuple — identical shape to TypedTableClient. */
export type PublicWhereTuple =
  | [field: string, op: 'isNull' | 'isNotNull']
  | [field: string, op: 'in' | 'notIn',        values: unknown[]]
  | [field: string, op: 'between',              range: [unknown, unknown]]
  | [field: string, op: WhereOperator,          value: unknown];

export interface PublicFindManyQueryOptions extends PublicFindManyOptions {
  /** WHERE conditions — ANDed together, applied client-side after fetch. */
  where?   : PublicWhereTuple[];
  /** Sort order — applied after client-side filtering. */
  orderBy? : [field: string, dir?: SortDirection][];
  /** Max records returned after filtering. */
  limit?   : number;
  /** Skip N records after filtering. */
  offset?  : number;
  /** Return only these fields. */
  select?  : string[];
  /** Deduplicate on this field value. */
  distinct?: string;
}

export interface PublicRecordWithMeta<T> {
  data      : T;
  /** bytes32 on-chain key (hex string). */
  recordKey : string;
  owner     : string;
  version   : number;
  /** Unix seconds — matches block.timestamp at write time. */
  updatedAt : number;
}

// ─────────────────────────────────────────────────────────────
//  TypedPublicTableClient
// ─────────────────────────────────────────────────────────────

export class TypedPublicTableClient<T extends Record<string, unknown>> {
  private tableName  : string;
  private inner      : PublicTableClient;
  private schema?    : SchemaDefinition;
  private migrations?: MigrationRunner;

  /**
   * @param tableName   Must match the name used in createTable() — used for key derivation.
   * @param inner       A PublicTableClient pointing at the deployed contract.
   * @param schema      Optional field descriptors for client-side validation + type coercion.
   * @param migrations  Optional MigrationRunner applied transparently on every read.
   */
  constructor(
    tableName  : string,
    inner      : PublicTableClient,
    schema?    : SchemaDefinition,
    migrations?: MigrationRunner,
  ) {
    this.tableName  = tableName;
    this.inner      = inner;
    this.schema     = schema;
    this.migrations = migrations;
  }

  // ── Key derivation ──────────────────────────────────────────

  /** Derive the canonical bytes32 on-chain key for a uint256 primary key. */
  key(id: bigint): string {
    return derivePublicKey(this.tableName, id);
  }

  // ── Internal encode / decode ────────────────────────────────

  private async encodeWithVersion(data: T): Promise<Record<string, unknown>> {
    const schemaVersion = await this.inner.getSchemaVersion();
    const base = this.schema
      ? validateAndEncode(this.schema, data as Record<string, unknown>)
      : (data as Record<string, unknown>);
    // Stamp __v so MigrationRunner knows which migrations to apply on read.
    return { __v: schemaVersion, ...base };
  }

  private decode(raw: Record<string, unknown>): T {
    const { __v, ...rest } = raw as Record<string, unknown> & { __v?: number };
    const writtenAt = typeof __v === 'number' ? __v : 0;

    // Apply forward migrations for records written at older schema versions.
    const migrated = this.migrations
      ? this.migrations.applyToRecord(rest, writtenAt)
      : rest;

    if (this.schema) return decodeRow(this.schema, migrated) as T;
    return migrated as T;
  }

  // ── Write ───────────────────────────────────────────────────

  /**
   * Validate, encode, and write a new record.
   * On public tables the caller becomes the record owner.
   * For tables with restrictedWrites = true, only the table admin can call this.
   */
  async create(id: bigint, data: T): Promise<ethers.TransactionReceipt> {
    const payload = await this.encodeWithVersion(data);
    return this.inner.writeRaw(this.key(id), payload);
  }

  /**
   * Bulk-insert records.  Stops on first error.
   */
  async seed(rows: { id: bigint; data: T }[]): Promise<ethers.TransactionReceipt[]> {
    const receipts: ethers.TransactionReceipt[] = [];
    for (const row of rows) {
      receipts.push(await this.create(row.id, row.data));
    }
    return receipts;
  }

  // ── Read ─────────────────────────────────────────────────────

  /**
   * Read a single record by primary key.
   * Returns null if absent or soft-deleted.
   * Requires only an ethers provider — no wallet or decryption needed.
   */
  async findUnique(id: bigint): Promise<T | null> {
    try {
      const result = await this.inner.readJSONRaw<Record<string, unknown>>(this.key(id));
      return this.decode(result.data);
    } catch (err: unknown) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('deleted') || msg.includes('not found')) return null;
      throw err;
    }
  }

  /** Read a single record and throw RecordNotFoundError if absent. */
  async findUniqueOrThrow(id: bigint): Promise<T> {
    const record = await this.findUnique(id);
    if (record === null) throw new RecordNotFoundError(String(id));
    return record;
  }

  /** Read with full on-chain metadata (owner, version, updatedAt). */
  async findUniqueWithMeta(id: bigint): Promise<PublicRecordWithMeta<T> | null> {
    try {
      const result = await this.inner.readJSONRaw<Record<string, unknown>>(this.key(id));
      return {
        data     : this.decode(result.data),
        recordKey: result.key,
        owner    : result.owner,
        version  : result.version,
        updatedAt: result.updatedAt,
      };
    } catch (err: unknown) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('deleted') || msg.includes('not found')) return null;
      throw err;
    }
  }

  /**
   * Paginate + filter all records written by `ownerAddress`.
   *
   * The `ownerAddress` is the wallet that called write() for those records.
   * For tables with restrictedWrites = true (admin-only writes) pass the table
   * admin address to enumerate all records.
   *
   * Filtering, sorting, and limiting are all applied client-side after fetch.
   */
  async findMany(
    ownerAddress: string,
    options: PublicFindManyQueryOptions = {},
  ): Promise<PublicRecordWithMeta<T>[]> {
    const {
      chainOffset = 0n,
      chainLimit  = 200n,
      activeOnly  = true,
      where       = [],
      orderBy     = [],
      limit,
      offset      = 0,
      select,
      distinct,
    } = options;

    // 1. Fetch paginated bytes32 keys from chain.
    const keys = await this.inner.getOwnerRecordKeys(
      ownerAddress,
      chainOffset,
      chainLimit,
      activeOnly,
    );
    if (keys.length === 0) return [];

    // 2. Concurrent reads — all eth_call, safe to parallelise.
    const raws = await Promise.all(
      keys.map(async (key) => {
        try {
          return await this.inner.readJSONRaw<Record<string, unknown>>(key);
        } catch {
          return null;
        }
      }),
    );

    // 3. Decode records, attach a numeric __idx so query builder rows can be mapped
    //    back to their original metadata after filtering/sorting.
    type IndexedRow = Record<string, unknown> & { __idx: number };

    const decoded: PublicRecordWithMeta<T>[] = [];
    const indexedRows: IndexedRow[] = [];

    for (let i = 0; i < raws.length; i++) {
      const raw = raws[i];
      if (!raw) continue;
      const key = keys[i];
      if (!key) continue;
      try {
        const data = this.decode(raw.data);
        decoded.push({
          data,
          recordKey: key,
          owner    : raw.owner,
          version  : raw.version,
          updatedAt: raw.updatedAt,
        });
        // __idx is preserved through the query builder because unknown extra fields pass through.
        indexedRows.push({ ...(data as Record<string, unknown>), __idx: decoded.length - 1 });
      } catch {
        // Skip unparseable records.
      }
    }

    if (indexedRows.length === 0) return [];

    // 4. Run client-side query builder using the fluent QueryBuilder API.
    //    Always include __idx in select (if select is specified) so we can correlate
    //    filtered rows back to their on-chain metadata.
    let q: QueryBuilder<IndexedRow> = buildQuery(indexedRows as Record<string, unknown>[]) as QueryBuilder<IndexedRow>;

    for (const clause of where) {
      if (clause[1] === 'isNull' || clause[1] === 'isNotNull') {
        q = q.where(clause[0], clause[1]) as QueryBuilder<IndexedRow>;
      } else if (clause[1] === 'in' || clause[1] === 'notIn') {
        q = q.where(clause[0], clause[1], clause[2] as unknown[]) as QueryBuilder<IndexedRow>;
      } else if (clause[1] === 'between') {
        q = q.where(clause[0], clause[1], clause[2] as [unknown, unknown]) as QueryBuilder<IndexedRow>;
      } else {
        q = q.where(clause[0], clause[1] as WhereOperator, clause[2]) as QueryBuilder<IndexedRow>;
      }
    }
    for (const [field, dir] of orderBy) {
      q = q.orderBy(field, dir ?? 'asc') as QueryBuilder<IndexedRow>;
    }
    if (limit  != null) q = q.limit(limit)   as QueryBuilder<IndexedRow>;
    if (offset != null) q = q.offset(offset)  as QueryBuilder<IndexedRow>;
    // When select is given, always include __idx so metadata correlation works.
    if (select)   q = q.select([...select, '__idx']) as QueryBuilder<IndexedRow>;
    if (distinct) q = q.distinct(distinct)           as QueryBuilder<IndexedRow>;

    const filtered = q.execute() as IndexedRow[];

    // 5. Re-attach metadata using the preserved __idx.
    return filtered.map((row) => {
      const idx = row['__idx'] as number;
      const { __idx: _drop, ...data } = row;
      void _drop;
      const meta = decoded[idx];
      return {
        data     : data as T,
        recordKey: meta?.recordKey ?? '',
        owner    : meta?.owner     ?? '',
        version  : meta?.version   ?? 0,
        updatedAt: meta?.updatedAt ?? 0,
      } satisfies PublicRecordWithMeta<T>;
    });
  }

  // ── Update ──────────────────────────────────────────────────

  /**
   * Overwrite an existing record.
   * Pass `expectedVersion` > 0 to enable optimistic locking.
   */
  async update(
    id              : bigint,
    data            : T,
    expectedVersion : number = 0,
  ): Promise<ethers.TransactionReceipt> {
    const exists = await this.inner.exists(id);
    if (!exists) throw new RecordNotFoundError(String(id));
    const payload = await this.encodeWithVersion(data);
    return this.inner.updateRaw(this.key(id), payload, expectedVersion);
  }

  /**
   * Merge `patch` into the current record without overwriting unchanged fields.
   */
  async patch(
    id              : bigint,
    patch           : Partial<T>,
    expectedVersion : number = 0,
  ): Promise<ethers.TransactionReceipt> {
    const current = await this.findUniqueOrThrow(id);
    return this.update(id, { ...current, ...patch }, expectedVersion);
  }

  // ── Delete ──────────────────────────────────────────────────

  /** Soft-delete a record (record owner or table admin only). */
  async deleteRecord(id: bigint): Promise<ethers.TransactionReceipt> {
    return this.inner.deleteRecord(id);
  }

  // ── Access control ──────────────────────────────────────────

  /** Grant EDITOR role on a record to another address. Caller = owner or admin. */
  async grantEditor(id: bigint, address: string): Promise<ethers.TransactionReceipt> {
    return this.inner.grantEditor(id, address);
  }

  async revokeEditor(id: bigint, address: string): Promise<ethers.TransactionReceipt> {
    return this.inner.revokeEditor(id, address);
  }

  // ── Table metadata ──────────────────────────────────────────

  async getSchemaVersion(): Promise<number> {
    return this.inner.getSchemaVersion();
  }

  async getTableName(): Promise<string> {
    return this.inner.getTableName();
  }

  async getTotalRecords(): Promise<bigint> {
    return this.inner.totalRecords();
  }

  async getActiveRecords(): Promise<bigint> {
    return this.inner.activeRecords();
  }
}
