export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/connector/tx-intent/[action]
 *
 * Builds unsigned transactions for the caller to sign client-side.
 * The server never sees a private key.
 *
 * Actions: write | update | delete | grant-access | revoke-access |
 *          deploy-database | deploy-table
 *
 * All actions return: { success, unsignedTx, recordKey? }
 * The caller signs unsignedTx locally and POSTs the result to /api/connector/broadcast.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import {
  getProvider, errJson, requireFields, checkRateLimit,
  deriveRecordKey, buildBaseTx,
  TABLE_ABI, FACTORY_ABI, DATABASE_ABI, FACTORY_ADDRESS,
} from '@/lib/connector/core'
import { compileSchemaToBytes } from '@/lib/connector/schema'

type Params = { action: string }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const rl = checkRateLimit(req)
  if (rl) return rl

  const { action } = await params
  const body: Record<string, any> = await req.json().catch(() => ({}))

  try {
    switch (action) {
      case 'write':           return txWrite(body)
      case 'update':          return txUpdate(body)
      case 'delete':          return txDelete(body)
      case 'grant-access':    return txGrantAccess(body)
      case 'revoke-access':   return txRevokeAccess(body)
      case 'deploy-database': return txDeployDatabase(body)
      case 'deploy-table':    return txDeployTable(body)
      default:
        return errJson(404, `Unknown tx-intent action: ${action}`, 'NOT_FOUND')
    }
  } catch (err: any) {
    return errJson(err.status ?? 500, err.message, err.code ?? 'TX_INTENT_FAILED')
  }
}

// ── write ─────────────────────────────────────────────────────────────────────

async function txWrite(body: Record<string, any>): Promise<NextResponse> {
  requireFields(body, ['fromAddress', 'tableAddress', 'tableName', 'recordId', 'ciphertext', 'encryptedKey'])
  const { fromAddress, tableAddress, tableName, recordId, ciphertext, encryptedKey, gasLimit } = body

  if (!ethers.isAddress(fromAddress))  return errJson(400, 'Invalid fromAddress',  'INVALID_ADDRESS')
  if (!ethers.isAddress(tableAddress)) return errJson(400, 'Invalid tableAddress', 'INVALID_ADDRESS')

  const provider  = getProvider()
  const iface     = new ethers.Interface(TABLE_ABI)
  const recordKey = deriveRecordKey(tableName, recordId)
  const data      = iface.encodeFunctionData('write', [recordKey, ciphertext, encryptedKey])
  const baseTx    = await buildBaseTx(provider, fromAddress)

  return NextResponse.json({
    success    : true,
    unsignedTx : { ...baseTx, to: ethers.getAddress(tableAddress), data, gasLimit: gasLimit ?? 300_000 },
    recordKey,
  })
}

// ── update ────────────────────────────────────────────────────────────────────

async function txUpdate(body: Record<string, any>): Promise<NextResponse> {
  requireFields(body, ['fromAddress', 'tableAddress', 'tableName', 'recordId', 'ciphertext', 'encryptedKey'])
  const { fromAddress, tableAddress, tableName, recordId, ciphertext, encryptedKey, gasLimit } = body

  if (!ethers.isAddress(fromAddress))  return errJson(400, 'Invalid fromAddress',  'INVALID_ADDRESS')
  if (!ethers.isAddress(tableAddress)) return errJson(400, 'Invalid tableAddress', 'INVALID_ADDRESS')

  const provider  = getProvider()
  const iface     = new ethers.Interface(TABLE_ABI)
  const recordKey = deriveRecordKey(tableName, recordId)
  const data      = iface.encodeFunctionData('update', [recordKey, ciphertext, encryptedKey])
  const baseTx    = await buildBaseTx(provider, fromAddress)

  return NextResponse.json({
    success    : true,
    unsignedTx : { ...baseTx, to: ethers.getAddress(tableAddress), data, gasLimit: gasLimit ?? 300_000 },
    recordKey,
  })
}

// ── delete ────────────────────────────────────────────────────────────────────

async function txDelete(body: Record<string, any>): Promise<NextResponse> {
  requireFields(body, ['fromAddress', 'tableAddress', 'tableName', 'recordId'])
  const { fromAddress, tableAddress, tableName, recordId, gasLimit } = body

  if (!ethers.isAddress(fromAddress))  return errJson(400, 'Invalid fromAddress',  'INVALID_ADDRESS')
  if (!ethers.isAddress(tableAddress)) return errJson(400, 'Invalid tableAddress', 'INVALID_ADDRESS')

  const provider  = getProvider()
  const iface     = new ethers.Interface(TABLE_ABI)
  const recordKey = deriveRecordKey(tableName, recordId)
  const data      = iface.encodeFunctionData('deleteRecord', [recordKey])
  const baseTx    = await buildBaseTx(provider, fromAddress)

  return NextResponse.json({
    success    : true,
    unsignedTx : { ...baseTx, to: ethers.getAddress(tableAddress), data, gasLimit: gasLimit ?? 200_000 },
    recordKey,
  })
}

// ── grant-access ──────────────────────────────────────────────────────────────

async function txGrantAccess(body: Record<string, any>): Promise<NextResponse> {
  requireFields(body, ['fromAddress', 'tableAddress', 'tableName', 'recordId', 'recipientAddress', 'role', 'encryptedKeyForUser'])
  const { fromAddress, tableAddress, tableName, recordId, recipientAddress, role, encryptedKeyForUser, gasLimit } = body

  if (!ethers.isAddress(fromAddress))      return errJson(400, 'Invalid fromAddress',      'INVALID_ADDRESS')
  if (!ethers.isAddress(tableAddress))     return errJson(400, 'Invalid tableAddress',     'INVALID_ADDRESS')
  if (!ethers.isAddress(recipientAddress)) return errJson(400, 'Invalid recipientAddress', 'INVALID_ADDRESS')
  if (![1, 2].includes(Number(role)))      return errJson(400, 'role must be 1 (VIEWER) or 2 (EDITOR)', 'INVALID_ROLE')

  const provider  = getProvider()
  const iface     = new ethers.Interface(TABLE_ABI)
  const recordKey = deriveRecordKey(tableName, recordId)
  const data      = iface.encodeFunctionData('grantAccess', [recordKey, recipientAddress, Number(role), encryptedKeyForUser])
  const baseTx    = await buildBaseTx(provider, fromAddress)

  return NextResponse.json({
    success    : true,
    unsignedTx : { ...baseTx, to: ethers.getAddress(tableAddress), data, gasLimit: gasLimit ?? 150_000 },
    recordKey,
  })
}

// ── revoke-access ─────────────────────────────────────────────────────────────

async function txRevokeAccess(body: Record<string, any>): Promise<NextResponse> {
  requireFields(body, ['fromAddress', 'tableAddress', 'tableName', 'recordId', 'recipientAddress'])
  const { fromAddress, tableAddress, tableName, recordId, recipientAddress, gasLimit } = body

  if (!ethers.isAddress(fromAddress))      return errJson(400, 'Invalid fromAddress',      'INVALID_ADDRESS')
  if (!ethers.isAddress(tableAddress))     return errJson(400, 'Invalid tableAddress',     'INVALID_ADDRESS')
  if (!ethers.isAddress(recipientAddress)) return errJson(400, 'Invalid recipientAddress', 'INVALID_ADDRESS')

  const provider  = getProvider()
  const iface     = new ethers.Interface(TABLE_ABI)
  const recordKey = deriveRecordKey(tableName, recordId)
  const data      = iface.encodeFunctionData('revokeAccess', [recordKey, recipientAddress])
  const baseTx    = await buildBaseTx(provider, fromAddress)

  return NextResponse.json({
    success    : true,
    unsignedTx : { ...baseTx, to: ethers.getAddress(tableAddress), data, gasLimit: gasLimit ?? 150_000 },
    recordKey,
  })
}

// ── deploy-database ───────────────────────────────────────────────────────────

async function txDeployDatabase(body: Record<string, any>): Promise<NextResponse> {
  requireFields(body, ['fromAddress', 'databaseName'])
  const { fromAddress, databaseName, gasLimit } = body

  if (!ethers.isAddress(fromAddress)) return errJson(400, 'Invalid fromAddress', 'INVALID_ADDRESS')

  const provider = getProvider()
  const iface    = new ethers.Interface(FACTORY_ABI)
  const data     = iface.encodeFunctionData('createDatabase', [String(databaseName)])
  const baseTx   = await buildBaseTx(provider, fromAddress)

  return NextResponse.json({
    success    : true,
    unsignedTx : { ...baseTx, to: ethers.getAddress(FACTORY_ADDRESS), data, gasLimit: gasLimit ?? 500_000 },
  })
}

// ── deploy-table ──────────────────────────────────────────────────────────────

async function txDeployTable(body: Record<string, any>): Promise<NextResponse> {
  requireFields(body, ['fromAddress', 'databaseAddress', 'tableName', 'schema'])
  const { fromAddress, databaseAddress, tableName, schema, gasLimit } = body

  if (!ethers.isAddress(fromAddress))     return errJson(400, 'Invalid fromAddress',     'INVALID_ADDRESS')
  if (!ethers.isAddress(databaseAddress)) return errJson(400, 'Invalid databaseAddress', 'INVALID_ADDRESS')

  let schemaBytes: string
  try {
    schemaBytes = compileSchemaToBytes(String(schema))
  } catch (err: any) {
    return errJson(400, `Schema compilation failed: ${err.message}`, 'SCHEMA_COMPILE_ERROR')
  }

  const provider = getProvider()
  const iface    = new ethers.Interface(DATABASE_ABI)
  const data     = iface.encodeFunctionData('createTable', [tableName, schemaBytes])
  const baseTx   = await buildBaseTx(provider, fromAddress)

  return NextResponse.json({
    success    : true,
    unsignedTx : { ...baseTx, to: ethers.getAddress(databaseAddress), data, gasLimit: gasLimit ?? 500_000 },
    schemaBytes,
  })
}
