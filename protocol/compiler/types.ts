/**
 * @file   types.ts
 * @notice Shared types for the Web3QL compiler.
 */

// ─────────────────────────────────────────────────────────────
//  SQL-like AST
// ─────────────────────────────────────────────────────────────

export type SqlType =
  | 'INT'
  | 'TEXT'
  | 'BOOL'
  | 'ADDRESS'
  | 'FLOAT'     // stored as scaled INT (6 decimals)
  | 'TIMESTAMP' // stored as INT (unix epoch ms)
  | 'DATE'      // stored as INT (unix epoch, day precision)
  | 'UUID'      // stored as TEXT (36-char canonical form)
  | 'BYTES32'   // stored as TEXT (0x-prefixed hex, 66 chars)
  | 'JSON'      // stored as TEXT, validated on write
  | 'ENUM'      // stored as INT index; label map in schema meta
  | 'DECIMAL'   // stored as INT scaled by 10^scale
  | 'BIGINT';   // alias for INT / uint256

export interface FieldDef {
  name       : string;
  type       : SqlType;
  primary    : boolean;
  nullable   : boolean;
  /** For ENUM: comma-separated label list stored in schema meta */
  enumValues?: string[];
  /** For DECIMAL: [precision, scale] */
  precision? : [number, number];
  /** SDK-level default value (stored in schema meta) */
  defaultVal?: unknown;
}

export interface TableAst {
  table : string;
  fields: FieldDef[];
}

// ─────────────────────────────────────────────────────────────
//  Compiler output
// ─────────────────────────────────────────────────────────────

export interface AbiParam {
  name     : string;
  type     : string;
  internalType?: string;
  components?  : AbiParam[];
}

export interface AbiFunctionDef {
  type            : 'function' | 'event' | 'constructor' | 'receive' | 'fallback';
  name?           : string;
  inputs          : AbiParam[];
  outputs?        : AbiParam[];
  stateMutability?: 'pure' | 'view' | 'nonpayable' | 'payable';
  anonymous?      : boolean;
}

export type Abi = AbiFunctionDef[];

export interface CompilerOutput {
  ast          : TableAst;
  contractName : string;
  solidity     : string;
  sdkBindings  : string;   // TypeScript SDK bindings for this table
  abi          : Abi;
  schemaBytes  : string;   // hex-encoded ABI-encoded schema for on-chain storage
}

// ─────────────────────────────────────────────────────────────
//  Solidity type mapping
// ─────────────────────────────────────────────────────────────

export const SQL_TO_SOLIDITY: Record<SqlType, string> = {
  INT      : 'uint256',
  TEXT     : 'string',
  BOOL     : 'bool',
  ADDRESS  : 'address',
  FLOAT    : 'int256',   // scaled by 1e6; encode/decode off-chain
  TIMESTAMP: 'uint256',  // unix epoch ms
  DATE     : 'uint256',  // unix epoch days
  UUID     : 'string',   // 36-char canonical form
  BYTES32  : 'bytes32',
  JSON     : 'string',   // raw JSON string
  ENUM     : 'uint8',    // int index into label array
  DECIMAL  : 'int256',   // scaled by 10^scale
  BIGINT   : 'uint256',
};

export const SQL_TO_TS: Record<SqlType, string> = {
  INT      : 'bigint',
  TEXT     : 'string',
  BOOL     : 'boolean',
  ADDRESS  : 'string',
  FLOAT    : 'number',
  TIMESTAMP: 'Date',
  DATE     : 'Date',
  UUID     : 'string',
  BYTES32  : 'string',
  JSON     : 'unknown',
  ENUM     : 'string',   // decoded to label string
  DECIMAL  : 'number',
  BIGINT   : 'bigint',
};
