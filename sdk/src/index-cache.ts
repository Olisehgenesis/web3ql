/**
 * @file   index-cache.ts
 * @notice Web3QL v1.2 — client-side event-sourced index for fast queries.
 *
 * Problem:
 *   The chain stores opaque ciphertext. Without decrypting every record,
 *   you cannot answer WHERE queries. For small tables this is fine (the
 *   query engine decrypts in batches). For large tables you need an index.
 *
 * Solution — two tiers:
 *
 *   Tier 1: Client-side in-memory index (this file)
 *     • On first load, decrypt all records and build an in-memory lookup map
 *     • Subscribe to chain events to update the cache incrementally
 *     • Fast point-lookups and range scans via the query engine
 *     • Index survives page refreshes when serialised to localStorage/IndexedDB
 *
 *   Tier 2: Relay-maintained SQLite index (v1.2 API)
 *     • The relay sees all writes and maintains a server-side SQLite DB
 *     • Exposes `/api/connector/query` endpoint for WHERE-based key lookup
 *     • SDK calls relay to get matching record keys, then reads+decrypts from chain
 *
 * Usage (client-side index):
 * ─────────────────────────────────────────────────────────────
 *   const cache = new TableIndexCache(tableClient, ownerAddress, schema);
 *
 *   // Build index from chain (decrypt all records)
 *   await cache.build();
 *
 *   // Fast in-memory query (no chain reads)
 *   const results = cache.query()
 *     .where('email', 'eq', 'alice@example.com')
 *     .execute();
 *
 *   // Subscribe to updates (incrementally maintains index)
 *   cache.subscribe(provider);
 *
 *   // Persist to localStorage
 *   cache.save('users-index');
 *   cache.load('users-index');
 * ─────────────────────────────────────────────────────────────
 */

import { ethers }                    from 'ethers';
import type { EncryptedTableClient } from './table-client.js';
import type { SchemaDefinition }     from './types.js';
import { decodeRow }                 from './types.js';
import { query, QueryBuilder }       from './query.js';
import type { Row }                  from './query.js';

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

export interface IndexEntry {
  key     : string;   // bytes32 on-chain record key
  data    : Row;      // decrypted+decoded plaintext
  version : bigint;   // on-chain version counter
  updatedAt: bigint;  // on-chain timestamp
}

export interface IndexCacheOptions {
  /** Batch size for initial build (parallel decrypt). Default: 20. */
  buildBatchSize?: number;
  /** Auto-subscribe to write events to keep index fresh. Default: true. */
  autoSubscribe?: boolean;
  /** Max records to index. Default: unlimited. */
  maxRecords?: number;
}

// ─────────────────────────────────────────────────────────────
//  TableIndexCache
// ─────────────────────────────────────────────────────────────

export class TableIndexCache {
  private tableClient  : EncryptedTableClient;
  private ownerAddress : string;
  private schema?      : SchemaDefinition;
  private opts         : Required<IndexCacheOptions>;

  /** In-memory index: bytes32 key → IndexEntry */
  private _index = new Map<string, IndexEntry>();
  private _built = false;
  private _listener?: () => void;

  constructor(
    tableClient  : EncryptedTableClient,
    ownerAddress : string,
    schema?      : SchemaDefinition,
    opts         : IndexCacheOptions = {},
  ) {
    this.tableClient  = tableClient;
    this.ownerAddress = ownerAddress;
    this.schema       = schema;
    this.opts = {
      buildBatchSize : opts.buildBatchSize ?? 20,
      autoSubscribe  : opts.autoSubscribe  ?? true,
      maxRecords     : opts.maxRecords     ?? Infinity,
    };
  }

  // ── Build ───────────────────────────────────────────────────

  /**
   * Decrypt all owner records from chain and populate the in-memory index.
   * Returns the number of records indexed.
   */
  async build(): Promise<number> {
    const total = Number(await this.tableClient.ownerRecordCount(this.ownerAddress));
    const clampedTotal = Math.min(total, this.opts.maxRecords);

    const BATCH = this.opts.buildBatchSize;
    for (let i = 0; i < clampedTotal; i += BATCH) {
      const keys = await this.tableClient.listOwnerRecords(
        this.ownerAddress,
        BigInt(i),
        BigInt(Math.min(BATCH, clampedTotal - i)),
      );
      const settled = await Promise.allSettled(
        keys.map(async (k) => {
          const raw  = await this.tableClient.readRaw(k);
          const plain = await this.tableClient.readPlaintext(k);
          const parsed = JSON.parse(plain) as Row;
          const data   = this.schema ? decodeRow(this.schema, parsed) as Row : parsed;
          return {
            key     : k,
            data,
            version  : raw.version,
            updatedAt: raw.updatedAt,
          } satisfies IndexEntry;
        }),
      );
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          this._index.set(r.value.key, r.value);
        }
      }
    }

    this._built = true;
    return this._index.size;
  }

  // ── Live subscription ───────────────────────────────────────

  /**
   * Subscribe to on-chain write events. Automatically decrypts and updates
   * the index when new records are written by the owner.
   *
   * @param provider  An ethers Provider with WebSocket or polling support.
   */
  subscribe(provider: ethers.Provider): void {
    // Listen to the raw Transfer-like events on the table contract.
    // Web3QL contracts emit a Write(bytes32 key, address owner) event.
    const iface = new ethers.Interface([
      'event RecordWritten(bytes32 indexed key, address indexed owner)',
      'event RecordUpdated(bytes32 indexed key, address indexed owner)',
      'event RecordDeleted(bytes32 indexed key, address indexed owner)',
    ]);
    const contract = new ethers.Contract(
      this.tableClient.tableAddress,
      iface,
      provider,
    );

    const onWrite = async (key: string, owner: string) => {
      if (owner.toLowerCase() !== this.ownerAddress.toLowerCase()) return;
      try {
        const raw   = await this.tableClient.readRaw(key);
        const plain = await this.tableClient.readPlaintext(key);
        const parsed = JSON.parse(plain) as Row;
        const data   = this.schema ? decodeRow(this.schema, parsed) as Row : parsed;
        this._index.set(key, { key, data, version: raw.version, updatedAt: raw.updatedAt });
      } catch { /* record inaccessible — skip */ }
    };

    const onDelete = (key: string) => {
      this._index.delete(key);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contract as any).on('RecordWritten', onWrite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contract as any).on('RecordUpdated', onWrite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contract as any).on('RecordDeleted', onDelete);

    this._listener = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (contract as any).off('RecordWritten', onWrite);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (contract as any).off('RecordUpdated', onWrite);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (contract as any).off('RecordDeleted', onDelete);
    };
  }

  /** Stop listening to chain events. */
  unsubscribe(): void {
    this._listener?.();
    this._listener = undefined;
  }

  // ── Query ───────────────────────────────────────────────────

  /** Return a QueryBuilder over all indexed records. No chain reads. */
  query(): QueryBuilder<Row> {
    return query(Array.from(this._index.values()).map((e) => e.data));
  }

  /** Look up a specific record by its bytes32 on-chain key. */
  get(key: string): IndexEntry | undefined {
    return this._index.get(key);
  }

  /** All indexed entries as an array. */
  all(): IndexEntry[] {
    return Array.from(this._index.values());
  }

  /** Number of records in the index. */
  get size(): number { return this._index.size; }

  /** True after build() has completed at least once. */
  get built(): boolean { return this._built; }

  // ── Invalidation ────────────────────────────────────────────

  /** Manually add or update an entry (e.g. after a local write). */
  upsert(entry: IndexEntry): void {
    this._index.set(entry.key, entry);
  }

  /** Remove an entry from the cache (e.g. after a local delete). */
  evict(key: string): void {
    this._index.delete(key);
  }

  /** Clear the entire index. */
  clear(): void {
    this._index.clear();
    this._built = false;
  }

  // ── Persistence ─────────────────────────────────────────────

  /**
   * Serialise the index to a JSON string.
   * Store in localStorage or IndexedDB to survive page refreshes.
   */
  serialise(): string {
    const entries = Array.from(this._index.values()).map((e) => ({
      key      : e.key,
      data     : e.data,
      version  : e.version.toString(),
      updatedAt: e.updatedAt.toString(),
    }));
    return JSON.stringify({ version: 1, entries });
  }

  /** Restore an index from a previously serialised string. */
  deserialise(json: string): void {
    const { entries } = JSON.parse(json) as {
      entries: { key: string; data: Row; version: string; updatedAt: string }[];
    };
    for (const e of entries) {
      this._index.set(e.key, {
        key      : e.key,
        data     : e.data,
        version  : BigInt(e.version),
        updatedAt: BigInt(e.updatedAt),
      });
    }
    this._built = true;
  }

  /** Save to localStorage (browser only). */
  save(storageKey: string): void {
    const ls = (globalThis as Record<string, unknown>)['localStorage'] as { setItem(k:string, v:string): void } | undefined;
    if (!ls) return;
    ls.setItem(storageKey, this.serialise());
  }

  /** Load from localStorage (browser only). */
  load(storageKey: string): boolean {
    const ls = (globalThis as Record<string, unknown>)['localStorage'] as { getItem(k:string): string|null } | undefined;
    if (!ls) return false;
    const raw = ls.getItem(storageKey);
    if (!raw) return false;
    this.deserialise(raw);
    return true;
  }
}

// ─────────────────────────────────────────────────────────────
//  Relay query client (v1.2 — queries relay-maintained SQLite index)
// ─────────────────────────────────────────────────────────────

export interface RelayQueryRequest {
  tableAddress: string;
  where?      : { col: string; op: string; val: unknown }[];
  orderBy?    : { col: string; dir: 'asc' | 'desc' }[];
  limit?      : number;
  offset?     : number;
}

export interface RelayQueryResponse {
  /** bytes32 record keys matching the query */
  keys  : string[];
  total : number;
}

/**
 * QueryRelayClient — sends WHERE queries to the relay's SQLite index endpoint
 * and returns matching bytes32 record keys.  The caller then reads+decrypts
 * from chain using the returned keys.
 *
 * This is the v1.2 "fast query" path that avoids decrypting every record.
 */
export class QueryRelayClient {
  private baseUrl: string;

  constructor(relayBaseUrl: string) {
    this.baseUrl = relayBaseUrl.replace(/\/$/, '');
  }

  /**
   * Query the relay's index and return matching bytes32 record keys.
   *
   * @example
   *   const { keys } = await relay.query({
   *     tableAddress: '0x...',
   *     where: [{ col: 'age', op: 'gt', val: 18 }],
   *     limit: 50,
   *   });
   *   const records = await Promise.all(keys.map(k => tableClient.readPlaintext(k)));
   */
  async query(req: RelayQueryRequest): Promise<RelayQueryResponse> {
    const url = `${this.baseUrl}/api/connector/query`;
    const resp = await fetch(url, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(req),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`QueryRelayClient: relay returned ${resp.status}: ${text}`);
    }
    return resp.json() as Promise<RelayQueryResponse>;
  }
}
