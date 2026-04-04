/**
 * @file   types.ts
 * @notice Web3QL v1.1 — extended type system with serialization, validation,
 *         DEFAULT/NOT NULL enforcement, and codec helpers.
 *
 * Every type maps: JS value ↔ JSON-storable "wire" representation.
 * The chain stores the JSON string; this module handles encode/decode.
 */

// ─────────────────────────────────────────────────────────────
//  Field type literal union
// ─────────────────────────────────────────────────────────────

export type FieldType =
  | 'INT'       // bigint ↔ decimal string (int256)
  | 'BIGINT'    // bigint ↔ decimal string (uint256)
  | 'UINT8'     // number (0–255) ↔ number
  | 'UINT16'    // number (0–65535) ↔ number
  | 'UINT32'    // number (0–4294967295) ↔ number
  | 'UINT64'    // bigint ↔ decimal string
  | 'TEXT'      // string ↔ string
  | 'BOOL'      // boolean ↔ boolean
  | 'FLOAT'     // number ↔ number (stored scaled × 1e6 as integer)
  | 'ADDRESS'   // string (0x…) ↔ string, lowercased
  | 'TIMESTAMP' // Date ↔ number (unix ms)
  | 'DATE'      // Date ↔ number (unix ms of midnight UTC)
  | 'UUID'      // string (36 chars) ↔ string
  | 'BYTES32'   // string (0x-prefixed, 66 chars) ↔ string
  | 'JSON'      // unknown ↔ unknown (validated as parseable JSON)
  | 'JSONB'     // alias for JSON — schema-less document storage
  | 'ENUM'      // string (label) ↔ number (index)
  | 'DECIMAL';  // number ↔ string (exact decimal, no float rounding)

/** Sentinel value stored on-chain when a nullable field has no value. */
export const NULL_SENTINEL = '__NULL__';

// ─────────────────────────────────────────────────────────────
//  Field descriptor
// ─────────────────────────────────────────────────────────────

export interface FieldDescriptor {
  name       : string;
  type       : FieldType;
  primaryKey?: boolean;
  notNull?   : boolean;
  /** Static default value OR factory function called on each write */
  default?   : unknown | (() => unknown);
  /** ENUM: ordered list of string labels */
  enumValues?: string[];
  /** DECIMAL: [totalDigits, decimalPlaces] */
  precision? : [number, number];
}

export type SchemaDefinition = FieldDescriptor[];

// ─────────────────────────────────────────────────────────────
//  Type codecs  (encode: JS → wire,  decode: wire → JS)
// ─────────────────────────────────────────────────────────────

function encodeInt(v: unknown): number | string {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Math.trunc(v).toString();
  return String(v);
}
function decodeInt(v: unknown): bigint { return BigInt(String(v)); }

function encodeFloat(v: unknown): number {
  const n = Number(v);
  if (!isFinite(n)) throw new TypeError(`FLOAT: expected finite number, got ${v}`);
  // Store as scaled integer to avoid float drift
  return Math.round(n * 1_000_000);
}
function decodeFloat(v: unknown): number { return Number(v) / 1_000_000; }

function encodeTimestamp(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return new Date(v).getTime();
  throw new TypeError(`TIMESTAMP: expected Date or number, got ${typeof v}`);
}
function decodeTimestamp(v: unknown): Date { return new Date(Number(v)); }

function encodeDate(v: unknown): number {
  const ms = encodeTimestamp(v);
  // Truncate to midnight UTC
  return ms - (ms % 86_400_000);
}
function decodeDate(v: unknown): Date {
  const d = new Date(Number(v));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function encodeUUID(v: unknown): string {
  const s = String(v).toLowerCase();
  if (!UUID_RE.test(s)) throw new TypeError(`UUID: invalid format "${s}"`);
  return s;
}

const BYTES32_RE = /^0x[0-9a-f]{64}$/i;
function encodeBytes32(v: unknown): string {
  const s = String(v).toLowerCase();
  if (!BYTES32_RE.test(s)) throw new TypeError(`BYTES32: expected 0x-prefixed 64-hex-char string, got "${s}"`);
  return s;
}

const ADDRESS_RE = /^0x[0-9a-f]{40}$/i;
function encodeAddress(v: unknown): string {
  const s = String(v).toLowerCase();
  if (!ADDRESS_RE.test(s)) throw new TypeError(`ADDRESS: invalid EVM address "${s}"`);
  return s;
}

function encodeUint(bits: 8 | 16 | 32, v: unknown): number {
  const n = Number(v);
  const max = bits === 8 ? 255 : bits === 16 ? 65535 : 4294967295;
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw new RangeError(`UINT${bits}: value ${n} out of range [0, ${max}]`);
  }
  return n;
}

function encodeUint64(v: unknown): string {
  const n = BigInt(String(v));
  if (n < 0n) throw new RangeError(`UINT64: value must be non-negative`);
  return n.toString();
}

function encodeJSON(v: unknown): unknown {
  // Validate it round-trips cleanly
  JSON.parse(JSON.stringify(v));
  return v;
}

function encodeEnum(field: FieldDescriptor, v: unknown): number {
  const labels = field.enumValues ?? [];
  if (typeof v === 'number') {
    if (v < 0 || v >= labels.length) throw new RangeError(`ENUM: index ${v} out of range [0,${labels.length})`);
    return v;
  }
  const idx = labels.indexOf(String(v));
  if (idx === -1) throw new TypeError(`ENUM: "${v}" not in [${labels.join(', ')}]`);
  return idx;
}
function decodeEnum(field: FieldDescriptor, v: unknown): string {
  const labels = field.enumValues ?? [];
  const idx    = Number(v);
  return labels[idx] ?? String(v);
}

function encodeDecimal(field: FieldDescriptor, v: unknown): string {
  const n = Number(v);
  if (!isFinite(n)) throw new TypeError(`DECIMAL: expected finite number, got ${v}`);
  const scale = field.precision?.[1] ?? 2;
  return n.toFixed(scale);
}
function decodeDecimal(v: unknown): number { return parseFloat(String(v)); }

// ─────────────────────────────────────────────────────────────
//  Public encode / decode helpers
// ─────────────────────────────────────────────────────────────

/** Encode a JS value → wire format (to be JSON-stringified and stored). */
export function encodeFieldValue(field: FieldDescriptor, value: unknown): unknown {
  switch (field.type) {
    case 'INT':
    case 'BIGINT':    return encodeInt(value);
    case 'UINT8':     return encodeUint(8, value);
    case 'UINT16':    return encodeUint(16, value);
    case 'UINT32':    return encodeUint(32, value);
    case 'UINT64':    return encodeUint64(value);
    case 'TEXT':      return String(value);
    case 'BOOL':      return Boolean(value);
    case 'FLOAT':     return encodeFloat(value);
    case 'ADDRESS':   return encodeAddress(value);
    case 'TIMESTAMP': return encodeTimestamp(value);
    case 'DATE':      return encodeDate(value);
    case 'UUID':      return encodeUUID(value);
    case 'BYTES32':   return encodeBytes32(value);
    case 'JSON':
    case 'JSONB':     return encodeJSON(value);
    case 'ENUM':      return encodeEnum(field, value);
    case 'DECIMAL':   return encodeDecimal(field, value);
  }
}

/** Decode a wire-format value → typed JS value. */
export function decodeFieldValue(field: FieldDescriptor, value: unknown): unknown {
  if (value === NULL_SENTINEL) return null;
  if (value === null || value === undefined) return value;
  switch (field.type) {
    case 'INT':
    case 'BIGINT':    return decodeInt(value);
    case 'UINT64':    return BigInt(String(value));
    case 'UINT8':
    case 'UINT16':
    case 'UINT32':    return Number(value);
    case 'TEXT':
    case 'UUID':
    case 'BYTES32':
    case 'ADDRESS':   return String(value);
    case 'BOOL':      return Boolean(value);
    case 'FLOAT':     return decodeFloat(value);
    case 'TIMESTAMP': return decodeTimestamp(value);
    case 'DATE':      return decodeDate(value);
    case 'JSON':
    case 'JSONB':     return value;
    case 'ENUM':      return decodeEnum(field, value);
    case 'DECIMAL':   return decodeDecimal(value);
  }
}

// ─────────────────────────────────────────────────────────────
//  Row-level validation — NOT NULL + DEFAULT + type coerce
// ─────────────────────────────────────────────────────────────

/**
 * Validate and normalise a plain JS object before writing to the chain.
 *
 * • Applies DEFAULT values for missing fields
 * • Enforces NOT NULL for fields without a default
 * • Encodes each field to its wire representation
 *
 * @param schema  SchemaDefinition for this table
 * @param row     Raw user input object
 * @returns       Wire-ready object (to be JSON.stringify'd and encrypted)
 */
export function validateAndEncode(
  schema: SchemaDefinition,
  row   : Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const field of schema) {
    let value = row[field.name];

    // Apply default if value is absent
    if (value === undefined || value === null) {
      if (field.default !== undefined) {
        value = typeof field.default === 'function'
          ? (field.default as () => unknown)()
          : field.default;
      }
    }

    // NOT NULL enforcement
    if ((value === undefined || value === null) && field.notNull) {
      throw new TypeError(
        `Field "${field.name}" is NOT NULL but no value or default was provided.`
      );
    }

    // Skip truly absent optional fields (store as NULL_SENTINEL for type safety)
    if (value === undefined || value === null) {
      out[field.name] = NULL_SENTINEL;
      continue;
    }

    out[field.name] = encodeFieldValue(field, value);
  }

  return out;
}

/**
 * Decode a wire-format JSON object back to typed JS values.
 *
 * @param schema  SchemaDefinition for this table
 * @param wire    Object from JSON.parse(plaintext)
 */
export function decodeRow(
  schema: SchemaDefinition,
  wire  : Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const byName = new Map(schema.map((f) => [f.name, f]));

  for (const [key, value] of Object.entries(wire)) {
    const field = byName.get(key);
    out[key] = field ? decodeFieldValue(field, value) : value;
  }
  return out;
}
