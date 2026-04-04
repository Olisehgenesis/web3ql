/**
 * @file   migrations.ts
 * @notice Web3QL v1.1 — schema migration framework.
 *
 * Because schemas are stored as bytes on-chain, adding or removing columns
 * is an off-chain SDK concern:
 *
 *   • ADD COLUMN  → new field appears with its DEFAULT value for old records
 *   • DROP COLUMN → field is silently ignored on read, omitted on write
 *   • RENAME      → read uses old name, write uses new name
 *   • CHANGE TYPE → codec changes; old wire values are transparently converted
 *
 * Migrations are run client-side during read/write. They do NOT require any
 * contract call or gas. The on-chain ciphertext is re-encrypted with the new
 * schema on the next write (lazy migration).
 *
 * Usage:
 * ─────────────────────────────────────────────────────────────
 *   const migrations = new MigrationRunner([
 *     {
 *       version: 1,
 *       description: 'Add role field',
 *       up: addColumn({ name: 'role', type: 'ENUM', enumValues: ['user','admin'], default: 'user' }),
 *     },
 *     {
 *       version: 2,
 *       description: 'Rename email → emailAddress',
 *       up: renameColumn('email', 'emailAddress'),
 *     },
 *     {
 *       version: 3,
 *       description: 'Drop legacy field',
 *       up: dropColumn('legacyField'),
 *     },
 *   ]);
 *
 *   // Apply to a record read from chain
 *   const migratedData = migrations.applyToRecord(rawDecoded, fromVersion = 0);
 *
 *   // Apply to a schema definition (for TypedTableClient)
 *   const latestSchema = migrations.applyToSchema(v0Schema);
 * ─────────────────────────────────────────────────────────────
 */

import type { SchemaDefinition, FieldDescriptor } from './types.js';

// ─────────────────────────────────────────────────────────────
//  Row transformer type
// ─────────────────────────────────────────────────────────────

export type RowTransformer = (row: Record<string, unknown>) => Record<string, unknown>;
export type SchemaTransformer = (schema: SchemaDefinition) => SchemaDefinition;

export interface Migration {
  /** Monotonically increasing version number (1, 2, 3…) */
  version    : number;
  description: string;
  /** Transform the row data from previous version to this version */
  up         : RowTransformer;
  /** Transform the schema definition from previous version to this version */
  schema?    : SchemaTransformer;
}

// ─────────────────────────────────────────────────────────────
//  Built-in migration helpers
// ─────────────────────────────────────────────────────────────

/**
 * ADD COLUMN — inserts the field with its default value into records
 * that don't have it yet.
 */
export function addColumn(field: FieldDescriptor): RowTransformer {
  return (row) => {
    if (row[field.name] !== undefined && row[field.name] !== null) return row;
    const defaultVal = field.default != null
      ? (typeof field.default === 'function' ? (field.default as () => unknown)() : field.default)
      : null;
    return { ...row, [field.name]: defaultVal };
  };
}

/** Schema variant of addColumn */
export function addColumnSchema(field: FieldDescriptor): SchemaTransformer {
  return (schema) => {
    if (schema.some((f) => f.name === field.name)) return schema;
    return [...schema, field];
  };
}

/**
 * DROP COLUMN — removes the field from records.
 * Old ciphertext data is discarded on next write.
 */
export function dropColumn(fieldName: string): RowTransformer {
  return (row) => {
    const out = { ...row };
    delete out[fieldName];
    return out;
  };
}

/** Schema variant of dropColumn */
export function dropColumnSchema(fieldName: string): SchemaTransformer {
  return (schema) => schema.filter((f) => f.name !== fieldName);
}

/**
 * RENAME COLUMN — moves value from oldName to newName.
 */
export function renameColumn(oldName: string, newName: string): RowTransformer {
  return (row) => {
    if (!(oldName in row)) return row;
    const out = { ...row, [newName]: row[oldName] };
    delete out[oldName];
    return out;
  };
}

/** Schema variant of renameColumn */
export function renameColumnSchema(oldName: string, newName: string): SchemaTransformer {
  return (schema) =>
    schema.map((f) => (f.name === oldName ? { ...f, name: newName } : f));
}

/**
 * CHANGE TYPE — re-encode a field's value through a transform function.
 * Supply a function that converts the old wire value to the new wire value.
 *
 * @example
 *   // Convert TEXT → TIMESTAMP (ISO string → unix ms)
 *   changeType('createdAt', (v) => new Date(String(v)).getTime())
 */
export function changeType(
  fieldName: string,
  transform: (oldValue: unknown) => unknown,
): RowTransformer {
  return (row) => {
    if (!(fieldName in row)) return row;
    return { ...row, [fieldName]: transform(row[fieldName]) };
  };
}

/**
 * COMPUTE COLUMN — derive a new field from existing fields.
 * Called only if the field is absent (so it doesn't overwrite on re-migrations).
 */
export function computeColumn(
  fieldName: string,
  compute  : (row: Record<string, unknown>) => unknown,
): RowTransformer {
  return (row) => {
    if (row[fieldName] !== undefined && row[fieldName] !== null) return row;
    return { ...row, [fieldName]: compute(row) };
  };
}

// ─────────────────────────────────────────────────────────────
//  MigrationRunner
// ─────────────────────────────────────────────────────────────

export class MigrationRunner {
  private migrations: Migration[];

  constructor(migrations: Migration[]) {
    // Sort ascending by version
    this.migrations = [...migrations].sort((a, b) => a.version - b.version);
  }

  /**
   * Apply all migrations with version > `fromVersion` to a single record row.
   *
   * @param row          Decoded record from the chain (before migration)
   * @param fromVersion  The schema version the record was written at. Use the
   *                     VERSION field stored in the record, or 0 if absent.
   */
  applyToRecord(
    row        : Record<string, unknown>,
    fromVersion: number = 0,
  ): Record<string, unknown> {
    let current = { ...row };
    for (const m of this.migrations) {
      if (m.version > fromVersion) {
        current = m.up(current);
      }
    }
    return current;
  }

  /**
   * Apply all schema migrations from `fromVersion` to the latest version,
   * producing an up-to-date SchemaDefinition for TypedTableClient.
   */
  applyToSchema(
    baseSchema : SchemaDefinition,
    fromVersion: number = 0,
  ): SchemaDefinition {
    let schema = [...baseSchema];
    for (const m of this.migrations) {
      if (m.version > fromVersion && m.schema) {
        schema = m.schema(schema);
      }
    }
    return schema;
  }

  /** The latest migration version number. */
  get latestVersion(): number {
    return this.migrations.at(-1)?.version ?? 0;
  }

  /** List all registered migrations in version order. */
  list(): { version: number; description: string }[] {
    return this.migrations.map(({ version, description }) => ({ version, description }));
  }
}
