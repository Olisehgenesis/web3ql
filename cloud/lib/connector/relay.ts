/**
 * Relay wallet logic, nonce tracking, and wallet allowlist.
 * Ported from api/connector.js — no Express dependency.
 */
import { ethers }       from 'ethers'
import nacl             from 'tweetnacl'
import { sha256 }       from '@noble/hashes/sha256'
import { NextRequest, NextResponse } from 'next/server'
import { getProvider, errJson }      from './core'

// ── API key set (for programmatic relay/write/update/delete) ──────────────────
const _relayApiKeys = new Set<string>(
  (process.env.RELAY_API_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean),
)

/** Constant-time API key check. Returns a 401 response or null if valid. */
export function checkRelayApiKey(req: NextRequest): NextResponse | null {
  const provided = (
    req.headers.get('x-api-key') ??
    (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  ).trim()

  if (!provided) {
    return errJson(401, 'Missing API key. Provide X-Api-Key or Authorization: Bearer header.', 'UNAUTHORIZED')
  }

  let valid = false
  for (const key of _relayApiKeys) {
    if (key.length === provided.length) {
      let eq = 0
      for (let i = 0; i < key.length; i++) eq |= key.charCodeAt(i) ^ provided.charCodeAt(i)
      if (eq === 0) valid = true
    }
  }

  if (!valid) return errJson(401, 'Invalid API key.', 'UNAUTHORIZED')
  return null
}

// ── Wallet allowlist ──────────────────────────────────────────────────────────
// Pre-populated from RELAY_ALLOWED_WALLETS env; extended at runtime via /relay/register-wallet.
export const _allowedWallets = new Set<string>(
  (process.env.RELAY_ALLOWED_WALLETS ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter((a) => ethers.isAddress(a)),
)

/** Returns a 403 response if the wallet is not allowed, or null if OK. */
export function checkWalletAllowed(userAddress: string): NextResponse | null {
  if (_allowedWallets.size === 0) return null   // open relay — no restriction
  if (_allowedWallets.has(userAddress.toLowerCase())) return null
  return errJson(
    403,
    `Wallet ${userAddress} is not in the allowed list. ` +
    'Register via POST /api/connector/relay/register-wallet or add to RELAY_ALLOWED_WALLETS env.',
    'WALLET_NOT_ALLOWED',
  )
}

// ── Relay wallet ──────────────────────────────────────────────────────────────

export function getRelayWallet(): ethers.Wallet | null {
  if (!process.env.RELAY_PRIVATE_KEY) return null
  return new ethers.Wallet(process.env.RELAY_PRIVATE_KEY, getProvider())
}

// ── Relay X25519 keypair (for on-chain key wrapping) ─────────────────────────

export function getRelayX25519Keypair(): nacl.BoxKeyPair | null {
  if (!process.env.RELAY_PRIVATE_KEY) return null
  const stripped = process.env.RELAY_PRIVATE_KEY.startsWith('0x')
    ? process.env.RELAY_PRIVATE_KEY.slice(2)
    : process.env.RELAY_PRIVATE_KEY
  const seed = sha256(Buffer.from(stripped, 'hex'))
  return nacl.box.keyPair.fromSecretKey(seed)
}

// ── Nonce tracker (replay protection) ────────────────────────────────────────
const _usedNonces = new Map<string, Set<string>>()

export function checkAndMarkNonce(address: string, nonce: string | number | bigint): boolean {
  const addr = address.toLowerCase()
  if (!_usedNonces.has(addr)) _usedNonces.set(addr, new Set())
  const set = _usedNonces.get(addr)!
  const key = String(nonce)
  if (set.has(key)) return false
  set.add(key)
  return true
}

// ── Chain ID cache ────────────────────────────────────────────────────────────
let _chainIdCache: number | null = null

export async function getChainId(): Promise<number> {
  if (_chainIdCache) return _chainIdCache
  const net = await getProvider().getNetwork()
  _chainIdCache = Number(net.chainId)
  return _chainIdCache
}
