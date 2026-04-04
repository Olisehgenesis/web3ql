/**
 * Browser-safe crypto utilities for Web3QL.
 *
 * Key derivation uses a wallet signature (not the raw private key) so it
 * works with any EIP-1193 wallet (MetaMask, WalletConnect, etc.).
 *
 * Derivation message: "Web3QL encryption key derivation v1"
 *   → SHA-256(signature bytes) → 32-byte X25519 seed → NaCl keypair
 *
 * NOTE: This is a different derivation from the Node.js SDK's deriveKeypair()
 * which uses SHA-256(ethPrivateKey). Records written with the SDK cannot be
 * decrypted here unless the same signature-derived pubkey was used to grant
 * access. Records written via this browser flow CAN be decrypted here.
 */

import nacl from 'tweetnacl'
import { sha256 } from '@noble/hashes/sha256'
import { hexToBytes } from '@noble/hashes/utils'

// ─── Constants ────────────────────────────────────────────────────────────────

export const KEY_DERIVATION_MESSAGE = 'Web3QL encryption key derivation v1'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrowserKeypair {
  publicKey : Uint8Array  // 32 bytes — X25519
  privateKey: Uint8Array  // 32 bytes — X25519
}

export interface EncryptedRecord {
  /** Hex-encoded secretbox blob (nonce || encrypted_payload) */
  ciphertextHex      : string
  /** Hex-encoded box blob encrypted for self (nonce || encrypted_sym_key) */
  encryptedKeyForSelf: string
  /** Hex-encoded box blob encrypted for relay's X25519 pubkey */
  encryptedKeyForRelay: string
}

// ─── Keypair derivation ───────────────────────────────────────────────────────

/**
 * Derive an X25519 browser keypair from a personal_sign signature.
 * The caller must sign KEY_DERIVATION_MESSAGE with their wallet.
 */
export function deriveKeypairFromSignature(signatureHex: string): BrowserKeypair {
  const stripped = signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex
  const sigBytes = hexToBytes(stripped)
  const seed     = sha256(sigBytes)
  const kp       = nacl.box.keyPair.fromSecretKey(seed)
  return { publicKey: kp.publicKey, privateKey: kp.secretKey }
}

// ─── Hex helpers ──────────────────────────────────────────────────────────────

export function publicKeyToHex(pk: Uint8Array): string {
  return '0x' + Buffer.from(pk).toString('hex')
}

export function hexToPublicKey(hex: string): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex
  return hexToBytes(stripped)
}

// ─── Encryption ───────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string ready for on-chain storage:
 *  1. Generate a random symmetric key.
 *  2. Encrypt the plaintext (NaCl secretbox).
 *  3. Box-encrypt the sym key for self (so we can decrypt it back).
 *  4. Box-encrypt the sym key for the relay (relay needs it to write on-chain).
 *
 * @param plaintext   UTF-8 text to encrypt.
 * @param myKeypair   Browser-derived X25519 keypair.
 * @param relayPubKey 32-byte relay X25519 public key (from /api/connector/relay/info).
 */
export function encryptRecord(
  plaintext   : string,
  myKeypair   : BrowserKeypair,
  relayPubKey : Uint8Array,
): EncryptedRecord {
  const ptBytes = new TextEncoder().encode(plaintext)

  // 1. Random symmetric key
  const symKey = nacl.randomBytes(nacl.secretbox.keyLength)

  // 2. Encrypt data with sym key
  const dataNonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const encData   = nacl.secretbox(ptBytes, dataNonce, symKey)
  if (!encData) throw new Error('encryptRecord: secretbox returned null')
  const ciphertextHex = bytesToHex(concat(dataNonce, encData))

  // 3. Encrypt sym key for self: nacl.box(symKey, nonce, myPubKey, myPrivKey)
  const selfNonce = nacl.randomBytes(nacl.box.nonceLength)
  const encSelf   = nacl.box(symKey, selfNonce, myKeypair.publicKey, myKeypair.privateKey)
  if (!encSelf) throw new Error('encryptRecord: box (self) returned null')
  const encryptedKeyForSelf = bytesToHex(concat(selfNonce, encSelf))

  // 4. Encrypt sym key for relay: nacl.box(symKey, nonce, relayPubKey, myPrivKey)
  const relayNonce = nacl.randomBytes(nacl.box.nonceLength)
  const encRelay   = nacl.box(symKey, relayNonce, relayPubKey, myKeypair.privateKey)
  if (!encRelay) throw new Error('encryptRecord: box (relay) returned null')
  const encryptedKeyForRelay = bytesToHex(concat(relayNonce, encRelay))

  return { ciphertextHex, encryptedKeyForSelf, encryptedKeyForRelay }
}

// ─── Decryption ───────────────────────────────────────────────────────────────

/**
 * Decrypt a record that was encrypted for this user.
 *
 * @param ciphertextHex    Hex-encoded secretbox blob (from chain / connector API).
 * @param encryptedKeyHex  Hex-encoded box blob — the user's sym key copy.
 * @param myKeypair        Browser-derived X25519 keypair.
 * @returns Decrypted plaintext string.
 */
export function decryptRecord(
  ciphertextHex   : string,
  encryptedKeyHex : string,
  myKeypair       : BrowserKeypair,
): string {
  const ciphertextBytes = fromHex(ciphertextHex)
  const encKeyBytes     = fromHex(encryptedKeyHex)

  // Decrypt the symmetric key (self-box)
  const keyNonce = encKeyBytes.subarray(0, nacl.box.nonceLength)
  const keyEnc   = encKeyBytes.subarray(nacl.box.nonceLength)
  const symKey   = nacl.box.open(keyEnc, keyNonce, myKeypair.publicKey, myKeypair.privateKey)
  if (!symKey) throw new Error('decryptRecord: failed to decrypt sym key — wrong keypair or data tampered')

  // Decrypt data
  const dataNonce = ciphertextBytes.subarray(0, nacl.secretbox.nonceLength)
  const dataEnc   = ciphertextBytes.subarray(nacl.secretbox.nonceLength)
  const plaintext = nacl.secretbox.open(dataEnc, dataNonce, symKey)
  if (!plaintext) throw new Error('decryptRecord: failed to decrypt data — wrong key or tampered')

  return new TextDecoder().decode(plaintext)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex
  return hexToBytes(stripped)
}
