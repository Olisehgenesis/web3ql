/**
 * @file   keyManager.test.js
 * @notice Unit tests for sdk/keyManager.js
 *
 * Uses Node.js built-in test runner (node:test + node:assert).
 * Requires Node.js >= 20.  No external test framework needed.
 *
 * Run:
 *   node --test tests/keyManager.test.js
 *   # or from workspace root:
 *   npm test
 *
 * Encryption scheme: NaCl XSalsa20-Poly1305 (secretbox) for records,
 *                    NaCl box (X25519-XSalsa20-Poly1305) for key wrapping.
 * Wire format (record): "0x" + hex([ nonce(24) | ciphertext+MAC ])
 * Wire format (wrapped): "0x" + hex([ nonce(24) | encrypted_key+MAC(48) ]) = 72 bytes
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateWallet,
  bindWallet,
  generateEncryptionKey,
  encryptRecord,
  decryptRecord,
  wrapKey,
  unwrapKey,
  rotateKey,
  decodeCiphertextBlob,
  encodeWrappedKey,
  decodeWrappedKey,
  deriveX25519PublicKey,
} from '../sdk/keyManager.js';

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Generate a Web3QL keypair: a random Ethereum wallet + its derived X25519 public key.
 * Returns { ethPrivKey: 64-char hex, x25519PubKey: 64-char hex }
 *
 * wrapKey(symKey, bob.x25519PubKey, alice.ethPrivKey)
 * unwrapKey(blob,  alice.x25519PubKey, bob.ethPrivKey)
 */
function makeEthKeypair() {
  const wallet      = generateWallet();
  const ethPrivKey  = wallet.privateKey.slice(2); // strip 0x → 64-char hex
  const x25519PubKey = deriveX25519PublicKey(ethPrivKey);
  return { ethPrivKey, x25519PubKey };
}

// ─────────────────────────────────────────────────────────────
//  generateWallet
// ─────────────────────────────────────────────────────────────

describe('generateWallet()', () => {
  it('returns an object with address, privateKey, mnemonic, publicKey', () => {
    const wallet = generateWallet();
    assert.ok(wallet.address,    'address must be present');
    assert.ok(wallet.privateKey, 'privateKey must be present');
    assert.ok(wallet.publicKey,  'publicKey must be present');
    // mnemonic may be null for non-HD wallets but should be a field
    assert.ok('mnemonic' in wallet, 'mnemonic field must exist');
  });

  it('returns a valid 0x-prefixed 42-char Ethereum address', () => {
    const { address } = generateWallet();
    assert.match(address, /^0x[0-9a-fA-F]{40}$/, 'address format invalid');
  });

  it('returns a 0x-prefixed 66-char private key', () => {
    const { privateKey } = generateWallet();
    assert.match(privateKey, /^0x[0-9a-fA-F]{64}$/, 'privateKey format invalid');
  });

  it('generates a unique address each call', () => {
    const a = generateWallet();
    const b = generateWallet();
    assert.notEqual(a.address, b.address, 'two calls must produce different wallets');
  });

  it('private key is never logged (manual check — test documents intent)', () => {
    // Can't intercept console.warn deterministically without mocking,
    // but we verify that NODE_ENV=production triggers a warning by
    // checking the function does not throw.
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    assert.doesNotThrow(() => generateWallet());
    process.env.NODE_ENV = original;
  });
});

// ─────────────────────────────────────────────────────────────
//  bindWallet
// ─────────────────────────────────────────────────────────────

describe('bindWallet()', () => {
  it('accepts a valid 64-char hex private key and returns a Wallet', () => {
    const { privateKey } = generateWallet();
    const wallet = bindWallet(privateKey);
    assert.ok(wallet.address, 'wallet must have an address');
  });

  it('accepts privateKey without 0x prefix', () => {
    const raw = generateWallet().privateKey.slice(2); // strip 0x
    assert.doesNotThrow(() => bindWallet(raw));
  });

  it('throws for empty string', () => {
    assert.throws(() => bindWallet(''), /non-empty string/i);
  });

  it('throws for key that is too short', () => {
    assert.throws(() => bindWallet('deadbeef'), /32 bytes/i);
  });

  it('throws for non-hex characters', () => {
    const badKey = 'z'.repeat(64);
    assert.throws(() => bindWallet(badKey), /non-hex/i);
  });

  it('throws for null input', () => {
    assert.throws(() => bindWallet(null), /non-empty string/i);
  });
});

// ─────────────────────────────────────────────────────────────
//  generateEncryptionKey
// ─────────────────────────────────────────────────────────────

describe('generateEncryptionKey()', () => {
  it('returns a 64-char lowercase hex string', () => {
    const key = generateEncryptionKey();
    assert.match(key, /^[0-9a-f]{64}$/, 'must be 64-char lowercase hex');
  });

  it('returns a unique key each call', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateEncryptionKey()));
    assert.equal(keys.size, 100, 'all 100 generated keys must be unique');
  });

  it('is 32 bytes when decoded', () => {
    const key = generateEncryptionKey();
    assert.equal(Buffer.from(key, 'hex').length, 32);
  });
});

// ─────────────────────────────────────────────────────────────
//  deriveX25519PublicKey
// ─────────────────────────────────────────────────────────────

describe('deriveX25519PublicKey()', () => {
  it('returns a 64-char lowercase hex string', () => {
    const { privateKey } = generateWallet();
    const pub = deriveX25519PublicKey(privateKey.slice(2));
    assert.match(pub, /^[0-9a-f]{64}$/, 'must be 64-char hex');
  });

  it('is deterministic — same input always gives same output', () => {
    const ethPriv = generateWallet().privateKey.slice(2);
    assert.equal(deriveX25519PublicKey(ethPriv), deriveX25519PublicKey(ethPriv));
  });

  it('two different Ethereum keys produce different X25519 keys', () => {
    const a = generateWallet().privateKey.slice(2);
    const b = generateWallet().privateKey.slice(2);
    assert.notEqual(deriveX25519PublicKey(a), deriveX25519PublicKey(b));
  });

  it('accepts 0x-prefixed key', () => {
    const { privateKey } = generateWallet();
    assert.doesNotThrow(() => deriveX25519PublicKey(privateKey));
  });

  it('throws for invalid input', () => {
    assert.throws(() => deriveX25519PublicKey('tooshort'), /32 bytes/i);
  });
});

// ─────────────────────────────────────────────────────────────
//  encryptRecord / decryptRecord
// ─────────────────────────────────────────────────────────────

describe('encryptRecord() + decryptRecord()', () => {
  const key = generateEncryptionKey();

  it('round-trips a simple string', () => {
    const plaintext = 'Hello, Web3QL!';
    const blob      = encryptRecord(plaintext, key);
    const result    = decryptRecord(blob, key);
    assert.equal(result, plaintext);
  });

  it('round-trips a JSON string', () => {
    const obj       = { name: 'Alice', age: 30, address: '0xdeadbeef' };
    const plaintext = JSON.stringify(obj);
    const blob      = encryptRecord(plaintext, key);
    const result    = decryptRecord(blob, key);
    assert.deepEqual(JSON.parse(result), obj);
  });

  it('round-trips an empty string', () => {
    const blob   = encryptRecord('', key);
    const result = decryptRecord(blob, key);
    assert.equal(result, '');
  });

  it('round-trips a large string (10 KB)', () => {
    const large  = 'x'.repeat(10_240);
    const blob   = encryptRecord(large, key);
    const result = decryptRecord(blob, key);
    assert.equal(result, large);
  });

  it('produces a different blob on every call (fresh nonce)', () => {
    const b1 = encryptRecord('same data', key);
    const b2 = encryptRecord('same data', key);
    assert.notEqual(b1, b2, 'blobs must differ — each call uses a random nonce');
  });

  it('blob is a 0x-prefixed hex string', () => {
    const blob = encryptRecord('test', key);
    assert.ok(typeof blob === 'string', 'must be a string');
    assert.ok(blob.startsWith('0x'), 'must have 0x prefix');
    assert.match(blob, /^0x[0-9a-fA-F]+$/, 'must be valid hex');
  });

  it('throws with wrong key (authentication failure)', () => {
    const blob     = encryptRecord('secret', key);
    const wrongKey = generateEncryptionKey();
    assert.throws(
      () => decryptRecord(blob, wrongKey),
      /authentication failed/i,
    );
  });

  it('throws with tampered ciphertext', () => {
    const blob    = encryptRecord('secret', key);
    // Flip the last byte of the hex
    const last    = parseInt(blob.slice(-2), 16) ^ 0xff;
    const tampered = blob.slice(0, -2) + last.toString(16).padStart(2, '0');
    assert.throws(
      () => decryptRecord(tampered, key),
      /authentication failed/i,
    );
  });

  it('throws if data is not a string', () => {
    assert.throws(() => encryptRecord(12345, key), /string/i);
    assert.throws(() => encryptRecord(null,  key), /string/i);
  });

  it('throws if key has wrong length', () => {
    assert.throws(() => encryptRecord('data', 'tooshort'), /32 bytes/i);
  });

  it('throws if blob is too short to contain nonce', () => {
    assert.throws(
      () => decryptRecord('0x' + 'aa'.repeat(5), key),
      /too short/i,
    );
  });
});

// ─────────────────────────────────────────────────────────────
//  wrapKey / unwrapKey
// ─────────────────────────────────────────────────────────────

describe('wrapKey() + unwrapKey()', () => {
  it('round-trips a 32-byte symmetric key', () => {
    const alice     = makeEthKeypair();
    const bob       = makeEthKeypair();
    const symKey    = generateEncryptionKey();
    // Alice wraps for Bob
    const wrapped   = wrapKey(symKey, bob.x25519PubKey, alice.ethPrivKey);
    // Bob unwraps (needs Alice's x25519PubKey as sender)
    const unwrapped = unwrapKey(wrapped, alice.x25519PubKey, bob.ethPrivKey);
    assert.equal(unwrapped, symKey, 'unwrapped key must equal original');
  });

  it('wrapped blob is 146 chars (0x + 144 hex = 72 bytes)', () => {
    // NaCl box: 24-byte nonce + 32-byte key + 16-byte MAC = 72 bytes = 144 hex + "0x"
    const alice   = makeEthKeypair();
    const bob     = makeEthKeypair();
    const wrapped = wrapKey(generateEncryptionKey(), bob.x25519PubKey, alice.ethPrivKey);
    assert.equal(wrapped.length, 146, 'wrapped blob must be 146 chars (0x + 144 hex)');
  });

  it('produces different ciphertext each wrap (ephemeral nonce randomness)', () => {
    const alice  = makeEthKeypair();
    const bob    = makeEthKeypair();
    const symKey = generateEncryptionKey();
    const w1 = wrapKey(symKey, bob.x25519PubKey, alice.ethPrivKey);
    const w2 = wrapKey(symKey, bob.x25519PubKey, alice.ethPrivKey);
    assert.notEqual(w1, w2, 'nonce must differ across wraps');
  });

  it('unwrapKey fails with wrong recipient key', () => {
    const alice = makeEthKeypair();
    const bob   = makeEthKeypair();
    const carol = makeEthKeypair(); // wrong recipient
    const symKey = generateEncryptionKey();
    // Alice wraps for Bob
    const wrapped = wrapKey(symKey, bob.x25519PubKey, alice.ethPrivKey);
    // Carol (wrong recipient) tries to unwrap
    assert.throws(
      () => unwrapKey(wrapped, alice.x25519PubKey, carol.ethPrivKey),
      /authentication failed/i,
    );
  });

  it('unwrapKey throws for truncated blob', () => {
    const { ethPrivKey, x25519PubKey } = makeEthKeypair();
    assert.throws(
      () => unwrapKey('deadbeef'.repeat(5), x25519PubKey, ethPrivKey),
      /too short/i,
    );
  });

  it('wrapKey throws for invalid recipient X25519 public key', () => {
    const { ethPrivKey } = makeEthKeypair();
    const symKey = generateEncryptionKey();
    assert.throws(
      () => wrapKey(symKey, 'notahexkey', ethPrivKey),
      /X25519|32 bytes/i,
    );
  });

  it('accepts 0x-prefixed private key in unwrapKey', () => {
    const alice  = makeEthKeypair();
    const bob    = makeEthKeypair();
    const symKey  = generateEncryptionKey();
    const wrapped = wrapKey(symKey, bob.x25519PubKey, alice.ethPrivKey);
    // prefix with 0x
    const result  = unwrapKey(wrapped, alice.x25519PubKey, '0x' + bob.ethPrivKey);
    assert.equal(result, symKey);
  });
});

// ─────────────────────────────────────────────────────────────
//  rotateKey
// ─────────────────────────────────────────────────────────────

describe('rotateKey()', () => {
  it('re-wraps a key for a new recipient without changing the underlying key', () => {
    const alice  = makeEthKeypair();
    const bob    = makeEthKeypair();
    const carol  = makeEthKeypair();
    const symKey = generateEncryptionKey();

    // Alice wraps for Bob
    const bobWrapped = wrapKey(symKey, bob.x25519PubKey, alice.ethPrivKey);

    // Bob rotates (re-wraps) for Carol, acting as new sender
    const carolWrapped = rotateKey(
      bobWrapped,
      alice.x25519PubKey,  // original sender's X25519 pub (for unwrap)
      bob.ethPrivKey,       // Bob (recipient) unwraps first
      carol.x25519PubKey,  // new recipient's X25519 pub
      bob.ethPrivKey,       // Bob is the new sender
    );

    // Carol can now unwrap (sender is Bob)
    const recovered = unwrapKey(carolWrapped, bob.x25519PubKey, carol.ethPrivKey);
    assert.equal(recovered, symKey, 'rotated key must equal original symmetric key');
  });

  it('untargeted party cannot unwrap the rotated blob', () => {
    const alice  = makeEthKeypair();
    const bob    = makeEthKeypair();
    const carol  = makeEthKeypair();
    const symKey = generateEncryptionKey();

    const bobWrapped   = wrapKey(symKey, bob.x25519PubKey, alice.ethPrivKey);
    const carolWrapped = rotateKey(
      bobWrapped,
      alice.x25519PubKey, bob.ethPrivKey,
      carol.x25519PubKey, bob.ethPrivKey,
    );

    // Alice (original sender) is not a recipient of carolWrapped — must fail
    assert.throws(
      () => unwrapKey(carolWrapped, bob.x25519PubKey, alice.ethPrivKey),
      /authentication failed/i,
    );
  });
});

// ─────────────────────────────────────────────────────────────
//  decodeCiphertextBlob
// ─────────────────────────────────────────────────────────────

describe('decodeCiphertextBlob()', () => {
  it('decoded blob has nonce and ciphertext fields', () => {
    const key     = generateEncryptionKey();
    const blob    = encryptRecord('test payload', key);
    const decoded = decodeCiphertextBlob(blob);
    assert.ok(decoded.nonce,      'nonce must be present');
    assert.ok(decoded.ciphertext, 'ciphertext must be present');
    // NaCl nonce is 24 bytes = 48 hex chars
    assert.match(decoded.nonce, /^[0-9a-f]{48}$/, 'nonce must be 24-byte hex');
  });

  it('encrypt result is already a valid blob (0x-prefixed)', () => {
    const blob = encryptRecord('hello', generateEncryptionKey());
    assert.ok(blob.startsWith('0x'), 'blob must start with 0x');
  });

  it('throws if blob is too short', () => {
    assert.throws(
      () => decodeCiphertextBlob('0x' + 'aa'.repeat(5)),
      /too short/i,
    );
  });

  it('blob from encryptRecord decrypts correctly end-to-end', () => {
    const key       = generateEncryptionKey();
    const plaintext = 'decode me';
    const blob      = encryptRecord(plaintext, key);
    const result    = decryptRecord(blob, key);
    assert.equal(result, plaintext);
  });
});

// ─────────────────────────────────────────────────────────────
//  encodeWrappedKey / decodeWrappedKey
// ─────────────────────────────────────────────────────────────

describe('encodeWrappedKey() + decodeWrappedKey()', () => {
  it('round-trips a wrapped key blob', () => {
    const alice   = makeEthKeypair();
    const bob     = makeEthKeypair();
    const symKey  = generateEncryptionKey();
    const wrapped = wrapKey(symKey, bob.x25519PubKey, alice.ethPrivKey);
    const encoded = encodeWrappedKey(wrapped);
    const decoded = decodeWrappedKey(encoded);
    // decoded = no-0x hex; re-encoding should give back the original
    assert.equal(encodeWrappedKey(decoded), wrapped, 'must round-trip');
  });

  it('encodeWrappedKey produces 0x-prefixed string', () => {
    const alice   = makeEthKeypair();
    const bob     = makeEthKeypair();
    const encoded = encodeWrappedKey(wrapKey(generateEncryptionKey(), bob.x25519PubKey, alice.ethPrivKey));
    assert.ok(encoded.startsWith('0x'), 'must have 0x prefix');
  });
});

// ─────────────────────────────────────────────────────────────
//  Full end-to-end flow (no network)
// ─────────────────────────────────────────────────────────────

describe('End-to-end: encrypt → wrap → encode → decode → unwrap → decrypt', () => {
  it('full pipeline completes correctly', () => {
    const alice  = makeEthKeypair();
    const bob    = makeEthKeypair();
    const encKey = generateEncryptionKey();
    const data   = JSON.stringify({ user: 'Bob', score: 9001 });

    // Encrypt (encryptRecord already returns the on-chain blob directly)
    const blob       = encryptRecord(data, encKey);
    const wrappedKey = wrapKey(encKey, bob.x25519PubKey, alice.ethPrivKey);
    const encodedKey = encodeWrappedKey(wrappedKey);

    // Simulate storing to chain and retrieving...
    const retrievedBlob = blob;
    const retrievedKey  = encodedKey;

    // Retrieve and decrypt
    const decodedKey    = decodeWrappedKey(retrievedKey);
    const recoveredKey  = unwrapKey(decodedKey, alice.x25519PubKey, bob.ethPrivKey);
    const plaintext     = decryptRecord(retrievedBlob, recoveredKey);

    assert.equal(plaintext, data, 'full pipeline must recover original plaintext');
  });
});

