/**
 * @file   constraints.ts
 * @notice Web3QL v1.2 — integrity constraint engine.
 *
 * Constraints live in the SDK layer (off-chain) with the following guarantees:
 *
 *   • PRIMARY KEY uniqueness  — contract enforces at write (requires exists() pre-check)
 *   • UNIQUE                  — SDK maintains an in-memory seen-values set per column
 *   • DEFAULT / NOT NULL      — enforced by types.ts validateAndEncode()
 *   • CHECK                   — per-column validation function
 *   • FOREIGN KEY             — SDK reads target table at write time
 *   • AUTO_INCREMENT          — SDK-maintained counter (persisted in a meta record)
 *   • ON DELETE CASCADE       — SDK fetches referencing records and deletes them
 *
 * None of these require contract changes for CHECK/UNIQUE (client-side enforcement).
 * PK uniqueness IS enforced at the contract level via `recordExists`.
 *
 * Usage:
 * ─────────────────────────────────────────────────────────────
 *   const constraints = new ConstraintEngine([
 *     { type: 'unique',  column: 'email' },
 *     { type: 'check',   column: 'age',   check: (v) => Number(v) >= 0 },
 *     { type: 'fk',      column: 'userId', references: { table: userTable, column: 'id' } },
 *   ]);
 *
 *   // Before writing:
 *   await constraints.validate(row, existingRows);
 *
 *   // Get next AUTO_INCREMENT id:
 *   const nextId = await constraints.nextId(tableAddress, client);
 * ─────────────────────────────────────────────────────────────
 */

import type { EncryptedTableClient } from './table-client.js';

// ─────────────────────────────────────────────────────────────
//  Constraint definition types
// ─────────────────────────────────────────────────────────────

export interface UniqueConstraint {
  type  : 'unique';
  column: string;
}

export interface CheckConstraint {
  type  : 'check';
  column: string;
  /** Return true if the value is valid. Throw or return false to reject. */
  check : (value: unknown, row: Record<string, unknown>) => boolean | Promise<boolean>;
  /** Optional human-readable constraint name for error messages. */
  name? : string;
}

export interface ForeignKeyConstraint {
  type      : 'fk';
  column    : string;
  references: {
    /** EncryptedTableClient for the target table. */
    table : EncryptedTableClient;
    /** Column in the target table that holds the referenced key. */
    column: string;
    /** Table name — needed to derive the bytes32 key. */
    tableName: string;
  };
  /** What to do when the referenced record is deleted. Default: 'restrict' */
  onDelete?: 'restrict' | 'cascade' | 'setNull';
}

export interface NotNullConstraint {
  type  : 'notNull';
  column: string;
}

export type Constraint =
  | UniqueConstraint
  | CheckConstraint
  | ForeignKeyConstraint
  | NotNullConstraint;

// ─────────────────────────────────────────────────────────────
//  Constraint violation error
// ─────────────────────────────────────────────────────────────

export class ConstraintViolation extends Error {
  constructor(
    public readonly constraintType: string,
    public readonly column        : string,
    message: string,
  ) {
    super(message);
    this.name = 'ConstraintViolation';
  }
}

// ─────────────────────────────────────────────────────────────
//  ConstraintEngine
// ─────────────────────────────────────────────────────────────

export class ConstraintEngine {
  private constraints: Constraint[];

  constructor(constraints: Constraint[] = []) {
    this.constraints = constraints;
  }

  /**
   * Validate a new/updated row against all constraints.
   *
   * @param row          The row being written (fully encoded, post validateAndEncode).
   * @param existingRows Already-decoded rows from the same table (for UNIQUE checks).
   *                     Pass an empty array if fetching is not possible.
   */
  async validate(
    row          : Record<string, unknown>,
    existingRows : Record<string, unknown>[] = [],
  ): Promise<void> {
    for (const c of this.constraints) {
      switch (c.type) {
        case 'notNull':
          this._checkNotNull(c, row);
          break;
        case 'unique':
          this._checkUnique(c, row, existingRows);
          break;
        case 'check':
          await this._checkCheck(c, row);
          break;
        case 'fk':
          await this._checkForeignKey(c, row);
          break;
      }
    }
  }

  private _checkNotNull(c: NotNullConstraint, row: Record<string, unknown>): void {
    const v = row[c.column];
    if (v === null || v === undefined || v === '__NULL__') {
      throw new ConstraintViolation(
        'notNull', c.column,
        `NOT NULL violation: column "${c.column}" cannot be null`,
      );
    }
  }

  private _checkUnique(
    c           : UniqueConstraint,
    row         : Record<string, unknown>,
    existingRows: Record<string, unknown>[],
  ): void {
    const newVal = row[c.column];
    const conflict = existingRows.find(
      (existing) => existing[c.column] === newVal && newVal !== null && newVal !== undefined,
    );
    if (conflict) {
      throw new ConstraintViolation(
        'unique', c.column,
        `UNIQUE violation: column "${c.column}" already has value "${String(newVal)}"`,
      );
    }
  }

  private async _checkCheck(c: CheckConstraint, row: Record<string, unknown>): Promise<void> {
    const value = row[c.column];
    const valid = await c.check(value, row);
    if (!valid) {
      throw new ConstraintViolation(
        'check', c.column,
        `CHECK violation: column "${c.column}"${c.name ? ` (${c.name})` : ''} rejected value "${String(value)}"`,
      );
    }
  }

  private async _checkForeignKey(
    c  : ForeignKeyConstraint,
    row: Record<string, unknown>,
  ): Promise<void> {
    const refValue = row[c.column];
    if (refValue === null || refValue === undefined || refValue === '__NULL__') return; // NULL FK is allowed

    const { table, tableName } = c.references;
    const refKey = table.deriveKey(tableName, BigInt(String(refValue)));
    const exists = await table.exists(refKey);
    if (!exists) {
      throw new ConstraintViolation(
        'fk', c.column,
        `FOREIGN KEY violation: column "${c.column}" references non-existent record "${String(refValue)}"`,
      );
    }
  }

  /**
   * ON DELETE CASCADE — delete all records in this table that reference
   * the deleted row in the foreign-key column.
   *
   * @param deletedValue  The primary-key value of the deleted parent record.
   * @param fkColumn      The column in this table that holds the FK.
   * @param ownedRecords  All decoded records in this table (to find referencing rows).
   * @param deleteRecord  Callback to actually delete a record by its bytes32 key.
   */
  async onDeleteCascade(
    deletedValue : unknown,
    fkColumn     : string,
    ownedRecords : { key: string; data: Record<string, unknown> }[],
    deleteRecord : (key: string) => Promise<unknown>,
  ): Promise<void> {
    const toDelete = ownedRecords.filter(
      (r) => String(r.data[fkColumn]) === String(deletedValue),
    );
    for (const r of toDelete) {
      await deleteRecord(r.key);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  AUTO_INCREMENT counter
// ─────────────────────────────────────────────────────────────

/**
 * Client-side AUTO_INCREMENT counter backed by a special meta record on-chain.
 *
 * The counter is stored as a JSON record encrypted for the table owner under
 * the key `keccak256("__auto_increment__" + tableName)`.
 *
 * ⚠  This is NOT atomic across multiple concurrent writers.
 *    For single-writer tables (personal data), it is safe.
 *    For multi-writer tables, use a relay-maintained counter (v1.2).
 */
export class AutoIncrementCounter {
  private tableName: string;
  private client   : EncryptedTableClient;
  private metaKey  : string;

  constructor(tableName: string, client: EncryptedTableClient) {
    this.tableName = tableName;
    this.client    = client;
    this.metaKey   = client.deriveKey(`__auto_increment__${tableName}`, 0n);
  }

  /**
   * Read the current counter value. Returns 0 if not yet initialised.
   */
  async current(): Promise<bigint> {
    try {
      const exists = await this.client.exists(this.metaKey);
      if (!exists) return 0n;
      const json = await this.client.readPlaintext(this.metaKey);
      const { counter } = JSON.parse(json) as { counter: string };
      return BigInt(counter);
    } catch {
      return 0n;
    }
  }

  /**
   * Atomically increment and return the next ID.
   * Reads current → increments → writes new value → returns incremented.
   */
  async next(): Promise<bigint> {
    const cur    = await this.current();
    const nextId = cur + 1n;
    const payload = JSON.stringify({ counter: nextId.toString() });

    if (cur === 0n) {
      await this.client.writeRaw(this.metaKey, payload);
    } else {
      await this.client.updateRaw(this.metaKey, payload);
    }

    return nextId;
  }

  /** Reset the counter (use with caution — may cause PK collisions). */
  async reset(to: bigint = 0n): Promise<void> {
    const payload = JSON.stringify({ counter: to.toString() });
    const cur = await this.current();
    if (cur === 0n) {
      await this.client.writeRaw(this.metaKey, payload);
    } else {
      await this.client.updateRaw(this.metaKey, payload);
    }
  }
}
