/**
 * @file   crypto.ts
 * @notice Off-chain encryption layer for Web3QL.
 *
 * Security model:
 * ─────────────────────────────────────────────────────────────
 *  • One random 32-byte symmetric key is generated per record.
 *  • Record data is encrypted with that key using NaCl secretbox
 *    (XSalsa20-Poly1305, 256-bit key, 192-bit nonce, 128-bit MAC).
 *  • The symmetric key is encrypted separately for each authorised
 *    user using NaCl box (X25519-XSalsa20-Poly1305, ECDH key agreement).
 *  • Only the encrypted blobs ever touch the chain — the symmetric key
 *    and plaintext never leave the client device.
 *
 * Key derivation from Ethereum wallet:
 * ─────────────────────────────────────────────────────────────
 *  X25519 private key = SHA-256(Ethereum private key bytes)
 *  X25519 public key  = scalar multiplication (computed by nacl)
 *
 *  This means no separate key management — the wallet IS the
 *  encryption identity.  Losing the wallet private key = losing
 *  access to encrypted records (same as losing any crypto key).
 *
 * Wire format (self-describing, no external framing needed):
 * ─────────────────────────────────────────────────────────────
 *  secretbox blob: [ 24-byte nonce | encrypted payload ]
 *  box blob:       [ 24-byte nonce | encrypted payload ]
 */

import nacl           from 'tweetnacl';
import { sha256 }     from '@noble/hashes/sha256';
import { hexToBytes } from '@noble/hashes/utils';

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

export interface EncryptionKeypair {
  /** X25519 public key — safe to publish on-chain */
  publicKey  : Uint8Array; // 32 bytes
  /** X25519 private key — never leaves the client */
  privateKey : Uint8Array; // 32 bytes
}

// ─────────────────────────────────────────────────────────────
//  Keypair derivation
// ─────────────────────────────────────────────────────────────

/**
 * Derive an X25519 encryption keypair from an Ethereum private key.
 * The Ethereum private key is never stored or transmitted — it is
 * hashed once to produce the 32-byte X25519 seed.
 *
 * @param ethPrivateKey  Hex string, with or without "0x" prefix.
 */
export function deriveKeypair(ethPrivateKey: string): EncryptionKeypair {
  const stripped = ethPrivateKey.startsWith('0x')
    ? ethPrivateKey.slice(2)
    : ethPrivateKey;
  const seed = sha256(hexToBytes(stripped));
  const kp   = nacl.box.keyPair.fromSecretKey(seed);
  return { publicKey: kp.publicKey, privateKey: kp.secretKey };
}

/**
 * Derive ONLY the public key (useful when you only have a signed
 * message and want to register — not when you have the private key).
 * Exposed for completeness; normally call deriveKeypair() directly.
 */
export function publicKeyFromPrivate(ethPrivateKey: string): Uint8Array {
  return deriveKeypair(ethPrivateKey).publicKey;
}

// ─────────────────────────────────────────────────────────────
//  Symmetric encryption (record data)
// ─────────────────────────────────────────────────────────────

/**
 * Generate a random 32-byte symmetric key for a new record.
 * Call this once per write — never reuse across records.
 */
export function generateSymmetricKey(): Uint8Array {
  return nacl.randomBytes(nacl.secretbox.keyLength); // 32 bytes
}

/**
 * Encrypt plaintext with a symmetric key.
 * Wire format: [ 24-byte nonce | MAC+ciphertext ]
 */
export function encryptData(
  plaintext    : Uint8Array,
  symmetricKey : Uint8Array,
): Uint8Array {
  const nonce     = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(plaintext, nonce, symmetricKey);
  if (!encrypted) throw new Error('encryptData: nacl.secretbox returned null');
  return concat(nonce, encrypted);
}

/**
 * Decrypt a secretbox blob (nonce||ciphertext) with a symmetric key.
 * Throws if the MAC check fails (data tampered or wrong key).
 */
export function decryptData(
  blob         : Uint8Array,
  symmetricKey : Uint8Array,
): Uint8Array {
  const nonce      = blob.subarray(0, nacl.secretbox.nonceLength);
  const ciphertext = blob.subarray(nacl.secretbox.nonceLength);
  const plaintext  = nacl.secretbox.open(ciphertext, nonce, symmetricKey);
  if (!plaintext) throw new Error('decryptData: authentication failed — wrong key or tampered data');
  return plaintext;
}

// ─────────────────────────────────────────────────────────────
//  Asymmetric key wrapping (per-recipient symmetric key copies)
// ─────────────────────────────────────────────────────────────

/**
 * Encrypt a symmetric key for a specific recipient.
 *
 * The caller (sharer) needs their own X25519 private key and the
 * recipient's X25519 public key (registered on-chain in PublicKeyRegistry).
 *
 * Wire format: [ 24-byte nonce | MAC+ciphertext ]
 */
export function encryptKeyForRecipient(
  symmetricKey       : Uint8Array,
  recipientPublicKey : Uint8Array,
  senderPrivateKey   : Uint8Array,
): Uint8Array {
  const nonce     = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(symmetricKey, nonce, recipientPublicKey, senderPrivateKey);
  if (!encrypted) throw new Error('encryptKeyForRecipient: nacl.box returned null');
  return concat(nonce, encrypted);
}

/**
 * Decrypt a symmetric key that was encrypted for us.
 * Throws if authentication fails.
 */
export function decryptKeyFromSender(
  blob              : Uint8Array,
  senderPublicKey   : Uint8Array,
  recipientPrivKey  : Uint8Array,
): Uint8Array {
  const nonce      = blob.subarray(0, nacl.box.nonceLength);
  const ciphertext = blob.subarray(nacl.box.nonceLength);
  const key        = nacl.box.open(ciphertext, nonce, senderPublicKey, recipientPrivKey);
  if (!key) throw new Error('decryptKeyFromSender: authentication failed — wrong key or tampered data');
  return key;
}

/**
 * Encrypt the symmetric key to yourself — used on the initial write
 * so the owner can always recover their own key.
 */
export function encryptKeyForSelf(
  symmetricKey : Uint8Array,
  keypair      : EncryptionKeypair,
): Uint8Array {
  return encryptKeyForRecipient(symmetricKey, keypair.publicKey, keypair.privateKey);
}

/**
 * Decrypt a symmetric key that was encrypted to yourself.
 */
export function decryptKeyForSelf(
  blob    : Uint8Array,
  keypair : EncryptionKeypair,
): Uint8Array {
  return decryptKeyFromSender(blob, keypair.publicKey, keypair.privateKey);
}

// ─────────────────────────────────────────────────────────────
//  Encode/decode public key for on-chain storage (bytes32)
// ─────────────────────────────────────────────────────────────

/**
 * Encode a 32-byte X25519 public key as a 0x-prefixed hex string
 * suitable for passing to PublicKeyRegistry.register().
 */
export function publicKeyToHex(pubKey: Uint8Array): string {
  if (pubKey.length !== 32) throw new Error('publicKeyToHex: expected 32 bytes');
  return '0x' + Buffer.from(pubKey).toString('hex');
}

/**
 * Decode a 0x-prefixed hex bytes32 from the registry back to Uint8Array.
 */
export function hexToPublicKey(hex: string): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes    = hexToBytes(stripped);
  if (bytes.length !== 32) throw new Error('hexToPublicKey: expected 32 hex bytes');
  return bytes;
}

// ─────────────────────────────────────────────────────────────
//  Utility
// ─────────────────────────────────────────────────────────────

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
