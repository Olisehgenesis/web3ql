/**
 * @file   access.ts
 * @notice Web3QL v1.2 — advanced access control.
 *
 * Extends the base OWNER/EDITOR/VIEWER per-record model with:
 *
 *   1. TIME-LIMITED ACCESS      — expiry block stored in a meta record.
 *                                 SDK checks expiry before decode.
 *   2. DELEGATED SIGNING        — sign a capability token so a 3rd party
 *                                 can write on your behalf without your wallet.
 *   3. PUBLIC TABLE MODE        — unencrypted writes. Anyone can read.
 *                                 Useful for leaderboards, public state.
 *   4. COLUMN-LEVEL ENCRYPTION  — different symmetric key per column.
 *                                 Viewers get keys only for their allowed columns.
 *
 * Usage — time-limited share:
 * ─────────────────────────────────────────────────────────────
 *   const am = new AccessManager(tableClient, signer, keypair, registry);
 *
 *   // Share record key1 with Bob, expires in 100 blocks
 *   await am.shareWithExpiry(key1, bobAddress, Role.VIEWER, registry, 100n);
 *
 *   // Bob reads record — SDK auto-checks expiry:
 *   const data = await am.readIfNotExpired(key1, bobAddress);
 *
 * Usage — delegated signing:
 * ─────────────────────────────────────────────────────────────
 *   // Alice signs a capability token for Bob to write to key1 once
 *   const token = await am.signCapability({ key: key1, action: 'write', nonce: 1n });
 *
 *   // Bob submits it — the relay/contract verifies Alice's signature
 *   await am.submitWithCapability(key1, plaintext, token);
 *
 * Usage — public table:
 * ─────────────────────────────────────────────────────────────
 *   const pub = new PublicTableClient(tableAddress, signer);
 *   await pub.write(key, plaintext);     // stored as plaintext
 *   const text = await pub.read(key);    // no decryption needed
 * ─────────────────────────────────────────────────────────────
 */

import { ethers }                                   from 'ethers';
import type { EncryptedTableClient }                from './table-client.js';
import { Role }                                     from './table-client.js';
import type { PublicKeyRegistryClient }             from './registry.js';
import type { EncryptionKeypair }                   from './crypto.js';
import {
  generateSymmetricKey,
  encryptData,
  decryptData,
  encryptKeyForSelf,
  decryptKeyForSelf,
}                                                   from './crypto.js';

export { Role };

// ─────────────────────────────────────────────────────────────
//  Time-limited access
// ─────────────────────────────────────────────────────────────

export interface TimedGrant {
  grantee    : string;  // address
  role       : Role;
  expiryBlock: bigint;  // block number after which access is revoked
  grantedAt  : bigint;  // block number the grant was created
}

/**
 * Stores a time-limited grant as a JSON meta record on-chain.
 *
 * Key scheme: keccak256(abi.encodePacked("__grant__", recordKey, grantee))
 */
export function grantMetaKey(
  client  : EncryptedTableClient,
  recordKey: string,
  grantee : string,
): string {
  return ethers.keccak256(
    ethers.solidityPacked(['string', 'bytes32', 'address'], ['__grant__', recordKey, grantee]),
  );
}

// ─────────────────────────────────────────────────────────────
//  Capability token (EIP-712-style off-chain signed message)
// ─────────────────────────────────────────────────────────────

export interface CapabilityToken {
  /** Signer's address (granter). */
  granter   : string;
  /** Address allowed to use this token. */
  grantee   : string;
  /** bytes32 record key the token applies to. */
  key       : string;
  /** 'write' | 'update' | 'delete' */
  action    : 'write' | 'update' | 'delete';
  /** Monotonic nonce to prevent replay. */
  nonce     : bigint;
  /** Block number after which token is invalid. 0 = never expires. */
  expiryBlock: bigint;
  /** ECDSA signature (over the above fields). */
  signature : string;
}

const CAP_DOMAIN = {
  name   : 'Web3QL Capability',
  version: '1',
};

const CAP_TYPES = {
  Capability: [
    { name: 'granter',    type: 'address' },
    { name: 'grantee',    type: 'address' },
    { name: 'key',        type: 'bytes32' },
    { name: 'action',     type: 'string'  },
    { name: 'nonce',      type: 'uint256' },
    { name: 'expiryBlock',type: 'uint256' },
  ],
};

// ─────────────────────────────────────────────────────────────
//  AccessManager
// ─────────────────────────────────────────────────────────────

export class AccessManager {
  private client   : EncryptedTableClient;
  private signer   : ethers.Signer;
  private keypair  : EncryptionKeypair;

  constructor(
    client : EncryptedTableClient,
    signer : ethers.Signer,
    keypair: EncryptionKeypair,
  ) {
    this.client  = client;
    this.signer  = signer;
    this.keypair = keypair;
  }

  // ── Time-limited sharing ─────────────────────────────────────

  /**
   * Share a record with expiry — stores a signed grant meta record on-chain.
   *
   * @param recordKey    bytes32 record key to share.
   * @param recipient    Address to grant access to.
   * @param role         Role.VIEWER or Role.EDITOR.
   * @param registry     PublicKeyRegistryClient to look up recipient's pubkey.
   * @param expiryBlocks Number of blocks until the grant expires.
   */
  async shareWithExpiry(
    recordKey    : string,
    recipient    : string,
    role         : Role,
    registry     : PublicKeyRegistryClient,
    expiryBlocks : bigint,
  ): Promise<void> {
    // 1. Standard key share
    await this.client.share(recordKey, recipient, role, registry);

    // 2. Store grant metadata on-chain
    const provider    = (this.signer as ethers.Wallet).provider;
    const currentBlock = provider ? BigInt(await provider.getBlockNumber()) : 0n;
    const meta: TimedGrant = {
      grantee    : recipient.toLowerCase(),
      role,
      expiryBlock: currentBlock + expiryBlocks,
      grantedAt  : currentBlock,
    };

    const metaKey = grantMetaKey(this.client, recordKey, recipient);
    await this.client.writeRaw(metaKey, JSON.stringify(meta));
  }

  /**
   * Check whether a grant is still valid (not past expiry block).
   * Returns the TimedGrant if valid, null if expired or not found.
   */
  async checkGrant(recordKey: string, grantee: string): Promise<TimedGrant | null> {
    const metaKey = grantMetaKey(this.client, recordKey, grantee);
    try {
      const exists = await this.client.exists(metaKey);
      if (!exists) return null;
      const json  = await this.client.readPlaintext(metaKey);
      const grant = JSON.parse(json) as TimedGrant;
      grant.expiryBlock = BigInt(grant.expiryBlock);
      grant.grantedAt   = BigInt(grant.grantedAt);

      const provider = (this.signer as ethers.Wallet).provider;
      if (provider) {
        const currentBlock = BigInt(await provider.getBlockNumber());
        if (grant.expiryBlock > 0n && currentBlock > grant.expiryBlock) {
          // Grant has expired — auto-revoke
          await this.client.revoke(recordKey, grantee).catch(() => {/* ignore */});
          return null;
        }
      }
      return grant;
    } catch {
      return null;
    }
  }

  /**
   * Revoke an expired or unwanted timed grant.
   */
  async revokeGrant(recordKey: string, grantee: string): Promise<void> {
    await this.client.revoke(recordKey, grantee);
  }

  // ── Capability tokens ────────────────────────────────────────

  /**
   * Sign a capability token that allows `grantee` to perform `action` on `key`.
   *
   * The signature uses EIP-712 typed data. The relay or contract can verify
   * the granter's address from the signature without trusting the grantee.
   */
  async signCapability(params: {
    grantee    : string;
    key        : string;
    action     : 'write' | 'update' | 'delete';
    nonce      : bigint;
    expiryBlock: bigint;
  }): Promise<CapabilityToken> {
    const granter   = await this.signer.getAddress();
    const message = {
      granter,
      grantee    : params.grantee,
      key        : params.key,
      action     : params.action,
      nonce      : params.nonce,
      expiryBlock: params.expiryBlock,
    };
    const signature = await (this.signer as ethers.Wallet).signTypedData(
      CAP_DOMAIN,
      CAP_TYPES,
      message,
    );
    return { ...message, signature, granter };
  }

  /**
   * Verify a capability token was signed by the stated granter and is not expired.
   * Returns the recovered granter address, or throws if invalid.
   */
  static async verifyCapability(
    token   : CapabilityToken,
    provider: ethers.Provider,
  ): Promise<string> {
    const currentBlock = BigInt(await provider.getBlockNumber());
    if (token.expiryBlock > 0n && currentBlock > token.expiryBlock) {
      throw new Error('CapabilityToken: expired');
    }

    const message = {
      granter    : token.granter,
      grantee    : token.grantee,
      key        : token.key,
      action     : token.action,
      nonce      : token.nonce,
      expiryBlock: token.expiryBlock,
    };

    const recovered = ethers.verifyTypedData(CAP_DOMAIN, CAP_TYPES, message, token.signature);
    if (recovered.toLowerCase() !== token.granter.toLowerCase()) {
      throw new Error('CapabilityToken: signature mismatch');
    }
    return recovered;
  }
}

// ─────────────────────────────────────────────────────────────
//  Public table client — re-exported from dedicated module
// ─────────────────────────────────────────────────────────────

/**
 * PublicTableClient has been moved to public-table-client.ts to align with
 * the Web3QLPublicTable contract (plaintext, field-key schema validation,
 * open writes by default).  The export here keeps the old import path working.
 */
export {
  PublicTableClient,
  PublicTableValidationError,
  computeFieldKeys,
  derivePublicKey,
  validatePublicRecord,
}                                                     from './public-table-client.js';
export type {
  PublicRawRecord,
  PublicRecordResult,
  PublicFindManyOptions,
}                                                     from './public-table-client.js';

// ─────────────────────────────────────────────────────────────
//  Column-level encryption helpers
// ─────────────────────────────────────────────────────────────

/**
 * ColumnKeySet: encrypt specific columns with different symmetric keys.
 *
 * Scenario: a "users" table has columns [id, name, email, salary].
 * You want VIEWER-role collaborators to see name but NOT salary.
 *
 * Solution:
 *   • Split row into two groups: visible={id, name} and private={email, salary}
 *   • Encrypt each group with a separate symmetric key
 *   • VIEWER gets the key for the visible group only
 *   • EDITOR gets both keys
 */
export interface ColumnKeySet {
  /** Symmetric key for the "public within this sharing scope" columns */
  visibleKey : Uint8Array;
  /** Symmetric key for the private columns */
  privateKey : Uint8Array;
  /** Columns encrypted with visibleKey */
  visibleCols: string[];
}

/**
 * Split a plain JS row object into two encrypted blobs —
 * one for visible columns, one for private columns.
 */
export function encryptWithColumnKeys(
  row        : Record<string, unknown>,
  visibleCols: string[],
  visibleKey : Uint8Array,
  privateKey : Uint8Array,
): { visible: Uint8Array; private: Uint8Array } {
  const visiblePart: Record<string, unknown> = {};
  const privatePart: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(row)) {
    if (visibleCols.includes(k)) visiblePart[k] = v;
    else privatePart[k] = v;
  }

  return {
    visible : encryptData(new TextEncoder().encode(JSON.stringify(visiblePart)), visibleKey),
    private : encryptData(new TextEncoder().encode(JSON.stringify(privatePart)), privateKey),
  };
}

/**
 * Decrypt and merge the two column blobs.
 */
export function decryptColumnBlobs(
  visibleBlob : Uint8Array,
  privateBlob : Uint8Array,
  visibleKey  : Uint8Array,
  privateKey  : Uint8Array,
): Record<string, unknown> {
  const visibleText = new TextDecoder().decode(decryptData(visibleBlob, visibleKey));
  const privateText = new TextDecoder().decode(decryptData(privateBlob, privateKey));
  return {
    ...JSON.parse(visibleText) as Record<string, unknown>,
    ...JSON.parse(privateText) as Record<string, unknown>,
  };
}

// ─────────────────────────────────────────────────────────────
//  Convenience: generate fresh column key set
// ─────────────────────────────────────────────────────────────

export function generateColumnKeySet(visibleCols: string[]): ColumnKeySet {
  return {
    visibleKey  : generateSymmetricKey(),
    privateKey  : generateSymmetricKey(),
    visibleCols,
  };
}

// Export for self-encryption helpers (used by AccessManager internally)
export { encryptKeyForSelf, decryptKeyForSelf };
