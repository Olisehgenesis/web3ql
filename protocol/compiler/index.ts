/**
 * @file   index.ts
 * @notice Main entry point for @web3ql/compiler.
 *
 * Usage:
 *   import { compileSchema, parseSchema, generateTable } from '@web3ql/compiler';
 *
 *   const results = compileSchema(fs.readFileSync('schema.sql', 'utf8'));
 *   // results[0].solidity, results[0].abi, results[0].sdkBindings ...
 */

export { parseCreateTable, parseSchema } from './parser.js';
export { generateTable }                from './generator.js';
export * from './types.js';

import { parseSchema }   from './parser.js';
import { generateTable } from './generator.js';
import type { CompilerOutput } from './types.js';

/**
 * Full pipeline: SQL schema string → array of CompilerOutput (one per table).
 * Deterministic: same input always produces same output.
 *
 * @param schema  Raw SQL-like schema string (one or more CREATE TABLE statements).
 * @returns       Array of compiled table outputs.
 */
export function compileSchema(schema: string): CompilerOutput[] {
  const asts = parseSchema(schema);
  return asts.map(generateTable);
}
