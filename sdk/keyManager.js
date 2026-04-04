/**
 * @file   keyManager.js
 * @notice Key Generation & Management for Web3QL
 *
 * Implements three distinct key types:
 *   A. WALLET KEY      — secp256k1 keypair used to sign blockchain transactions
 *   B. ENCRYPTION KEY  — 32-byte symmetric key (NaCl secretbox) for record encryption
 *   C. ACCESS KEY      — per-recipient key wrapper (NaCl box / X25519-XSalsa20-Poly1305)
 *
 * Wire formats (matching sdk/src/crypto.ts):
 *   secretbox blob: [ 24-byte nonce | ciphertext+MAC ]
 *   box blob:       [ 24-byte nonce | encrypted key+MAC ]
 *
 * Security guarantees:
 *   ✓ All randomness from nacl.randomBytes — NEVER Math.random()
 *   ✓ Private keys / mnemonics are never logged or stored here
 *   ✓ NaCl secretbox (XSalsa20-Poly1305) — audited, side-channel resistant
 *   ✓ NaCl box (X25519-XSalsa20-Poly1305) for key wrapping
 *   ✓ X25519 keypair derived from Ethereum private key via SHA-256 seed
 *     (same derivation as sdk/src/crypto.ts deriveKeypair)
 *
 * Compatibility:
 *   Records encrypted via this module ARE cross-readable by sdk/src/crypto.ts
 *   because both use the same NaCl primitives and wire format.
 */

import { ethers }     from 'ethers';
import nacl           from 'tweetnacl';
import { sha256 }     from '@noble/hashes/sha256';

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

const CELO_SEPOLIA_RPC = 'https://forno.celo-sepolia.celo-testnet.org'; // Celo Sepolia (chainId 11142220)

// ─────────────────────────────────────────────────────────────
//  A. WALLET KEY
// ─────────────────────────────────────────────────────────────

/**
 * Generate a fresh random Ethereum wallet.
 *
 * ⚠  PRODUCTION WARNING — generateWallet() is for initial key provisioning only.
 *    The returned privateKey / mnemonic are shown ONCE and never stored here.
 *    Caller must persist them in a secure, encrypted keystore.
 *
 * @returns {{ address: string, privateKey: string, mnemonic: string|null, publicKey: string }}
 */
export function generateWallet() {
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[Web3QL KeyManager] WARNING: generateWallet() called in production. ' +
      'The returned privateKey must be stored in a secure encrypted keystore ' +
      'and MUST NOT be logged, committed, or sent over the network.',
    );
  }

  const wallet = ethers.Wallet.createRandom();
  return {
    address   : wallet.address,
    privateKey: wallet.privateKey,
    mnemonic  : wallet.mnemonic?.phrase ?? null,
    publicKey : wallet.publicKey,       // compressed secp256k1, 66-char hex
  };
}

/**
 * Bind an existing private key to an ethers.Wallet connected to Celo RPC.
 *
 * @param {string} privateKey  64-char hex (with or without "0x" prefix)
 * @returns {ethers.Wallet}    Wallet instance connected to Celo JSON-RPC
 * @throws {Error}             Descriptive error if key is invalid
 */
export function bindWallet(privateKey) {
  if (!privateKey || typeof privateKey !== 'string') {
    throw new Error('KeyManager.bindWallet: privateKey must be a non-empty string');
  }

  const stripped = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;

  if (stripped.length !== 64) {
    throw new Error(
      `KeyManager.bindWallet: privateKey must be 32 bytes (64 hex chars), got ${stripped.length} chars`,
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(stripped)) {
    throw new Error('KeyManager.bindWallet: privateKey contains non-hex characters');
  }

  const provider = new ethers.JsonRpcProvider(
    process.env.CELO_RPC_URL ?? CELO_SEPOLIA_RPC,
  );

  try {
    return new ethers.Wallet(`0x${stripped}`, provider);
  } catch (err) {
    throw new Error(`KeyManager.bindWallet: invalid private key — ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
//  B. ENCRYPTION KEY (symmetric, per-record)
// ─────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure 32-byte symmetric encryption key.
 * Uses nacl.randomBytes — always CSPRNG.
 *
 * @returns {string} 64-char lowercase hex string
 */
export function generateEncryptionKey() {
  return Buffer.from(nacl.randomBytes(32)).toString('hex');
}

// ─────────────────────────────────────────────────────────────
//  C. RECORD ENCRYPTION / DECRYPTION  (NaCl secretbox)
// ─────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string with NaCl secretbox (XSalsa20-Poly1305).
 * Wire format: "0x" + hex( [ nonce(24B) | ciphertext+MAC ] )
 * Compatible with encryptData() in sdk/src/crypto.ts.
 *
 * @param {string} data           UTF-8 plaintext to encrypt
 * @param {string} encryptionKey  64-char hex symmetric key
 * @returns {string} "0x"-prefixed hex blob
 */
export function encryptRecord(data, encryptionKey) {
  if (typeof data !== 'string') {
    throw new TypeError('KeyManager.encryptRecord: data must be a string');
  }
  const keyBuf    = _parseHexKey(encryptionKey, 'encryptRecord');
  const plaintext = new TextEncoder().encode(data);
  const nonce     = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(plaintext, nonce, keyBuf);
  if (!encrypted) throw new Error('KeyManager.encryptRecord: nacl.secretbox returned null');
  const blob = new Uint8Array(nonce.length + encrypted.length);
  blob.set(nonce);
  blob.set(encrypted, nonce.length);
  return '0x' + Buffer.from(blob).toString('hex');
}

/**
 * Decrypt a secretbox blob (from encryptRecord or the chain).
 * Throws if MAC check fails (tampered data or wrong key).
 * Compatible with decryptData() in sdk/src/crypto.ts.
 *
 * @param {string} ciphertextHex  "0x"-prefixed hex blob
 * @param {string} encryptionKey  64-char hex symmetric key
 * @returns {string} Decrypted UTF-8 plaintext
 */
export function decryptRecord(ciphertextHex, encryptionKey) {
  const keyBuf = _parseHexKey(encryptionKey, 'decryptRecord');
  const clean  = ciphertextHex.startsWith('0x') ? ciphertextHex.slice(2) : ciphertextHex;
  const blob   = new Uint8Array(Buffer.from(clean, 'hex'));
  if (blob.length < nacl.secretbox.nonceLength) {
    throw new Error('KeyManager.decryptRecord: blob too short to contain nonce');
  }
  const nonce     = blob.subarray(0, nacl.secretbox.nonceLength);
  const ct        = blob.subarray(nacl.secretbox.nonceLength);
  const plaintext = nacl.secretbox.open(ct, nonce, keyBuf);
  if (!plaintext) {
    throw new Error('KeyManager.decryptRecord: authentication failed — wrong key or tampered data');
  }
  return new TextDecoder().decode(plaintext);
}

// ─────────────────────────────────────────────────────────────
//  D. KEY WRAPPING  (NaCl box — X25519-XSalsa20-Poly1305)
// ─────────────────────────────────────────────────────────────

/**
 * Wrap (encrypt) an encryption key for a specific recipient.
 * Uses NaCl box (X25519 ECDH + XSalsa20-Poly1305) — matches encryptKeyForRecipient()
 * in sdk/src/crypto.ts and the on-chain PublicKeyRegistry scheme.
 *
 * @param {string} encryptionKey          64-char hex symmetric key to wrap
 * @param {string} recipientX25519PubKey  64-char hex X25519 public key (from PublicKeyRegistry)
 * @param {string} senderEthPrivateKey    64-char hex Ethereum private key
 *                                        (X25519 key is derived from it via SHA-256)
 * @returns {string} "0x"-prefixed hex: [ nonce(24B) | encrypted+MAC(48B) ] = 72 bytes
 */
export function wrapKey(encryptionKey, recipientX25519PubKey, senderEthPrivateKey) {
  const keyBuf    = _parseHexKey(encryptionKey, 'wrapKey');
  const recipPub  = _parseX25519Key(recipientX25519PubKey, 'wrapKey');
  const stripped  = senderEthPrivateKey.startsWith('0x') ? senderEthPrivateKey.slice(2) : senderEthPrivateKey;
  if (stripped.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(stripped)) {
    throw new Error('KeyManager.wrapKey: senderEthPrivateKey must be 32 bytes (64 hex chars)');
  }
  const seed         = sha256(new Uint8Array(Buffer.from(stripped, 'hex')));
  const senderKp     = nacl.box.keyPair.fromSecretKey(seed);
  const nonce        = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted    = nacl.box(keyBuf, nonce, recipPub, senderKp.secretKey);
  if (!encrypted) throw new Error('KeyManager.wrapKey: nacl.box returned null');
  const blob = new Uint8Array(nonce.length + encrypted.length);
  blob.set(nonce);
  blob.set(encrypted, nonce.length);
  return '0x' + Buffer.from(blob).toString('hex');
}

/**
 * Unwrap (decrypt) a wrapped key.
 * Compatible with decryptKeyFromSender() in sdk/src/crypto.ts.
 *
 * @param {string} wrappedKeyHex          "0x"-prefixed hex from wrapKey()
 * @param {string} senderX25519PubKey     64-char hex X25519 public key of the sender
 * @param {string} recipientEthPrivateKey 64-char hex Ethereum private key of recipient
 *                                        (X25519 key is derived from it via SHA-256)
 * @returns {string} 64-char hex symmetric key
 */
export function unwrapKey(wrappedKeyHex, senderX25519PubKey, recipientEthPrivateKey) {
  const senderPub = _parseX25519Key(senderX25519PubKey, 'unwrapKey');
  const stripped  = recipientEthPrivateKey.startsWith('0x') ? recipientEthPrivateKey.slice(2) : recipientEthPrivateKey;
  if (stripped.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(stripped)) {
    throw new Error('KeyManager.unwrapKey: recipientEthPrivateKey must be 32 bytes (64 hex chars)');
  }
  const seed     = sha256(new Uint8Array(Buffer.from(stripped, 'hex')));
  const recipKp  = nacl.box.keyPair.fromSecretKey(seed);
  const clean    = wrappedKeyHex.startsWith('0x') ? wrappedKeyHex.slice(2) : wrappedKeyHex;
  const blob     = new Uint8Array(Buffer.from(clean, 'hex'));
  if (blob.length < nacl.box.nonceLength) {
    throw new Error('KeyManager.unwrapKey: wrapped key blob too short');
  }
  const nonce      = blob.subarray(0, nacl.box.nonceLength);
  const ciphertext = blob.subarray(nacl.box.nonceLength);
  const symKey     = nacl.box.open(ciphertext, nonce, senderPub, recipKp.secretKey);
  if (!symKey) {
    throw new Error('KeyManager.unwrapKey: authentication failed — wrong key or tampered data');
  }
  return Buffer.from(symKey).toString('hex');
}

/**
 * Rotate the key wrapper for a record.
 *
 * @param {string} encryptedKey           Current hex blob from wrapKey()
 * @param {string} senderX25519PubKey     X25519 public key of the original sender
 * @param {string} recipientEthPrivateKey Recipient's Ethereum private key (derives X25519)
 * @param {string} newRecipX25519PubKey   New recipient's X25519 public key
 * @param {string} newSenderEthPrivKey    New sender's Ethereum private key (derives X25519)
 * @returns {string} New hex blob for the new recipient
 */
export function rotateKey(encryptedKey, senderX25519PubKey, recipientEthPrivateKey, newRecipX25519PubKey, newSenderEthPrivKey) {
  const rawKey = unwrapKey(encryptedKey, senderX25519PubKey, recipientEthPrivateKey);
  return wrapKey(rawKey, newRecipX25519PubKey, newSenderEthPrivKey);
}

// ─────────────────────────────────────────────────────────────
//  Encoding helpers (for on-chain byte blobs)
// ─────────────────────────────────────────────────────────────

/**
 * Decode a secretbox blob (from contract read()) into its components.
 * NaCl wire format: [ nonce(24B) | ciphertext+MAC ]
 *
 * @param {string} hex  "0x"-prefixed hex from contract read()
 * @returns {{ nonce: string, ciphertext: string }}
 */
export function decodeCiphertextBlob(hex) {
  const buf = Buffer.from(hex.startsWith('0x') ? hex.slice(2) : hex, 'hex');
  if (buf.length < nacl.secretbox.nonceLength) {
    throw new Error('KeyManager.decodeCiphertextBlob: blob too short to contain nonce');
  }
  return {
    nonce     : buf.subarray(0, nacl.secretbox.nonceLength).toString('hex'),
    ciphertext: buf.subarray(nacl.secretbox.nonceLength).toString('hex'),
  };
}

/**
 * Derive the X25519 public key corresponding to an Ethereum private key.
 * Uses the same derivation as wrapKey/unwrapKey: SHA-256 of the private key bytes
 * becomes the seed for nacl.box.keyPair.fromSecretKey().
 *
 * Callers use this to obtain the public key that should be registered in the
 * PublicKeyRegistry and passed as `recipientX25519PubKey` to wrapKey().
 *
 * @param {string} ethPrivateKey  64-char hex Ethereum private key (with or without "0x")
 * @returns {string} 64-char hex X25519 public key
 */
export function deriveX25519PublicKey(ethPrivateKey) {
  const stripped = ethPrivateKey.startsWith('0x') ? ethPrivateKey.slice(2) : ethPrivateKey;
  if (stripped.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(stripped)) {
    throw new Error('KeyManager.deriveX25519PublicKey: ethPrivateKey must be 32 bytes (64 hex chars)');
  }
  const seed = sha256(new Uint8Array(Buffer.from(stripped, 'hex')));
  const kp   = nacl.box.keyPair.fromSecretKey(seed);
  return Buffer.from(kp.publicKey).toString('hex');
}

/**
 * Ensure a wrapped key hex string has a "0x" prefix for ethers/contract calls.
 * @param {string} wrappedKeyHex  hex from wrapKey()
 * @returns {string}
 */
export function encodeWrappedKey(wrappedKeyHex) {
  const clean = wrappedKeyHex.startsWith('0x') ? wrappedKeyHex.slice(2) : wrappedKeyHex;
  return '0x' + clean;
}

/**
 * Strip "0x" prefix from a wrapped key returned by getMyEncryptedKey().
 * @param {string} hex  "0x"-prefixed hex from contract
 * @returns {string}
 */
export function decodeWrappedKey(hex) {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

// ─────────────────────────────────────────────────────────────
//  Private helpers
// ─────────────────────────────────────────────────────────────

function _parseHexKey(hex, fn) {
  if (typeof hex !== 'string') {
    throw new TypeError(`KeyManager.${fn}: key must be a string`);
  }
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`KeyManager.${fn}: key must be 32 bytes (64 hex chars), got ${clean.length}`);
  }
  return new Uint8Array(Buffer.from(clean, 'hex'));
}

function _parseX25519Key(hex, fn) {
  if (typeof hex !== 'string') {
    throw new TypeError(`KeyManager.${fn}: X25519 public key must be a string`);
  }
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(
      `KeyManager.${fn}: X25519 public key must be 32 bytes (64 hex chars), got ${clean.length}`,
    );
  }
  return new Uint8Array(Buffer.from(clean, 'hex'));
}
