export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { type NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { getProvider, errJson, requireFields, checkRateLimit } from '@/lib/connector/core'

/**
 * POST /api/connector/broadcast
 *
 * Relay a pre-signed raw transaction to the network.
 * The server never holds or sees a private key — it is a pure broadcast relay.
 *
 * Body: { signedTx: string }  — RLP-encoded signed tx (0x-prefixed hex)
 * Returns: { success, txHash, from, to, nonce }
 */
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req)
  if (rl) return rl

  try {
    const body = await req.json()
    requireFields(body, ['signedTx'])
    const { signedTx } = body

    if (typeof signedTx !== 'string' || !signedTx.startsWith('0x')) {
      return errJson(400, 'signedTx must be a 0x-prefixed hex string', 'INVALID_SIGNED_TX')
    }

    let parsed: ethers.Transaction
    try {
      parsed = ethers.Transaction.from(signedTx)
    } catch {
      return errJson(400, 'signedTx is not a valid signed transaction', 'INVALID_SIGNED_TX')
    }

    const provider   = getProvider()
    const txResponse = await provider.broadcastTransaction(signedTx)

    return NextResponse.json({
      success : true,
      txHash  : txResponse.hash,
      from    : parsed.from,
      to      : parsed.to,
      nonce   : parsed.nonce,
    })
  } catch (err: any) {
    return errJson(err.status ?? 500, err.message, err.code ?? 'BROADCAST_FAILED')
  }
}
