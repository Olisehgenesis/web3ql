/**
 * Shared utilities for all Next.js connector route handlers.
 * Ported from api/connector.js — no Express dependency.
 */
import { ethers }             from 'ethers'
import { NextResponse, type NextRequest } from 'next/server'

// ── ABIs ─────────────────────────────────────────────────────────────────────

export const TABLE_ABI = [
  'function write(bytes32 key, bytes calldata ciphertext, bytes calldata encryptedKey) external',
  'function read(bytes32 key) external view returns (bytes memory ciphertext, bool deleted, uint256 version, uint256 updatedAt, address owner_)',
  'function update(bytes32 key, bytes calldata ciphertext, bytes calldata encryptedKey) external',
  'function deleteRecord(bytes32 key) external',
  'function getMyEncryptedKey(bytes32 key) external view returns (bytes memory)',
  'function grantAccess(bytes32 key, address user, uint8 role, bytes calldata encryptedKeyForUser) external',
  'function revokeAccess(bytes32 key, address user) external',
  'function recordExists(bytes32 key) external view returns (bool)',
  'function tableName() external view returns (string)',
  'function totalRecords() external view returns (uint256)',
  'function activeRecords() external view returns (uint256)',
  'function collaboratorCount(bytes32 key) external view returns (uint8)',
  'function owner() external view returns (address)',
]

export const FACTORY_ABI = [
  'function createDatabase(string calldata name) external returns (address db)',
  'function getUserDatabases(address user) external view returns (address[] memory)',
]

export const DATABASE_ABI = [
  'function createTable(string calldata name, bytes calldata schemaBytes) external returns (address)',
  'function tables(string calldata name) external view returns (address)',
  'function owner() external view returns (address)',
  'function databaseName() external view returns (string)',
]

// ── Constants ─────────────────────────────────────────────────────────────────

export const FACTORY_ADDRESS =
  process.env.FACTORY_ADDRESS ??
  process.env.NEXT_PUBLIC_FACTORY_ADDRESS ??
  '0x2cfE616062261927fCcC727333d6dD3D5880FDd1'

export const CELO_RPC =
  process.env.CELO_RPC_URL ?? 'https://forno.celo-sepolia.celo-testnet.org'

// ── Provider ──────────────────────────────────────────────────────────────────

export function getProvider() {
  return new ethers.JsonRpcProvider(CELO_RPC)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function deriveRecordKey(tableName: string, recordId: number | bigint | string): string {
  return ethers.solidityPackedKeccak256(
    ['string', 'uint256'],
    [String(tableName), BigInt(recordId)],
  )
}

export async function buildBaseTx(provider: ethers.JsonRpcProvider, fromAddress: string) {
  const [nonce, feeData, network] = await Promise.all([
    provider.getTransactionCount(fromAddress, 'pending'),
    provider.getFeeData(),
    provider.getNetwork(),
  ])
  return {
    chainId              : Number(network.chainId),
    nonce,
    maxFeePerGas         : feeData.maxFeePerGas?.toString()         ?? null,
    maxPriorityFeePerGas : feeData.maxPriorityFeePerGas?.toString() ?? null,
    gasPrice             : feeData.gasPrice?.toString()             ?? null,
  }
}

/** Structured JSON error. Strips any 64-char hex sequences to prevent key leaks. */
export function errJson(status: number, message: string, code: string): NextResponse {
  const safe = String(message).replace(/\b[0-9a-fA-F]{64}\b/g, '[REDACTED]')
  return NextResponse.json({ success: false, error: safe, code }, { status })
}

/** Validate required fields are present in a request body. */
export function requireFields(body: Record<string, unknown>, fields: string[]): void {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '')
  if (missing.length > 0) {
    throw Object.assign(
      new Error(`Missing required fields: ${missing.join(', ')}`),
      { code: 'MISSING_FIELDS', status: 400 },
    )
  }
}

// ── Simple in-memory rate limiter (100 req/min per IP) ────────────────────────

const _rl = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(req: NextRequest): NextResponse | null {
  const ip    = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const now   = Date.now()
  const entry = _rl.get(ip)
  if (!entry || entry.resetAt < now) {
    _rl.set(ip, { count: 1, resetAt: now + 60_000 })
    return null
  }
  if (entry.count >= 100) {
    return NextResponse.json(
      { success: false, error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
      { status: 429 },
    )
  }
  entry.count++
  return null
}
