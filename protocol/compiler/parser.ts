/**
 * @file   parser.ts
 * @notice SQL-like schema string → TableAst
 *
 * Supported syntax (v1):
 *   CREATE TABLE <name> (
 *     <col> <type> [PRIMARY KEY] [COUNTER],
 *     ...
 *     [WIRE TO <target_table>
 *       MATCH  <source_field> = <target_field>
 *       UPDATES <field> += payment|<number> [...]
 *       [RULES  [MIN_PAYMENT <wei>] [ONCE_PER_ADDRESS] [FEE_BPS <n>] [FEE_RECIPIENT <addr>]]
 *     ]
 *   );
 *
 * Supported types: INT, TEXT, BOOL, ADDRESS, FLOAT, UINT256
 * Constraints: PRIMARY KEY (exactly one required), COUNTER
 * WIRE TO: zero or more per table
 */

import { FieldDef, SqlType, TableAst, WireDef, WireRules, WireUpdate } from './types.js';

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

const SUPPORTED_TYPES = new Set<string>([
  'INT', 'TEXT', 'BOOL', 'ADDRESS', 'FLOAT',
  'TIMESTAMP', 'DATE', 'UUID', 'BYTES32', 'JSON', 'ENUM', 'DECIMAL', 'BIGINT',
  'UINT256',
]);

/** Legacy SQL aliases → canonical SqlType */
const TYPE_ALIASES: Record<string, string> = {
  INTEGER:   'INT',
  BOOLEAN:   'BOOL',
  REAL:      'FLOAT',
  DOUBLE:    'FLOAT',
  NUMERIC:   'DECIMAL',
  VARCHAR:   'TEXT',
  CHAR:      'TEXT',
  BLOB:      'BYTES32',
  DATETIME:  'TIMESTAMP',
  TINYINT:   'INT',
  SMALLINT:  'INT',
  BIGINT:    'BIGINT',
  UINT256:   'UINT256',
  // PAYABLE is a field modifier (handled before assertType); not a standalone type
};

function assertType(raw: string): SqlType {
  // Strip parenthetical modifiers: DECIMAL(10,2) → DECIMAL, VARCHAR(255) → VARCHAR
  const bare  = raw.toUpperCase().replace(/\(.*\)$/, '');
  const upper = TYPE_ALIASES[bare] ?? bare;
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
//  Wire helpers
// ─────────────────────────────────────────────────────────────

/**
 * Extract and remove WIRE TO blocks from the raw table body.
 * Returns { columnBody, wires } where columnBody has WIRE TO sections removed.
 *
 * A WIRE TO block starts with the keyword WIRE (case-insensitive) at the
 * beginning of a comma-separated clause and runs to the end of the body
 * (multiple wires possible).
 */
function extractWireBlocks(rawBody: string): { columnBody: string; wires: WireDef[] } {
  // Normalize whitespace for easier matching
  const body = rawBody.replace(/\s+/g, ' ').trim();

  // Find the position of the first WIRE TO keyword at a token boundary
  const wireIdx = body.search(/(?:^|,)\s*WIRE\s+TO\s/i);
  if (wireIdx === -1) {
    return { columnBody: body, wires: [] };
  }

  // Everything before the first WIRE is column defs
  const columnBody = body.slice(0, wireIdx).replace(/,\s*$/, '').trim();

  // Everything from the first WIRE onward
  const wireSection = body.slice(wireIdx).replace(/^,\s*/, '');

  // Split on WIRE TO boundaries to handle multiple wires
  const wireBlocks = wireSection
    .split(/(?=WIRE\s+TO\s)/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const wires: WireDef[] = wireBlocks.map(parseWireBlock);
  return { columnBody, wires };
}

/**
 * Parse a single WIRE TO block:
 *   WIRE TO <target>
 *     MATCH <sourceField> = <targetField>
 *     UPDATES <field> += payment|<number> [...]
 *     [RULES ...]
 */
function parseWireBlock(block: string): WireDef {
  const s = block.replace(/\s+/g, ' ').trim();

  // --- WIRE TO <target_table> ---
  const toMatch = s.match(/^WIRE\s+TO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
  if (!toMatch) throw new Error(`WIRE block has no valid target table: "${s.slice(0, 40)}"`);
  const targetTable = toMatch[1]!.toLowerCase();

  // --- MATCH <source> = <target> ---
  const matchMatch = s.match(/MATCH\s+([a-zA-Z_]\w*)\s*=\s*([a-zA-Z_]\w*)/i);
  if (!matchMatch) throw new Error(`WIRE TO ${targetTable}: missing MATCH clause`);
  const matchSource = matchMatch[1]!.toLowerCase();
  const matchTarget = matchMatch[2]!.toLowerCase();

  // --- UPDATES <field> += <value> [<field2> += <value2> ...] ---
  const updatesMatch = s.match(/UPDATES\s+(.+?)(?=\s+RULES\s|$)/i);
  if (!updatesMatch) throw new Error(`WIRE TO ${targetTable}: missing UPDATES clause`);
  const updatesRaw = updatesMatch[1]!.trim();

  // Each update: "<field> += payment" or "<field> += <number>"
  const updateParts = updatesRaw.split(/\s+(?=[a-zA-Z_]\w*\s*\+=)/g);
  const updates: WireUpdate[] = updateParts.map((part) => {
    const m = part.match(/([a-zA-Z_]\w*)\s*\+=\s*(payment|[0-9]+(?:\.[0-9]+)?)/i);
    if (!m) throw new Error(`WIRE TO ${targetTable}: invalid update "${part}"`);
    const rawVal = m[2]!.toLowerCase();
    return {
      targetField: m[1]!.toLowerCase(),
      value: rawVal === 'payment' ? 'payment' : Number(rawVal),
    };
  });

  // --- RULES (optional) ---
  const rules: WireRules = {};
  const rulesMatch = s.match(/RULES\s+(.+)$/i);
  if (rulesMatch) {
    const rulesStr = rulesMatch[1]!.toUpperCase();
    const rulesRaw = rulesMatch[1]!; // preserve case for addresses
    const minPayMatch = rulesStr.match(/MIN_PAYMENT\s+([0-9]+(?:\.[0-9]+)?)/);
    if (minPayMatch) rules.minPayment = Number(minPayMatch[1]);
    const maxPayMatch = rulesStr.match(/MAX_PAYMENT\s+([0-9]+(?:\.[0-9]+)?)/);
    if (maxPayMatch) rules.maxPayment = Number(maxPayMatch[1]);
    if (/ONCE_PER_ADDRESS/.test(rulesStr)) rules.oncePerAddress = true;
    const feeBpsMatch = rulesStr.match(/FEE_BPS\s+([0-9]+)/);
    if (feeBpsMatch) rules.feeBps = Number(feeBpsMatch[1]);
    const feeRecipMatch = rulesRaw.match(/FEE_RECIPIENT\s+(0x[0-9a-fA-F]{40})/i);
    if (feeRecipMatch) rules.feeRecipient = feeRecipMatch[1]!;

    // ALLOWED_TOKENS native,0xabc123,...  or  ALLOWED_TOKENS 0xabc123 0xdef456
    const tokensMatch = rulesRaw.match(/ALLOWED_TOKENS\s+([^\s][^\n]+)/i);
    if (tokensMatch) {
      const rawTokens = tokensMatch[1]!.trim().split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
      rules.allowedTokens = rawTokens.map((t) =>
        t.toLowerCase() === 'native' ? '0x0000000000000000000000000000000000000000' : t
      );
    }

    // TOKEN_MIN_AMOUNTS <n1>[,<n2>...]  (parallel to ALLOWED_TOKENS)
    const minAmtsMatch = rulesStr.match(/TOKEN_MIN_AMOUNTS\s+([0-9,\s]+)/);
    if (minAmtsMatch) {
      rules.tokenMinAmounts = minAmtsMatch[1]!.trim().split(/[,\s]+/).filter(Boolean).map(Number);
    }

    // TOKEN_MAX_AMOUNTS <n1>[,<n2>...]  (parallel to ALLOWED_TOKENS)
    const maxAmtsMatch = rulesStr.match(/TOKEN_MAX_AMOUNTS\s+([0-9,\s]+)/);
    if (maxAmtsMatch) {
      rules.tokenMaxAmounts = maxAmtsMatch[1]!.trim().split(/[,\s]+/).filter(Boolean).map(Number);
    }
  }

  return { targetTable, matchSource, matchTarget, updates, rules };
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

  // ── Extract WIRE TO blocks before column parsing ──────────────
  const { columnBody, wires } = extractWireBlocks(rawBody!);

  const fields: FieldDef[] = columnBody
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

      // PAYABLE is a field modifier: `amount PAYABLE` or `amount UINT256 PAYABLE`
      // Detect it BEFORE resolving the type so we never pass 'PAYABLE' to assertType.
      const isPayable    = /\bPAYABLE\b/i.test(col);
      const effectiveRaw = isPayable && rawType.toUpperCase() === 'PAYABLE' ? 'UINT256' : rawType;

      const type    = assertType(effectiveRaw);
      const primary = /PRIMARY\s+KEY/i.test(col);
      const counter = /\bCOUNTER\b/i.test(col);
      const payable = isPayable;

      return { name, type: payable ? 'UINT256' : type, primary, nullable: false,
               ...(counter ? { counter: true } : {}),
               ...(payable ? { payable: true } : {}) };
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
  const PK_TYPES = new Set<string>(['INT', 'TEXT', 'UUID', 'BYTES32', 'BIGINT']);
  if (!PK_TYPES.has(pk!.type)) {
    throw new Error(
      `PRIMARY KEY must be INT, TEXT, UUID, BYTES32, or BIGINT (got "${pk!.type}").`
    );
  }

  return { table: tableName!, fields, ...(wires.length > 0 ? { wires } : {}) };
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
