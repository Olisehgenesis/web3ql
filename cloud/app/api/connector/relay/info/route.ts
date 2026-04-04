export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/connector/relay/info
 *
 * Returns the relay wallet address and X25519 public key.
 * Use the relayAddress when granting EDITOR role on your tables.
 * Use relayX25519PubKey when wrapping symmetric keys client-side.
 *
 * Returns: { success, configured, relayAddress?, relayX25519PubKey?, message }
 */
import { type NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/connector/core'
import { getRelayWallet, getRelayX25519Keypair } from '@/lib/connector/relay'

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req)
  if (rl) return rl

  const wallet  = getRelayWallet()
  const keypair = getRelayX25519Keypair()

  if (!wallet || !keypair) {
    return NextResponse.json({
      success   : true,
      configured: false,
      message   : 'Relay not active. Set RELAY_PRIVATE_KEY in your environment.',
    })
  }

  return NextResponse.json({
    success          : true,
    configured       : true,
    relayAddress     : wallet.address,
    relayX25519PubKey: Buffer.from(keypair.publicKey).toString('hex'),
    message          : `Grant EDITOR role to ${wallet.address} on each table to enable gas sponsorship.`,
  })
}
