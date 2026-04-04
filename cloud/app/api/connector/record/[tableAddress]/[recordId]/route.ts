export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/connector/record/[tableAddress]/[recordId]
 *
 * Fetch an encrypted record from the chain.
 * Returns ciphertext + caller-specific encrypted key blob — decryption is client-side only.
 *
 * Query params:
 *   fromAddress — caller wallet address (no private key required)
 *   tableName   — must match on-chain table name (required unless rawKey is provided)
 *   rawKey      — optional: pass a raw bytes32 key (0x-prefixed) instead of computing
 *                 from tableName+recordId. Overrides tableName-based derivation.
 *
 * Returns: { success, ciphertext, encryptedKey, recordKey, version, updatedAt, owner }
 */
import { type NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { getProvider, errJson, checkRateLimit, deriveRecordKey, TABLE_ABI } from '@/lib/connector/core'

type Params = { tableAddress: string; recordId: string }

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const rl = checkRateLimit(req)
  if (rl) return rl

  try {
    const { tableAddress, recordId } = await params
    const { searchParams }           = new URL(req.url)
    const fromAddress                = searchParams.get('fromAddress')
    const tableName                  = searchParams.get('tableName')
    const rawKey                     = searchParams.get('rawKey')

    if (!ethers.isAddress(tableAddress)) {
      return errJson(400, 'Invalid tableAddress', 'INVALID_ADDRESS')
    }
    if (!fromAddress || !ethers.isAddress(fromAddress)) {
      return errJson(400, 'fromAddress query param required (wallet address)', 'MISSING_FROM_ADDRESS')
    }

    const provider = getProvider()
    const iface    = new ethers.Interface(TABLE_ABI)

    // Resolve record key: rawKey takes precedence over tableName+recordId derivation
    let recordKey: string
    if (rawKey) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
        return errJson(400, 'rawKey must be a 0x-prefixed 32-byte hex string', 'INVALID_RAW_KEY')
      }
      recordKey = rawKey
    } else {
      if (!tableName?.trim()) {
        return errJson(400, 'tableName query param required (or pass rawKey)', 'MISSING_TABLE_NAME')
      }
      recordKey = deriveRecordKey(tableName, recordId)
    }

    // Read record metadata (public view call)
    const readData = await provider.call({
      to  : tableAddress,
      data: iface.encodeFunctionData('read', [recordKey]),
    })
    const [ciphertext, deleted, version, updatedAt, owner_] =
      iface.decodeFunctionResult('read', readData)

    if (deleted)                             return errJson(404, 'Record has been deleted',                                  'RECORD_DELETED')
    if (!ciphertext || ciphertext === '0x')  return errJson(404, 'Record not found',                                         'RECORD_NOT_FOUND')

    // Fetch the caller's encrypted key copy (sets msg.sender = fromAddress in the eth_call)
    const keyData = await provider.call({
      to  : tableAddress,
      from: fromAddress,
      data: iface.encodeFunctionData('getMyEncryptedKey', [recordKey]),
    })
    const [encryptedKey] = iface.decodeFunctionResult('getMyEncryptedKey', keyData)

    if (!encryptedKey || encryptedKey === '0x') {
      return errJson(403, 'Access denied — caller has no key copy for this record', 'ACCESS_DENIED')
    }

    return NextResponse.json({
      success     : true,
      ciphertext,
      encryptedKey,
      recordKey,
      version     : version.toString(),
      updatedAt   : new Date(Number(updatedAt) * 1000).toISOString(),
      owner       : owner_,
    })
  } catch (err: any) {
    return errJson(err.status ?? 500, err.message, err.code ?? 'READ_FAILED')
  }
}
