/**
 * Contract addresses and minimal ABIs for the Web3QL cloud dashboard.
 * All reads/writes go directly to Celo Sepolia — no indexer, no server.
 */

// ─── Addresses ────────────────────────────────────────────────────────────────

// ─── Multicall3 ──────────────────────────────────────────────────────────────
// Deployed at the canonical address on all major EVM chains including Celo.
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as `0x${string}`;

export const MULTICALL3_ABI = [
  {
    name: 'aggregate3',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'calls',
      type: 'tuple[]',
      components: [
        { name: 'target',       type: 'address' },
        { name: 'allowFailure', type: 'bool'    },
        { name: 'callData',     type: 'bytes'   },
      ],
    }],
    outputs: [{
      name: 'returnData',
      type: 'tuple[]',
      components: [
        { name: 'success',    type: 'bool'  },
        { name: 'returnData', type: 'bytes' },
      ],
    }],
  },
] as const;

export const FACTORY_ADDRESS =
  (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ??
    '0x2cfE616062261927fCcC727333d6dD3D5880FDd1') as `0x${string}`;

export const CLOUD_DB_ADDRESS =
  (process.env.NEXT_PUBLIC_CLOUD_DB ??
    '0x01F7a081414c9f3dE67EDB2bB2a06C29D8BD8860') as `0x${string}`;

// PublicKeyRegistry — UUPS proxy, deployed 2026-04-04
export const REGISTRY_ADDRESS =
  (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ??
    '0x6379ee47C5087e200589Ea4F03141fc85ec53101') as `0x${string}`;

export const CHAIN_ID = 11142220; // Celo Sepolia (NOT Alfajores/44787)

// ─── ABIs ────────────────────────────────────────────────────────────────────

export const FACTORY_ABI = [
  {
    name: 'createDatabase',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: 'db', type: 'address' }],
  },
  {
    name: 'getUserDatabases',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'databaseCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'DatabaseCreated',
    type: 'event',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'db',    type: 'address', indexed: true },
      { name: 'index', type: 'uint256', indexed: true },
    ],
  },
] as const;

export const DATABASE_ABI = [
  {
    name: 'databaseName',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'listTables',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string[]' }],
  },
  {
    name: 'tableCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getTable',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'createTable',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name',        type: 'string' },
      { name: 'schemaBytes', type: 'bytes'  },
    ],
    outputs: [{ name: 'tableAddr', type: 'address' }],
  },
  {
    name: 'TableCreated',
    type: 'event',
    inputs: [
      { name: 'name',          type: 'string',  indexed: true },
      { name: 'tableContract', type: 'address', indexed: false },
      { name: 'owner',         type: 'address', indexed: true },
    ],
  },
  {
    name: 'dropTable',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [],
  },
  {
    name: 'TableDropped',
    type: 'event',
    inputs: [{ name: 'name', type: 'string', indexed: true }],
  },
] as const;

export const TABLE_ABI = [
  {
    name: 'tableName',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'schemaBytes',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes' }],
  },
  {
    name: 'totalRecords',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'activeRecords',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'MAX_COLLABORATORS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    name: 'read',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [
      { name: 'ciphertext', type: 'bytes'   },
      { name: 'deleted',    type: 'bool'    },
      { name: 'version',    type: 'uint256' },
      { name: 'updatedAt',  type: 'uint256' },
      { name: 'owner_',     type: 'address' },
    ],
  },
  {
    name: 'recordExists',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'getMyEncryptedKey',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [{ type: 'bytes' }],
  },
  {
    name: 'ownerRecordCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getOwnerRecords',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'addr',  type: 'address' },
      { name: 'start', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [{ name: 'result', type: 'bytes32[]' }],
  },
  {
    name: 'collaboratorCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [{ type: 'uint8' }],
  },
  {
    name: 'getCollaborators',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'getRole',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'resource', type: 'bytes32' },
      { name: 'user',     type: 'address' },
    ],
    outputs: [{ type: 'uint8' }],
  },
  {
    name: 'getActiveOwnerRecords',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'addr',  type: 'address' },
      { name: 'start', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [{ name: 'result', type: 'bytes32[]' }],
  },
  {
    name: 'write',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'key',          type: 'bytes32' },
      { name: 'ciphertext',   type: 'bytes'   },
      { name: 'encryptedKey', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    name: 'update',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'key',          type: 'bytes32' },
      { name: 'ciphertext',   type: 'bytes'   },
      { name: 'encryptedKey', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    name: 'deleteRecord',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'grantAccess',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'key',                 type: 'bytes32' },
      { name: 'user',                type: 'address' },
      { name: 'role',                type: 'uint8'   },
      { name: 'encryptedKeyForUser', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    name: 'revokeAccess',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'key',  type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'RecordWritten',
    type: 'event',
    inputs: [
      { name: 'key',       type: 'bytes32', indexed: true  },
      { name: 'owner',     type: 'address', indexed: true  },
      { name: 'version',   type: 'uint256', indexed: false },
      { name: 'updatedAt', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'RecordDeleted',
    type: 'event',
    inputs: [
      { name: 'key',       type: 'bytes32', indexed: true  },
      { name: 'owner',     type: 'address', indexed: true  },
      { name: 'version',   type: 'uint256', indexed: false },
      { name: 'updatedAt', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'AccessGranted',
    type: 'event',
    inputs: [
      { name: 'key',  type: 'bytes32', indexed: true  },
      { name: 'user', type: 'address', indexed: true  },
      { name: 'role', type: 'uint8',   indexed: false },
    ],
  },
  {
    name: 'AccessRevoked',
    type: 'event',
    inputs: [
      { name: 'key',  type: 'bytes32', indexed: true  },
      { name: 'user', type: 'address', indexed: true  },
    ],
  },
] as const;

// ─── Role helpers ─────────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<number, string> = {
  0: 'NONE',
  1: 'VIEWER',
  2: 'EDITOR',
  3: 'OWNER',
};

export function roleLabel(r: number) {
  return ROLE_LABELS[r] ?? 'UNKNOWN';
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

import { keccak256, encodePacked } from 'viem';

export function recordKey(tableName: string, primaryKey: string): `0x${string}` {
  return keccak256(encodePacked(['string', 'string'], [tableName, primaryKey]));
}
