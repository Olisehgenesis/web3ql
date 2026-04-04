/**
 * @file   relay.test.js
 * @notice End-to-end integration tests for the Web3QL sponsored relay.
 *
 * Tests the full flow:
 *   1. GET  /relay/info            — relay is configured & returns an address
 *   2. POST /relay/write           — sponsored write (relay pays gas)
 *   3. GET  /record/:addr/:id      — read back the encrypted record
 *   4. POST /relay/update          — sponsored update
 *   5. GET  /record/:addr/:id      — read back updated record
 *   6. POST /relay/delete          — sponsored delete
 *   7. GET  /record (after delete) — 404 / RECORD_DELETED
 *   8. POST /relay/write (bad key) — 401 Unauthorized
 *   9. POST /relay/write with userAddress — relay auto-grants read access to user
 *
 * Requires:
 *   • The connector server running locally (node api/server.js)
 *     OR set CONNECTOR_URL env var to point at a deployed instance.
 *   • tests/.env.test filled in (see .env.test for instructions).
 *
 * Run:
 *   node --test tests/relay.test.js
 *
 * The test file loads .env.test automatically — no need to export env vars manually.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────
//  Load .env.test
// ─────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '.env.test');

if (!existsSync(envPath)) {
  console.error('\n[relay.test] ERROR: tests/.env.test not found.');
  console.error('Copy tests/.env.test and fill in your values, then re-run.\n');
  process.exit(1);
}

// Simple .env parser — no external dependency needed
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim();
  if (key && !(key in process.env)) process.env[key] = val;
}

// ─────────────────────────────────────────────────────────────
//  Validate env before running any test
// ─────────────────────────────────────────────────────────────

const REQUIRED = ['RELAY_PRIVATE_KEY', 'RELAY_API_KEYS', 'TEST_TABLE_ADDRESS', 'TEST_TABLE_NAME'];
const missing  = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`\n[relay.test] ERROR: Missing required env vars: ${missing.join(', ')}`);
  console.error('Fill them in tests/.env.test\n');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
//  Imports (after env is loaded so any module using process.env picks up values)
// ─────────────────────────────────────────────────────────────

import {
  generateWallet,
  generateEncryptionKey,
  encryptRecord,
  decryptRecord,
  wrapKey,
  unwrapKey,
  deriveX25519PublicKey,
} from '../sdk/keyManager.js';

import { ethers } from 'ethers';

// ─────────────────────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────────────────────

const BASE_URL     = (process.env.CONNECTOR_URL ?? 'http://localhost:4000').replace(/\/$/, '')
const API_BASE     = `${BASE_URL}/api/connector`;
const API_KEY      = process.env.RELAY_API_KEYS.split(',')[0].trim();
const BAD_API_KEY  = 'wql_this_is_totally_invalid_000000000000000000000000';
const TABLE_ADDR   = process.env.TEST_TABLE_ADDRESS;
const TABLE_NAME   = process.env.TEST_TABLE_NAME;
const RELAY_PRIV   = process.env.RELAY_PRIVATE_KEY.startsWith('0x')
  ? process.env.RELAY_PRIVATE_KEY.slice(2)
  : process.env.RELAY_PRIVATE_KEY;
const CELO_RPC     = process.env.CELO_RPC_URL ?? 'https://forno.celo-sepolia.celo-testnet.org';

// Use a large unlikely record ID so we don't collide with existing data
const RECORD_ID    = Math.floor(Date.now() / 1000); // seconds since epoch

// ─────────────────────────────────────────────────────────────
//  Shared state across describe blocks
// ─────────────────────────────────────────────────────────────

let relayAddress;
let symKey;        // 32-byte Uint8Array
let userPrivKey;   // optional — loaded from env or generated fresh
let userPubKey;    // X25519 hex

// ─────────────────────────────────────────────────────────────
//  Helper: POST to relay endpoint
// ─────────────────────────────────────────────────────────────

async function relayPost(path, body, key = API_KEY) {
  const res = await fetch(`${API_BASE}${path}`, {
    method : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key'   : key,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function relayGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ─────────────────────────────────────────────────────────────
//  Setup: prepare keypairs, derive relay pubkey
// ─────────────────────────────────────────────────────────────

describe('Relay integration tests', () => {

  before(async () => {
    // Derive relay wallet X25519 pubkey — needed to wrap symmetric key for relay
    relayAddress = new ethers.Wallet('0x' + RELAY_PRIV).address;
    console.log(`\n  Relay wallet  : ${relayAddress}`);
    console.log(`  Table         : ${TABLE_ADDR}`);
    console.log(`  Table name    : ${TABLE_NAME}`);
    console.log(`  Record ID     : ${RECORD_ID}`);
    console.log(`  Connector URL : ${API_BASE}\n`);

    // Generate (or load) user wallet
    if (process.env.USER_PRIVATE_KEY) {
      const stripped = process.env.USER_PRIVATE_KEY.startsWith('0x')
        ? process.env.USER_PRIVATE_KEY.slice(2) : process.env.USER_PRIVATE_KEY;
      userPrivKey = stripped;
    } else {
      const fresh = generateWallet();
      userPrivKey = fresh.privateKey.slice(2);
      console.log(`  User wallet   : ${fresh.address} (ephemeral — generated for this run)`);
    }
    userPubKey  = deriveX25519PublicKey(userPrivKey);
  });

  // ───────────────────────────────────────────────────────────
  //  1.  GET /relay/info
  // ───────────────────────────────────────────────────────────

  it('GET /relay/info — returns configured relay address', async () => {
    const { status, data } = await relayGet('/relay/info');
    assert.equal(status, 200,  `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.success,    true,    'success should be true');
    assert.equal(data.configured, true,    'relay should be configured');
    assert.match(data.relayAddress, /^0x[0-9a-fA-F]{40}$/, 'relayAddress must be a valid 0x address');
    assert.equal(
      data.relayAddress.toLowerCase(),
      relayAddress.toLowerCase(),
      'relayAddress must match RELAY_PRIVATE_KEY wallet',
    );
    console.log(`    ✓ relay address: ${data.relayAddress}`);
  });

  // ───────────────────────────────────────────────────────────
  //  2.  Reject bad API key
  // ───────────────────────────────────────────────────────────

  it('POST /relay/write with bad API key — 401 Unauthorized', async () => {
    symKey = generateEncryptionKey();
    const relayPub    = deriveX25519PublicKey(RELAY_PRIV);
    const ciphertext  = encryptRecord({ test: 'bad key check' }, symKey);
    const wrappedKey  = wrapKey(symKey, relayPub, RELAY_PRIV);

    const { status, data } = await relayPost('/relay/write', {
      tableAddress        : TABLE_ADDR,
      tableName           : TABLE_NAME,
      recordId            : RECORD_ID,
      ciphertext,
      encryptedKeyForRelay: wrappedKey,
    }, BAD_API_KEY);

    assert.equal(status, 401, `Expected 401, got ${status}`);
    assert.equal(data.success, false, 'success should be false');
    assert.equal(data.code, 'UNAUTHORIZED');
    console.log(`    ✓ bad key rejected: ${data.error}`);
  });

  // ───────────────────────────────────────────────────────────
  //  3.  POST /relay/write (sponsored write)
  // ───────────────────────────────────────────────────────────

  it('POST /relay/write — relay pays gas, record written on-chain', async () => {
    symKey = generateEncryptionKey();

    const relayPub            = deriveX25519PublicKey(RELAY_PRIV);
    const ciphertext          = encryptRecord({ name: 'Alice', email: 'alice@test.com', ts: Date.now() }, symKey);
    const encryptedKeyForRelay = wrapKey(symKey, relayPub, RELAY_PRIV);
    const encryptedKeyForUser  = wrapKey(symKey, userPubKey, RELAY_PRIV);

    const { status, data } = await relayPost('/relay/write', {
      tableAddress        : TABLE_ADDR,
      tableName           : TABLE_NAME,
      recordId            : RECORD_ID,
      ciphertext,
      encryptedKeyForRelay,
      userAddress         : new ethers.Wallet('0x' + userPrivKey).address,
      encryptedKeyForUser,
    });

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.success, true, 'success should be true');
    assert.match(data.txHash,       /^0x[0-9a-fA-F]{64}$/, 'txHash must be a valid tx hash');
    assert.match(data.grantTxHash,  /^0x[0-9a-fA-F]{64}$/, 'grantTxHash must be present');
    assert.match(data.recordKey,    /^0x[0-9a-fA-F]{64}$/, 'recordKey must be 32-byte hex');
    assert.equal(data.relayAddress.toLowerCase(), relayAddress.toLowerCase());
    console.log(`    ✓ write txHash : ${data.txHash}`);
    console.log(`    ✓ grant txHash : ${data.grantTxHash}`);
  });

  // ───────────────────────────────────────────────────────────
  //  4.  GET /record — relay can read its own record
  // ───────────────────────────────────────────────────────────

  it('GET /record — relay wallet can read back its own record', async () => {
    const userAddr = new ethers.Wallet('0x' + userPrivKey).address;
    const url = `${API_BASE}/record/${TABLE_ADDR}/${RECORD_ID}?fromAddress=${relayAddress}&tableName=${TABLE_NAME}`;
    const res  = await fetch(url);
    const data = await res.json();

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    assert.equal(data.success, true);
    assert.ok(data.ciphertext && data.ciphertext !== '0x',   'ciphertext must be present');
    assert.ok(data.encryptedKey && data.encryptedKey !== '0x', 'encryptedKey must be present');

    // Relay decrypts its own copy
    const relayPub      = deriveX25519PublicKey(RELAY_PRIV);
    const recoveredKey  = unwrapKey(data.encryptedKey, relayPub, RELAY_PRIV);
    const plaintext     = decryptRecord(data.ciphertext, recoveredKey);

    assert.equal(plaintext.name,  'Alice',          'name should decrypt to Alice');
    assert.equal(plaintext.email, 'alice@test.com', 'email should decrypt correctly');
    console.log(`    ✓ relay decrypted record: ${JSON.stringify(plaintext)}`);
  });

  // ───────────────────────────────────────────────────────────
  //  5.  GET /record — user can read back (relay granted access)
  // ───────────────────────────────────────────────────────────

  it('GET /record — user wallet can read back (relay granted access in write)', async () => {
    const userAddr = new ethers.Wallet('0x' + userPrivKey).address;
    const url = `${API_BASE}/record/${TABLE_ADDR}/${RECORD_ID}?fromAddress=${userAddr}&tableName=${TABLE_NAME}`;
    const res  = await fetch(url);
    const data = await res.json();

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    assert.equal(data.success, true);

    // User decrypts their own key copy
    const relayPub     = deriveX25519PublicKey(RELAY_PRIV);
    const recoveredKey = unwrapKey(data.encryptedKey, relayPub, userPrivKey);
    const plaintext    = decryptRecord(data.ciphertext, recoveredKey);

    assert.equal(plaintext.name,  'Alice',          'user should decrypt name = Alice');
    assert.equal(plaintext.email, 'alice@test.com', 'user should decrypt email');
    console.log(`    ✓ user decrypted record: ${JSON.stringify(plaintext)}`);
  });

  // ───────────────────────────────────────────────────────────
  //  6.  POST /relay/update — change name field
  // ───────────────────────────────────────────────────────────

  it('POST /relay/update — relay pays gas, record updated on-chain', async () => {
    const relayPub            = deriveX25519PublicKey(RELAY_PRIV);
    const newCiphertext        = encryptRecord({ name: 'Alice Smith', email: 'alice@test.com', ts: Date.now() }, symKey);
    const encryptedKey         = wrapKey(symKey, relayPub, RELAY_PRIV);

    const { status, data } = await relayPost('/relay/update', {
      tableAddress : TABLE_ADDR,
      tableName    : TABLE_NAME,
      recordId     : RECORD_ID,
      ciphertext   : newCiphertext,
      encryptedKey,
    });

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.success, true);
    assert.match(data.txHash, /^0x[0-9a-fA-F]{64}$/);
    console.log(`    ✓ update txHash: ${data.txHash}`);
  });

  // ───────────────────────────────────────────────────────────
  //  7.  GET /record after update — verify new name
  // ───────────────────────────────────────────────────────────

  it('GET /record after update — name is Alice Smith', async () => {
    const url = `${API_BASE}/record/${TABLE_ADDR}/${RECORD_ID}?fromAddress=${relayAddress}&tableName=${TABLE_NAME}`;
    const res  = await fetch(url);
    const data = await res.json();

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);

    const relayPub     = deriveX25519PublicKey(RELAY_PRIV);
    const recoveredKey = unwrapKey(data.encryptedKey, relayPub, RELAY_PRIV);
    const plaintext    = decryptRecord(data.ciphertext, recoveredKey);

    assert.equal(plaintext.name, 'Alice Smith', 'name should be Alice Smith after update');
    console.log(`    ✓ updated record: ${JSON.stringify(plaintext)}`);
  });

  // ───────────────────────────────────────────────────────────
  //  8.  POST /relay/delete
  // ───────────────────────────────────────────────────────────

  it('POST /relay/delete — relay pays gas, record deleted on-chain', async () => {
    const { status, data } = await relayPost('/relay/delete', {
      tableAddress : TABLE_ADDR,
      tableName    : TABLE_NAME,
      recordId     : RECORD_ID,
    });

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.success, true);
    assert.match(data.txHash, /^0x[0-9a-fA-F]{64}$/);
    console.log(`    ✓ delete txHash: ${data.txHash}`);
  });

  // ───────────────────────────────────────────────────────────
  //  9.  GET /record after delete — should return 404
  // ───────────────────────────────────────────────────────────

  it('GET /record after delete — returns 404 RECORD_DELETED', async () => {
    const url = `${API_BASE}/record/${TABLE_ADDR}/${RECORD_ID}?fromAddress=${relayAddress}&tableName=${TABLE_NAME}`;
    const res  = await fetch(url);
    const data = await res.json();

    assert.equal(res.status, 404, `Expected 404, got ${res.status}: ${JSON.stringify(data)}`);
    assert.equal(data.success, false);
    assert.equal(data.code, 'RECORD_DELETED');
    console.log(`    ✓ deleted record correctly returns 404 RECORD_DELETED`);
  });

});

// ─────────────────────────────────────────────────────────────
//  Signed-intent tests (no API key — wallet signature is auth)
// ─────────────────────────────────────────────────────────────

describe('Signed intent flow (POST /relay/submit-intent)', () => {

  const INTENT_RECORD_ID = Math.floor(Date.now() / 1000) + 9001; // different from API key tests
  let intentSymKey;

  // Register the test user wallet with the relay before running intent tests.
  // This is needed because submit-intent now checks the wallet allowlist.
  // The wallet is pre-registered either via RELAY_ALLOWED_WALLETS env OR via
  // POST /relay/register-wallet (used here for dynamically-generated wallets).
  before(async () => {
    const userWallet = new ethers.Wallet('0x' + userPrivKey);
    const message    = `Register wallet for Web3QL relay: ${userWallet.address.toLowerCase()}`;
    const signature  = await userWallet.signMessage(message);

    const res = await fetch(`${API_BASE}/relay/register-wallet`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ walletAddress: userWallet.address, signature }),
    });
    const data = await res.json();
    if (!data.success) {
      console.error('[relay.test] Failed to register wallet:', data);
      throw new Error(`Wallet registration failed: ${data.error ?? JSON.stringify(data)}`);
    }
    console.log(`\n  Registered user wallet : ${data.walletAddress}`);
  });

  // Helper: build + sign an EIP-712 RelayIntent using ethers
  async function signIntent({ tableAddress, tableName, recordId, ciphertextHash, deadline, nonce, wallet }) {
    const chainId = Number((await new ethers.JsonRpcProvider(CELO_RPC).getNetwork()).chainId);
    const domain  = { name: 'Web3QL Relay', version: '1', chainId };
    const types   = {
      RelayIntent: [
        { name: 'tableAddress',   type: 'address' },
        { name: 'tableName',      type: 'string'  },
        { name: 'recordId',       type: 'uint256' },
        { name: 'ciphertextHash', type: 'bytes32' },
        { name: 'deadline',       type: 'uint256' },
        { name: 'nonce',          type: 'uint256' },
      ],
    };
    const value = {
      tableAddress,
      tableName,
      recordId     : BigInt(recordId),
      ciphertextHash,
      deadline     : BigInt(deadline),
      nonce        : BigInt(nonce),
    };
    return wallet.signTypedData(domain, types, value);
  }

  it('GET /relay/info — returns relayX25519PubKey', async () => {
    const { status, data } = await relayGet('/relay/info');
    assert.equal(status, 200);
    assert.ok(data.relayX25519PubKey, 'relayX25519PubKey should be present');
    assert.match(data.relayX25519PubKey, /^[0-9a-f]{64}$/, 'relayX25519PubKey must be 64-char hex');
    console.log(`    ✓ relayX25519PubKey: ${data.relayX25519PubKey}`);
  });

  it('POST /relay/submit-intent with expired deadline — 400 INTENT_EXPIRED', async () => {
    const userWallet = new ethers.Wallet('0x' + userPrivKey);
    const relayPub   = deriveX25519PublicKey(RELAY_PRIV);

    intentSymKey = generateEncryptionKey();
    const ciphertext     = encryptRecord({ intent: 'must fail — expired' }, intentSymKey);
    const ciphertextHash = ethers.keccak256(ciphertext);
    const deadline       = Math.floor(Date.now() / 1000) - 60; // 1 minute in the past
    const nonce          = Date.now();

    const signature = await signIntent({
      tableAddress: TABLE_ADDR, tableName: TABLE_NAME,
      recordId: INTENT_RECORD_ID, ciphertextHash, deadline, nonce,
      wallet: userWallet,
    });

    const { status, data } = await relayPost('/relay/submit-intent', {
      tableAddress         : TABLE_ADDR,
      tableName            : TABLE_NAME,
      recordId             : INTENT_RECORD_ID,
      ciphertext,
      encryptedKeyForRelay : wrapKey(intentSymKey, relayPub, RELAY_PRIV),
      encryptedKeyForUser  : wrapKey(intentSymKey, userPubKey, RELAY_PRIV),
      userAddress          : userWallet.address,
      signature,
      deadline,
      nonce,
    }, /* no API key */ '');

    assert.equal(status, 400);
    assert.equal(data.code, 'INTENT_EXPIRED');
    console.log(`    ✓ expired intent rejected: ${data.error}`);
  });

  it('POST /relay/submit-intent with tampered ciphertext — 401 INVALID_SIGNATURE', async () => {
    const userWallet = new ethers.Wallet('0x' + userPrivKey);
    const relayPub   = deriveX25519PublicKey(RELAY_PRIV);

    intentSymKey = generateEncryptionKey();
    const realCiphertext  = encryptRecord({ intent: 'real data' }, intentSymKey);
    const fakeCiphertext  = encryptRecord({ intent: 'tampered data' }, intentSymKey);
    const ciphertextHash  = ethers.keccak256(realCiphertext); // sign the REAL hash
    const deadline = Math.floor(Date.now() / 1000) + 300;
    const nonce    = Date.now() + 1;

    const signature = await signIntent({
      tableAddress: TABLE_ADDR, tableName: TABLE_NAME,
      recordId: INTENT_RECORD_ID, ciphertextHash, deadline, nonce,
      wallet: userWallet,
    });

    const { status, data } = await relayPost('/relay/submit-intent', {
      tableAddress         : TABLE_ADDR,
      tableName            : TABLE_NAME,
      recordId             : INTENT_RECORD_ID,
      ciphertext           : fakeCiphertext, // send DIFFERENT ciphertext than what was signed
      encryptedKeyForRelay : wrapKey(intentSymKey, relayPub, RELAY_PRIV),
      encryptedKeyForUser  : wrapKey(intentSymKey, userPubKey, RELAY_PRIV),
      userAddress          : userWallet.address,
      signature,
      deadline,
      nonce,
    }, '');

    assert.equal(status, 401);
    assert.equal(data.code, 'INVALID_SIGNATURE');
    console.log(`    ✓ tampered ciphertext rejected: ${data.error}`);
  });

  it('POST /relay/submit-intent — valid signature, relay pays gas, user gets read access', async () => {
    const userWallet = new ethers.Wallet('0x' + userPrivKey);
    const relayPub   = deriveX25519PublicKey(RELAY_PRIV);

    intentSymKey = generateEncryptionKey();
    const ciphertext     = encryptRecord({ name: 'Bob', role: 'tester', ts: Date.now() }, intentSymKey);
    const ciphertextHash = ethers.keccak256(ciphertext);
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min window
    const nonce    = Date.now() + 2;

    const signature = await signIntent({
      tableAddress: TABLE_ADDR, tableName: TABLE_NAME,
      recordId: INTENT_RECORD_ID, ciphertextHash, deadline, nonce,
      wallet: userWallet,
    });

    const { status, data } = await relayPost('/relay/submit-intent', {
      tableAddress         : TABLE_ADDR,
      tableName            : TABLE_NAME,
      recordId             : INTENT_RECORD_ID,
      ciphertext,
      encryptedKeyForRelay : wrapKey(intentSymKey, relayPub, RELAY_PRIV),
      encryptedKeyForUser  : wrapKey(intentSymKey, deriveX25519PublicKey(userPrivKey), userPrivKey),
      userAddress          : userWallet.address,
      signature,
      deadline,
      nonce,
    }, '');

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.success, true);
    assert.match(data.txHash,      /^0x[0-9a-fA-F]{64}$/);
    assert.match(data.grantTxHash, /^0x[0-9a-fA-F]{64}$/);
    assert.equal(data.userAddress.toLowerCase(), userWallet.address.toLowerCase());
    console.log(`    ✓ intent write txHash : ${data.txHash}`);
    console.log(`    ✓ intent grant txHash : ${data.grantTxHash}`);
  });

  it('POST /relay/submit-intent replayed — 400 NONCE_REPLAYED', async () => {
    // Same nonce as previous test — should be rejected
    const userWallet = new ethers.Wallet('0x' + userPrivKey);
    const relayPub   = deriveX25519PublicKey(RELAY_PRIV);
    const ciphertext = encryptRecord({ replay: true }, intentSymKey);
    const ciphertextHash = ethers.keccak256(ciphertext);
    const deadline = Math.floor(Date.now() / 1000) + 300;
    const nonce    = Date.now() + 2; // SAME nonce as previous successful test

    const signature = await signIntent({
      tableAddress: TABLE_ADDR, tableName: TABLE_NAME,
      recordId: INTENT_RECORD_ID + 1, ciphertextHash, deadline, nonce,
      wallet: userWallet,
    });

    const { status, data } = await relayPost('/relay/submit-intent', {
      tableAddress         : TABLE_ADDR,
      tableName            : TABLE_NAME,
      recordId             : INTENT_RECORD_ID + 1,
      ciphertext,
      encryptedKeyForRelay : wrapKey(intentSymKey, relayPub, RELAY_PRIV),
      encryptedKeyForUser  : wrapKey(intentSymKey, deriveX25519PublicKey(userPrivKey), userPrivKey),
      userAddress          : userWallet.address,
      signature,
      deadline,
      nonce,
    }, '');

    assert.equal(status, 400);
    assert.equal(data.code, 'NONCE_REPLAYED');
    console.log(`    ✓ replayed nonce rejected: ${data.error}`);
  });

  it('GET /record — user can read back their intent-written record', async () => {
    const userWallet = new ethers.Wallet('0x' + userPrivKey);
    const relayPub   = deriveX25519PublicKey(RELAY_PRIV);
    const url = `${API_BASE}/record/${TABLE_ADDR}/${INTENT_RECORD_ID}?fromAddress=${userWallet.address}&tableName=${TABLE_NAME}`;
    const res  = await fetch(url);
    const data = await res.json();

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    assert.equal(data.success, true);

    // User unwraps their key copy (relay is sender, user is recipient)
    const recoveredKey = unwrapKey(data.encryptedKey, relayPub, userPrivKey);
    const plaintext    = decryptRecord(data.ciphertext, recoveredKey);

    assert.equal(plaintext.name, 'Bob',    'name should be Bob');
    assert.equal(plaintext.role, 'tester', 'role should be tester');
    console.log(`    ✓ user decrypted intent record: ${JSON.stringify(plaintext)}`);
  });

});
