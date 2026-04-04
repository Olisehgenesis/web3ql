/**
 * Schema encoding/decoding for Web3QL tables.
 * Schema is stored as UTF-8 bytes encoded as hex on-chain.
 *
 * Canonical type names (matching the @web3ql/compiler):
 *   INT, TEXT, BOOL, ADDRESS, FLOAT
 * Legacy aliases (accepted on input, normalised on output):
 *   INTEGER → INT, BOOLEAN → BOOL, REAL → FLOAT
 */

export type CanonicalType = 'TEXT' | 'INT' | 'BOOL' | 'ADDRESS' | 'FLOAT'
export type AliasType     = 'INTEGER' | 'BOOLEAN' | 'REAL' | 'BLOB'

export interface SchemaField {
  name: string
  type: CanonicalType | AliasType
  primaryKey?: boolean
  notNull?: boolean
}

/** Map legacy SQLite-style type names to canonical Web3QL types. */
function normalizeType(raw: string): CanonicalType {
  const map: Record<string, CanonicalType> = {
    INTEGER: 'INT',
    BOOLEAN: 'BOOL',
    REAL:    'FLOAT',
    BLOB:    'TEXT', // store blobs as TEXT (hex) in v1
  }
  const upper = raw.toUpperCase() as CanonicalType | AliasType
  return (map[upper] ?? upper) as CanonicalType
}

export function schemaToSQL(tableName: string, fields: SchemaField[]): string {
  if (!fields.length) return ''
  const cols = fields.map((f) => {
    const type = normalizeType(String(f.type))
    let col = `  ${f.name} ${type}`
    if (f.primaryKey) col += ' PRIMARY KEY'
    if (f.notNull && !f.primaryKey) col += ' NOT NULL'
    return col
  })
  return `CREATE TABLE ${tableName} (\n${cols.join(',\n')}\n);`
}

export function parseSQLToFields(sql: string): SchemaField[] {
  const match = sql.match(/CREATE\s+TABLE\s+\w+\s*\(([^)]+)\)/i)
  if (!match) return []

  return match[1]
    .split(',')
    .map((col) => col.trim())
    .filter(Boolean)
    .map((col) => {
      const parts = col.split(/\s+/)
      const name = parts[0]
      const rawType = (parts[1] ?? 'TEXT').toUpperCase()
      const type = normalizeType(rawType)
      const rest = col.toUpperCase()
      return {
        name,
        type,
        primaryKey: rest.includes('PRIMARY KEY'),
        notNull: rest.includes('NOT NULL'),
      }
    })
}

export function encodeSchema(schema: string): `0x${string}` {
  const bytes = new TextEncoder().encode(schema)
  return ('0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}

export function decodeSchema(hex: `0x${string}` | string | undefined): string {
  if (!hex) return ''
  try {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex
    const bytes = new Uint8Array(clean.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [])
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}
