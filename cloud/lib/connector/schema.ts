/**
 * Minimal SQL schema validator — inlined from protocol/compiler/parser.ts.
 * Validates CREATE TABLE syntax, then returns the raw SQL as 0x-prefixed UTF-8 bytes
 * (the canonical on-chain storage format used by the cloud UI and SDK).
 */

const SUPPORTED_TYPES = new Set(['INT', 'TEXT', 'BOOL', 'ADDRESS', 'FLOAT'])

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

function validateCreateTable(sql: string): void {
  const clean = stripComments(sql)
    .replace(/\r\n|\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()

  const match = clean.match(
    /^CREATE\s+TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*;?\s*$/i,
  )
  if (!match) {
    throw new Error('Invalid schema: expected "CREATE TABLE <name> (...);"')
  }

  const tableName = match[1]
  const rawBody   = match[2]

  const fields = rawBody
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((col) => {
      const tokens  = col.split(/\s+/)
      const rawType = tokens[1]
      if (!tokens[0] || !rawType) throw new Error(`Invalid column definition: "${col}"`)
      const upper = rawType.toUpperCase()
      if (!SUPPORTED_TYPES.has(upper)) {
        throw new Error(`Unsupported type "${rawType}". Supported: ${[...SUPPORTED_TYPES].join(', ')}`)
      }
      return { type: upper, primary: /PRIMARY\s+KEY/i.test(col) }
    })

  if (fields.length === 0) throw new Error(`Table "${tableName}" must have at least one column.`)

  const pks = fields.filter((f) => f.primary)
  if (pks.length === 0) throw new Error(`Table "${tableName}" must have exactly one PRIMARY KEY column.`)
  if (pks.length > 1)   throw new Error(`Table "${tableName}" has ${pks.length} PRIMARY KEY columns; only one is supported.`)
  if (pks[0].type !== 'INT') throw new Error('PRIMARY KEY must be of type INT.')
}

/**
 * Validate a SQL schema string and return it as 0x-prefixed UTF-8 bytes.
 * Throws if the schema is invalid.
 */
export function compileSchemaToBytes(schema: string): string {
  const clean = stripComments(schema).trim()
  const stmts = clean
    .split(/(?=CREATE\s+TABLE\s)/i)
    .map((s) => s.trim())
    .filter(Boolean)

  if (stmts.length === 0) throw new Error('No CREATE TABLE statements found in schema.')
  stmts.forEach(validateCreateTable)

  return '0x' + Buffer.from(schema.trim(), 'utf8').toString('hex')
}
