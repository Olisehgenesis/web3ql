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
  | 'FLOAT'; // stored as scaled INT (6 decimals)

export interface FieldDef {
  name    : string;
  type    : SqlType;
  primary : boolean;
  nullable: boolean; // reserved — all fields non-null in v1
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
  INT    : 'uint256',
  TEXT   : 'string',
  BOOL   : 'bool',
  ADDRESS: 'address',
  FLOAT  : 'int256', // scaled by 1e6; encode/decode off-chain
};

export const SQL_TO_TS: Record<SqlType, string> = {
  INT    : 'bigint',
  TEXT   : 'string',
  BOOL   : 'boolean',
  ADDRESS: 'string',  // hex address
  FLOAT  : 'number',  // decoded from scaled int
};
