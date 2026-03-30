/**
 * @file   parser.ts
 * @notice SQL-like schema string → TableAst
 *
 * Supported syntax (v1):
 *   CREATE TABLE <name> (
 *     <col> <type> [PRIMARY KEY],
 *     ...
 *   );
 *
 * Supported types: INT, TEXT, BOOL, ADDRESS, FLOAT
 * Constraints: PRIMARY KEY (exactly one required)
 * NOT supported: JOINs, foreign keys, DEFAULT, UNIQUE (v1)
 */

import { FieldDef, SqlType, TableAst } from './types.js';

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

const SUPPORTED_TYPES = new Set<string>(['INT', 'TEXT', 'BOOL', 'ADDRESS', 'FLOAT']);

function assertType(raw: string): SqlType {
  const upper = raw.toUpperCase();
  if (!SUPPORTED_TYPES.has(upper)) {
    throw new Error(
      `Unsupported type: "${raw}". Supported: ${[...SUPPORTED_TYPES].join(', ')}`
    );
  }
  return upper as SqlType;
}

function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')    // single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, ''); // block comments
}

// ─────────────────────────────────────────────────────────────
//  Parser (single CREATE TABLE statement)
// ─────────────────────────────────────────────────────────────

/**
 * Parse a single CREATE TABLE statement into a TableAst.
 * Deterministic: same input always produces the same AST.
 *
 * @throws {Error} on any syntax or semantic violation.
 */
export function parseCreateTable(sql: string): TableAst {
  const clean = stripComments(sql)
    .replace(/\r\n|\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();

  // Match: CREATE TABLE <name> ( <body> ) ;?
  const match = clean.match(
    /^CREATE\s+TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*;?\s*$/i
  );
  if (!match) {
    throw new Error(
      'Invalid schema: expected "CREATE TABLE <name> (...);" ' +
      '— only a single CREATE TABLE per call in v1.'
    );
  }

  const tableName = match[1];
  const rawBody   = match[2];

  const fields: FieldDef[] = rawBody
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((col) => {
      const tokens  = col.split(/\s+/);
      const name    = tokens[0]?.toLowerCase();
      const rawType = tokens[1];

      if (!name || !rawType) {
        throw new Error(`Invalid column definition: "${col}"`);
      }

      const type    = assertType(rawType);
      const primary = /PRIMARY\s+KEY/i.test(col);

      return { name, type, primary, nullable: false };
    });

  if (fields.length === 0) {
    throw new Error(`Table "${tableName}" must have at least one column.`);
  }

  const primaryKeys = fields.filter((f) => f.primary);
  if (primaryKeys.length === 0) {
    throw new Error(`Table "${tableName}" must have exactly one PRIMARY KEY column.`);
  }
  if (primaryKeys.length > 1) {
    throw new Error(
      `Table "${tableName}" has ${primaryKeys.length} PRIMARY KEY columns; ` +
      'only one is supported in v1.'
    );
  }

  const pk = primaryKeys[0];
  if (pk.type !== 'INT') {
    throw new Error(
      `PRIMARY KEY must be of type INT (got "${pk.type}"). ` +
      'Only integer primary keys are supported in v1.'
    );
  }

  return { table: tableName, fields };
}

/**
 * Parse a schema string that may contain MULTIPLE CREATE TABLE statements.
 * Each statement is parsed independently.
 */
export function parseSchema(schema: string): TableAst[] {
  const clean = stripComments(schema).trim();

  // Split on statement boundaries — each CREATE TABLE...); block
  const statements = clean
    .split(/(?=CREATE\s+TABLE\s)/i)
    .map((s) => s.trim())
    .filter(Boolean);

  if (statements.length === 0) {
    throw new Error('No CREATE TABLE statements found in schema.');
  }

  return statements.map((stmt) => parseCreateTable(stmt));
}
