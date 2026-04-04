/**
 * @file   registry.ts
 * @notice Client for the on-chain PublicKeyRegistry contract.
 *
 * Why is a registry needed?
 * ─────────────────────────────────────────────────────────────
 *  When the owner wants to share a record with Alice, they need
 *  Alice's X25519 public key to encrypt the symmetric key for her.
 *  The registry is a simple on-chain mapping (address → bytes32)
 *  where each user registers their own encryption public key once,
 *  paying only ~40k gas.  After that anyone can look it up.
 *
 * Security note:
 *  The public key stored here is the X25519 key DERIVED from the
 *  Ethereum private key (sha256(ethPrivKey) → nacl keypair).
 *  It does NOT expose the Ethereum private key in any way.
 */

import { ethers }                               from 'ethers';
import { publicKeyToHex, hexToPublicKey }       from './crypto.js';
import type { EncryptionKeypair }               from './crypto.js';

// ─────────────────────────────────────────────────────────────
//  ABI — only what we need
// ─────────────────────────────────────────────────────────────

const REGISTRY_ABI = [
  'function register(bytes32 pubKey) external',
  'function getKey(address user) external view returns (bytes32)',
  'function hasKey(address user) external view returns (bool)',
  'event KeyRegistered(address indexed user, bytes32 publicKey)',
] as const;

// ─────────────────────────────────────────────────────────────
//  Client
// ─────────────────────────────────────────────────────────────

export class PublicKeyRegistryClient {
  private contract: ethers.Contract;

  constructor(
    registryAddress      : string,
    signerOrProvider     : ethers.Signer | ethers.Provider,
  ) {
    this.contract = new ethers.Contract(
      registryAddress,
      REGISTRY_ABI,
      signerOrProvider,
    );
  }

  /**
   * Register the caller's encryption public key on-chain.
   * Call this once per wallet — ~40k gas on Celo (~$0.001).
   *
   * @param keypair   Your EncryptionKeypair from deriveKeypairFromWallet(signer).
   */
  async register(keypair: EncryptionKeypair): Promise<ethers.TransactionReceipt> {
    const hex = publicKeyToHex(keypair.publicKey);
    const tx  = await this.contract.register(hex);
    return tx.wait();
  }

  /**
   * Check whether an address has registered a public key.
   */
  async hasKey(address: string): Promise<boolean> {
    return this.contract.hasKey(address);
  }

  /**
   * Get the X25519 public key for an address.
   * Throws if the address has not registered.
   */
  async getPublicKey(address: string): Promise<Uint8Array> {
    const hex = await this.contract.getKey(address) as string;
    return hexToPublicKey(hex);
  }

  /**
   * Get public keys for multiple addresses in a single batch of calls.
   * Returns `null` for any address that has not registered.
   */
  async getPublicKeys(
    addresses: string[],
  ): Promise<(Uint8Array | null)[]> {
    return Promise.all(
      addresses.map(async (addr) => {
        try {
          return await this.getPublicKey(addr);
        } catch {
          return null;
        }
      }),
    );
  }
}
