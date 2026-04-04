/**
 * @file   schema-manager.ts
 * @notice Web3QL v1.2 — schema management: drop tables, rename, introspection.
 *
 * Schema is stored as ABI-encoded bytes in the database contract.
 * This module provides:
 *
 *   1. SCHEMA INTROSPECTION  — decode raw schema bytes → FieldDescriptor[]
 *   2. DROP TABLE            — bulk delete all owner records, then rename table to __dropped__
 *   3. RENAME TABLE          — soft-rename via a meta record (contract doesn't support rename natively)
 *   4. SCHEMA DIFF           — compare two schemas, produce a list of changes
 *   5. SCHEMA VERSION        — read + write the schema version stored in a meta record
 *
 * Usage:
 * ─────────────────────────────────────────────────────────────
 *   const mgr = new SchemaManager(db, tableAddress, tableClient);
 *
 *   // Inspect a deployed table's schema
 *   const fields = await mgr.introspect();
 *
 *   // Diff two versions
 *   const changes = diffSchema(oldFields, newFields);
 *
 *   // Soft-drop: mark table as dropped + purge all owner records
 *   await mgr.dropTable(ownerAddress);
 *
 *   // Soft-rename: store alias mapping in meta record
 *   await mgr.renameTable('users', 'app_users');
 * ─────────────────────────────────────────────────────────────
 */

import { ethers }                    from 'ethers';
import type { DatabaseClient }       from './factory-client.js';
import type { EncryptedTableClient } from './table-client.js';
import type { FieldDescriptor }      from './types.js';

// ─────────────────────────────────────────────────────────────
//  Schema introspection
// ─────────────────────────────────────────────────────────────

/**
 * Minimal ABI type tags used in Web3QL schema encoding.
 * Must stay in sync with protocol/compiler/generator.ts.
 */
const SOLIDITY_TO_FIELD_TYPE: Record<string, string> = {
  'uint256': 'INT',
  'int256' : 'INT',
  'int64'  : 'INT',
  'uint64' : 'UINT64',
  'uint32' : 'UINT32',
  'uint16' : 'UINT16',
  'uint8'  : 'UINT8',
  'string' : 'TEXT',
  'bool'   : 'BOOL',
  'address': 'ADDRESS',
  'bytes32': 'BYTES32',
  'bytes'  : 'BYTES32',
};

/**
 * Decode raw schema bytes from the contract into an array of FieldDescriptors.
 *
 * Web3QL encodes schema as ABI-encoded:
 *   tuple(string name, string solidityType, bool primaryKey, bool notNull)[]
 *
 * This mirrors protocol/compiler/generator.ts compileSchema().
 */
export function decodeSchemaBytes(schemaBytes: string | Uint8Array): FieldDescriptor[] {
  try {
    const bytes = typeof schemaBytes === 'string' ? ethers.getBytes(schemaBytes) : schemaBytes;
    if (bytes.length === 0) return [];

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const decoded  = abiCoder.decode(
      ['tuple(string name, string solidityType, bool primaryKey, bool notNull)[]'],
      bytes,
    );
    const fields = decoded[0] as { name: string; solidityType: string; primaryKey: boolean; notNull: boolean }[];
    return fields.map((f) => ({
      name      : f.name,
      type      : (SOLIDITY_TO_FIELD_TYPE[f.solidityType] ?? 'TEXT') as FieldDescriptor['type'],
      primaryKey: f.primaryKey || undefined,
      notNull   : f.notNull    || undefined,
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
//  Schema diff
// ─────────────────────────────────────────────────────────────

export type SchemaChangeType = 'added' | 'dropped' | 'typeChanged' | 'notNullChanged';

export interface SchemaChange {
  type     : SchemaChangeType;
  column   : string;
  oldValue?: string;
  newValue?: string;
}

/**
 * Compute the diff between two schema versions.
 * Returns an ordered list of changes from `from` → `to`.
 */
export function diffSchema(
  from: FieldDescriptor[],
  to  : FieldDescriptor[],
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const fromMap = new Map(from.map((f) => [f.name, f]));
  const toMap   = new Map(to.map((f) => [f.name, f]));

  // Added or changed
  for (const [name, toField] of toMap) {
    const fromField = fromMap.get(name);
    if (!fromField) {
      changes.push({ type: 'added', column: name, newValue: toField.type });
    } else {
      if (fromField.type !== toField.type) {
        changes.push({ type: 'typeChanged', column: name, oldValue: fromField.type, newValue: toField.type });
      }
      if (Boolean(fromField.notNull) !== Boolean(toField.notNull)) {
        changes.push({
          type    : 'notNullChanged',
          column  : name,
          oldValue: fromField.notNull ? 'NOT NULL' : 'NULLABLE',
          newValue: toField.notNull   ? 'NOT NULL' : 'NULLABLE',
        });
      }
    }
  }

  // Dropped
  for (const name of fromMap.keys()) {
    if (!toMap.has(name)) {
      changes.push({ type: 'dropped', column: name });
    }
  }

  return changes;
}

// ─────────────────────────────────────────────────────────────
//  SchemaManager
// ─────────────────────────────────────────────────────────────

const DATABASE_INTROSPECT_ABI = [
  'function getTableSchema(string calldata name) external view returns (bytes memory)',
  'function getTable(string calldata name) external view returns (address)',
  'function listTables() external view returns (string[] memory)',
] as const;

export class SchemaManager {
  private db          : DatabaseClient;
  private tableAddress: string;
  private tableClient : EncryptedTableClient;
  private dbContract  : ethers.Contract;

  constructor(
    db          : DatabaseClient,
    tableAddress: string,
    tableClient : EncryptedTableClient,
    signer      : ethers.Signer,
  ) {
    this.db           = db;
    this.tableAddress = tableAddress;
    this.tableClient  = tableClient;
    this.dbContract   = new ethers.Contract(db.address, DATABASE_INTROSPECT_ABI, signer);
  }

  // ── Introspection ───────────────────────────────────────────

  /**
   * Read the schema bytes from the database contract and decode them
   * into a usable FieldDescriptor array.
   *
   * @param tableName  The name used when the table was created.
   */
  async introspect(tableName: string): Promise<FieldDescriptor[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const schemaBytes = await (this.dbContract as any).getTableSchema(tableName) as string;
      return decodeSchemaBytes(schemaBytes);
    } catch {
      return [];
    }
  }

  /**
   * List all table names in this database.
   */
  async listTables(): Promise<string[]> {
    return this.db.listTables();
  }

  // ── Schema version tracking ─────────────────────────────────

  /**
   * Read the schema version stored in a meta record on-chain.
   * Returns 0 if no version record has been written yet.
   */
  async getSchemaVersion(tableName: string): Promise<number> {
    const versionKey = this.tableClient.deriveKey(`__schema_version__${tableName}`, 0n);
    try {
      const exists = await this.tableClient.exists(versionKey);
      if (!exists) return 0;
      const json = await this.tableClient.readPlaintext(versionKey);
      const { version } = JSON.parse(json) as { version: number };
      return version;
    } catch {
      return 0;
    }
  }

  /**
   * Write (or update) the schema version meta record.
   */
  async setSchemaVersion(tableName: string, version: number): Promise<void> {
    const versionKey = this.tableClient.deriveKey(`__schema_version__${tableName}`, 0n);
    const payload    = JSON.stringify({ version, updatedAt: Date.now() });
    const exists     = await this.tableClient.exists(versionKey);
    if (exists) {
      await this.tableClient.updateRaw(versionKey, payload);
    } else {
      await this.tableClient.writeRaw(versionKey, payload);
    }
  }

  // ── Soft-rename ─────────────────────────────────────────────

  /**
   * Store a name alias mapping in a meta record.
   * Future `introspect()` calls should use the new name.
   *
   * ⚠  The contract still uses the old name internally. This is a
   *    client-side alias only. To hard-rename, re-create the table.
   */
  async renameTable(oldName: string, newName: string): Promise<void> {
    const renameKey = this.tableClient.deriveKey(`__rename__${oldName}`, 0n);
    const payload   = JSON.stringify({ from: oldName, to: newName, renamedAt: Date.now() });
    const exists    = await this.tableClient.exists(renameKey);
    if (exists) {
      await this.tableClient.updateRaw(renameKey, payload);
    } else {
      await this.tableClient.writeRaw(renameKey, payload);
    }
  }

  /** Check if a table has been soft-renamed. Returns the new name or null. */
  async getRenamedTo(tableName: string): Promise<string | null> {
    const renameKey = this.tableClient.deriveKey(`__rename__${tableName}`, 0n);
    try {
      const exists = await this.tableClient.exists(renameKey);
      if (!exists) return null;
      const json = await this.tableClient.readPlaintext(renameKey);
      const { to } = JSON.parse(json) as { to: string };
      return to;
    } catch {
      return null;
    }
  }

  // ── Soft-drop ───────────────────────────────────────────────

  /**
   * "Drop" a table by:
   *   1. Deleting all owner records (batch, up to `maxRecords`).
   *   2. Writing a __dropped__ meta record so the SDK knows to ignore it.
   *
   * ⚠  This is irreversible. The on-chain key->ciphertext mapping for
   *    deleted records is permanently unreadable (symmetric key scrubbed).
   *
   * @param ownerAddress  Address whose records to delete.
   * @param maxRecords    Safety cap. Default: 500. Increase for large tables.
   */
  async dropTable(ownerAddress: string, maxRecords = 500): Promise<{ deleted: number }> {
    const keys = await this.tableClient.listOwnerRecords(ownerAddress, 0n, BigInt(maxRecords));
    let deleted = 0;
    for (const key of keys) {
      try {
        await this.tableClient.deleteRecord(key);
        deleted++;
      } catch { /* already deleted or no access — skip */ }
    }

    // Write tombstone
    const tombstoneKey = this.tableClient.deriveKey(`__dropped__${this.tableAddress}`, 0n);
    const payload      = JSON.stringify({ droppedAt: Date.now(), ownerAddress });
    await this.tableClient.writeRaw(tombstoneKey, payload);

    return { deleted };
  }

  /** Check if a table has been soft-dropped. */
  async isDropped(): Promise<boolean> {
    const tombstoneKey = this.tableClient.deriveKey(`__dropped__${this.tableAddress}`, 0n);
    return this.tableClient.exists(tombstoneKey);
  }
}
