/**
 * @file   table-client.ts
 * @notice Base encrypted table client.
 *
 * This class wraps a Web3QL table contract proxy and handles ALL
 * encryption/decryption client-side.  The chain only ever sees:
 *   • ciphertext blobs (AES-equivalent via NaCl secretbox)
 *   • per-user encrypted key blobs   (NaCl box)
 *
 * Plaintext and symmetric keys never leave this class.
 *
 * Usage pattern:
 * ─────────────────────────────────────────────────────────────
 *   const client = new EncryptedTableClient(tableAddress, signer, keypair);
 *
 *   // Write — encrypts automatically
 *   await client.write(1n, JSON.stringify({ name: 'Alice' }));
 *
 *   // Read — decrypts automatically
 *   const data = await client.read(1n);         // '{"name":"Alice"}'
 *
 *   // Share with Bob (needs Bob registered in registry)
 *   await client.share(1n, bobAddress, Role.VIEWER, registry);
 *
 *   // Revoke
 *   await client.revoke(1n, bobAddress);
 */

import { ethers }                               from 'ethers';
import {
  EncryptionKeypair,
  generateSymmetricKey,
  encryptData,
  decryptData,
  encryptKeyForSelf,
  encryptKeyForRecipient,
  decryptKeyForSelf,
  decryptKeyFromSender,
}                                               from './crypto.js';
import type { PublicKeyRegistryClient }         from './registry.js';

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

export enum Role {
  VIEWER = 1,
  EDITOR = 2,
}

export interface RawRecord {
  ciphertext : Uint8Array;
  deleted    : boolean;
  version    : bigint;
  updatedAt  : bigint;
  owner      : string;
}

// ─────────────────────────────────────────────────────────────
//  Minimal ABI — functions shared by all Web3QL table contracts
// ─────────────────────────────────────────────────────────────

const TABLE_ABI = [
  // core
  'function write(bytes32 key, bytes calldata ciphertext, bytes calldata encryptedKey) external',
  'function read(bytes32 key) external view returns (bytes memory ciphertext, bool deleted, uint256 version, uint256 updatedAt, address owner)',
  'function update(bytes32 key, bytes calldata ciphertext, bytes calldata encryptedKey) external',
  'function deleteRecord(bytes32 key) external',
  // key management
  'function getMyEncryptedKey(bytes32 key) external view returns (bytes memory)',
  // access control
  'function grantAccess(bytes32 key, address user, uint8 role, bytes calldata encryptedKeyForUser) external',
  'function revokeAccess(bytes32 key, address user) external',
  // views
  'function recordExists(bytes32 key) external view returns (bool)',
  'function recordOwner(bytes32 key) external view returns (address)',
  'function collaboratorCount(bytes32 key) external view returns (uint8)',
  'function getCollaborators(bytes32 key) external view returns (address[] memory)',
  'function getRole(bytes32 resource, address user) external view returns (uint8)',
  // owner record enumeration
  'function ownerRecordCount(address addr) external view returns (uint256)',
  'function getOwnerRecords(address addr, uint256 start, uint256 limit) external view returns (bytes32[] memory)',
  // table metadata
  'function tableName() external view returns (string memory)',
] as const;

// ─────────────────────────────────────────────────────────────
//  EncryptedTableClient
// ─────────────────────────────────────────────────────────────

export class EncryptedTableClient {
  readonly tableAddress : string;
  protected contract   : ethers.Contract;
  protected signer     : ethers.Signer;

  /** The caller's X25519 keypair — private key STAYS in memory only. */
  private keypair      : EncryptionKeypair;

  constructor(
    tableAddress : string,
    signer       : ethers.Signer,
    keypair      : EncryptionKeypair,
    abi          : readonly string[] = TABLE_ABI,
  ) {
    this.tableAddress = tableAddress;
    this.signer       = signer;
    this.keypair      = keypair;
    this.contract     = new ethers.Contract(tableAddress, abi, signer);
  }

  // ── Key derivation ─────────────────────────────────────────

  /**
   * Derive the bytes32 on-chain record key from a table name + primary key.
   * Canonical scheme: keccak256(abi.encodePacked(tableName, id))
   * Matches the Solidity generator and connector — all three layers are aligned.
   */
  deriveKey(tableName: string, id: bigint): string {
    return ethers.solidityPackedKeccak256(
      ['string', 'uint256'],
      [tableName, id],
    );
  }

  // ── Write ──────────────────────────────────────────────────

  /**
   * Encrypt `plaintext` and store it as a new record.
   * The symmetric key is encrypted for the caller (owner).
   *
   * @param key        bytes32 record key (use deriveKey or pass directly).
   * @param plaintext  Any data you want to store — string or raw bytes.
   */
  async writeRaw(
    key       : string,
    plaintext : string | Uint8Array,
  ): Promise<ethers.TransactionReceipt> {
    const data         = toBytes(plaintext);
    const symKey       = generateSymmetricKey();
    const ciphertext   = encryptData(data, symKey);
    const encryptedKey = encryptKeyForSelf(symKey, this.keypair);

    const tx = await this.contract.write(key, ciphertext, encryptedKey);
    return tx.wait();
  }

  // ── Read ───────────────────────────────────────────────────

  /**
   * Read and decrypt a record.
   * Returns the plaintext as a UTF-8 string.
   * Throws if the record is deleted, doesn't exist, or you lack access.
   */
  async readPlaintext(key: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(key));
  }

  /**
   * Read and decrypt a record — returns raw bytes.
   */
  async readBytes(key: string): Promise<Uint8Array> {
    const raw         = await this.readRaw(key);
    const encKey      = await this.getMyEncryptedKey(key);
    const symKey      = decryptKeyForSelf(encKey, this.keypair);
    return decryptData(raw.ciphertext, symKey);
  }

  /**
   * Get the raw (still-encrypted) record from chain.
   */
  async readRaw(key: string): Promise<RawRecord> {
    const [ciphertext, deleted, version, updatedAt, owner] =
      await this.contract.read(key);
    if (deleted) throw new Error(`EncryptedTableClient: record ${key} is deleted`);
    return {
      ciphertext: toUint8Array(ciphertext),
      deleted,
      version,
      updatedAt,
      owner,
    };
  }

  // ── Update ─────────────────────────────────────────────────

  /**
   * Update an existing record with new plaintext.
   * Re-encrypts with a FRESH symmetric key — old key copies are NOT
   * automatically re-shared.  Call reshareAfterUpdate() afterwards
   * if collaborators need access to the updated version.
   */
  async updateRaw(
    key       : string,
    plaintext : string | Uint8Array,
  ): Promise<ethers.TransactionReceipt> {
    const data         = toBytes(plaintext);
    const symKey       = generateSymmetricKey();
    const ciphertext   = encryptData(data, symKey);
    const encryptedKey = encryptKeyForSelf(symKey, this.keypair);
    const tx = await this.contract.update(key, ciphertext, encryptedKey);
    return tx.wait();
  }

  // ── Delete ─────────────────────────────────────────────────

  /**
   * Delete a record.  The contract scrubs ALL collaborator key copies
   * on-chain.  Ciphertext remains but is permanently unreadable by
   * anyone (the symmetric key is gone).
   */
  async deleteRecord(key: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.deleteRecord(key);
    return tx.wait();
  }

  // ── Sharing ────────────────────────────────────────────────

  /**
   * Share a record with another user.
   *
   * Flow:
   *   1. Fetch caller's encrypted key from chain
   *   2. Decrypt to recover the symmetric key (requires caller's privkey)
   *   3. Fetch recipient's X25519 public key from the registry
   *   4. Re-encrypt the symmetric key for the recipient
   *   5. Call grantAccess on-chain with the new encrypted key copy
   *
   * @param key       bytes32 record key
   * @param recipient Address to share with
   * @param role      Role.VIEWER or Role.EDITOR
   * @param registry  PublicKeyRegistryClient to look up recipient's pubkey
   */
  async share(
    key       : string,
    recipient : string,
    role      : Role,
    registry  : PublicKeyRegistryClient,
  ): Promise<ethers.TransactionReceipt> {
    // 1. Get our own encrypted key copy from chain
    const myEncKey = await this.getMyEncryptedKey(key);

    // 2. Decrypt to get the plain symmetric key
    const symKey = decryptKeyForSelf(myEncKey, this.keypair);

    // 3. Look up recipient's public key from registry
    const recipientPubKey = await registry.getPublicKey(recipient);

    // 4. Re-encrypt the symmetric key for the recipient
    const recipientEncKey = encryptKeyForRecipient(
      symKey,
      recipientPubKey,
      this.keypair.privateKey,
    );

    // 5. Grant access on-chain
    const tx = await this.contract.grantAccess(
      key,
      recipient,
      role,
      recipientEncKey,
    );
    return tx.wait();
  }

  /**
   * Revoke a user's access.  Their encrypted key copy is scrubbed
   * on-chain — they can no longer decrypt the record.
   * (They may have decrypted and cached it locally — that is a
   *  client-side concern, not something the chain can prevent.)
   */
  async revoke(
    key  : string,
    user : string,
  ): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.revokeAccess(key, user);
    return tx.wait();
  }

  /**
   * After updating a record (which rotates the key), re-share with
   * all current collaborators so they can decrypt the new ciphertext.
   *
   * @param key            bytes32 record key
   * @param collaborators  List of addresses to re-share with
   * @param roles          Role for each address (parallel array)
   * @param registry       PublicKeyRegistryClient
   */
  async reshareAfterUpdate(
    key           : string,
    collaborators : string[],
    roles         : Role[],
    registry      : PublicKeyRegistryClient,
  ): Promise<void> {
    if (collaborators.length !== roles.length) {
      throw new Error('reshareAfterUpdate: collaborators and roles arrays must be same length');
    }
    for (let i = 0; i < collaborators.length; i++) {
      await this.share(key, collaborators[i]!, roles[i]!, registry);
    }
  }

  // ── Key helpers ────────────────────────────────────────────

  /** Fetch this caller's encrypted key blob from chain (still encrypted). */
  async getMyEncryptedKey(key: string): Promise<Uint8Array> {
    const hex = await this.contract.getMyEncryptedKey(key) as string;
    return ethers.getBytes(hex);
  }

  /**
   * Decrypt a symmetric key blob that was encrypted by a known sender
   * (use when you are a collaborator, not the owner — the sender's
   *  public key must be passed explicitly).
   */
  decryptSharedKey(
    encryptedKey    : Uint8Array,
    senderPublicKey : Uint8Array,
  ): Uint8Array {
    return decryptKeyFromSender(encryptedKey, senderPublicKey, this.keypair.privateKey);
  }

  // ── Views ──────────────────────────────────────────────────

  async exists(key: string): Promise<boolean> {
    return this.contract.recordExists(key);
  }

  async owner(key: string): Promise<string> {
    return this.contract.recordOwner(key);
  }

  async collaboratorCount(key: string): Promise<number> {
    return Number(await this.contract.collaboratorCount(key));
  }

  /** List bytes32 record keys owned by `addr` (paginated). */
  async listOwnerRecords(
    addr  : string,
    start : bigint = 0n,
    limit : bigint = 50n,
  ): Promise<string[]> {
    return this.contract.getOwnerRecords(addr, start, limit);
  }

  /** Total number of records written by `addr` (including deleted). */
  async ownerRecordCount(addr: string): Promise<bigint> {
    return this.contract.ownerRecordCount(addr);
  }
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function toBytes(data: string | Uint8Array): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return data;
}

function toUint8Array(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return ethers.getBytes(value); // hex string
}
