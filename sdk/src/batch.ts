/**
 * @file   batch.ts
 * @notice Web3QL v1.2 — atomic batch writes via Multicall3.
 *
 * Problem:
 *   Each record write is one Ethereum transaction. Writing N records costs N
 *   round-trips and creates N separate on-chain entries. For bulk operations
 *   this is slow and expensive.
 *
 * Solution:
 *   Multicall3 (deployed at 0xcA11bde05977b3631167028862bE2a173976CA11 on
 *   most EVM chains including Celo) lets you batch N contract calls into a
 *   single transaction. All calls succeed or all revert — atomicity at EVM level.
 *
 * Usage:
 * ─────────────────────────────────────────────────────────────
 *   const batch = new BatchWriter(tableClient, signer);
 *
 *   // Stage writes
 *   await batch.stageWrite(key1, plaintext1);
 *   await batch.stageWrite(key2, plaintext2);
 *   await batch.stageUpdate(key3, newPlaintext3);
 *
 *   // Submit all at once (single tx)
 *   const receipt = await batch.submit();
 *
 * Limitations:
 *   • Each call still encrypts with a fresh per-record symmetric key.
 *   • If total calldata exceeds the block gas limit, submission will fail.
 *     Keep batches under ~100 records for safety on Celo.
 *   • Multicall3 is non-atomic by default. Use allowFailure=false for
 *     atomicity (any single failure reverts all).
 * ─────────────────────────────────────────────────────────────
 */

import { ethers }                               from 'ethers';
import type { EncryptedTableClient }            from './table-client.js';
import {
  generateSymmetricKey,
  encryptData,
  encryptKeyForSelf,
}                                               from './crypto.js';
import type { EncryptionKeypair }               from './crypto.js';
import { BatchResult, BatchError }              from './errors.js';

// ─────────────────────────────────────────────────────────────
//  Multicall3 — deployed at the same address on all major EVM chains
// ─────────────────────────────────────────────────────────────

export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

const MULTICALL3_ABI = [
  `function aggregate3(
    tuple(address target, bool allowFailure, bytes callData)[] calls
  ) external payable returns (tuple(bool success, bytes returnData)[] returnData)`,
] as const;

// ─────────────────────────────────────────────────────────────
//  Staged operation
// ─────────────────────────────────────────────────────────────

type OpType = 'write' | 'update' | 'delete';

interface StagedOp {
  type    : OpType;
  target  : string;   // table contract address
  callData: string;   // ABI-encoded call
  key     : string;   // bytes32 record key — for result tracking
}

// ─────────────────────────────────────────────────────────────
//  Revert reason decoder
// ─────────────────────────────────────────────────────────────

function decodeRevertReason(returnData: string, success: boolean): string | undefined {
  if (success || !returnData || returnData === '0x') return undefined;
  try {
    // Standard Error(string) ABI selector: 0x08c379a0
    if (returnData.startsWith('0x08c379a0')) {
      const [msg] = ethers.AbiCoder.defaultAbiCoder().decode(
        ['string'],
        '0x' + returnData.slice(10),
      );
      return msg as string;
    }
  } catch { /* non-standard revert data */ }
  return `raw: ${returnData.slice(0, 66)}`;
}

export { BatchResult, BatchError };

// ─────────────────────────────────────────────────────────────
//  Table ABI (minimal subset for encoding)
// ─────────────────────────────────────────────────────────────

const TABLE_IFACE = new ethers.Interface([
  'function write(bytes32 key, bytes calldata ciphertext, bytes calldata encryptedKey) external',
  'function update(bytes32 key, bytes calldata ciphertext, bytes calldata encryptedKey, uint32 expectedVersion) external',
  'function deleteRecord(bytes32 key) external',
]);

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : data;
}

// ─────────────────────────────────────────────────────────────
//  BatchWriter
// ─────────────────────────────────────────────────────────────

export class BatchWriter {
  private tableClient : EncryptedTableClient;
  private keypair     : EncryptionKeypair;
  private signer      : ethers.Signer;
  private multicall   : ethers.Contract;
  private ops         : StagedOp[] = [];

  constructor(
    tableClient     : EncryptedTableClient,
    signer          : ethers.Signer,
    keypair         : EncryptionKeypair,
    multicallAddress: string = MULTICALL3_ADDRESS,
  ) {
    this.tableClient = tableClient;
    this.keypair     = keypair;
    this.signer      = signer;
    this.multicall   = new ethers.Contract(multicallAddress, MULTICALL3_ABI, signer);
  }

  // ── Stage operations ────────────────────────────────────────

  /**
   * Stage a write (new record).
   * Encrypts the plaintext synchronously before staging.
   */
  async stageWrite(key: string, plaintext: string | Uint8Array, tableAddress?: string): Promise<this> {
    const data         = toBytes(plaintext);
    const symKey       = generateSymmetricKey();
    const ciphertext   = encryptData(data, symKey);
    const encryptedKey = encryptKeyForSelf(symKey, this.keypair);

    const target   = tableAddress ?? this.tableClient.tableAddress;
    const callData = TABLE_IFACE.encodeFunctionData('write', [key, ciphertext, encryptedKey]);
    this.ops.push({ type: 'write', target, callData, key });
    return this;
  }

  /**
   * Stage an update (overwrite existing record).
   */
  async stageUpdate(key: string, plaintext: string | Uint8Array, tableAddress?: string): Promise<this> {
    const data         = toBytes(plaintext);
    const symKey       = generateSymmetricKey();
    const ciphertext   = encryptData(data, symKey);
    const encryptedKey = encryptKeyForSelf(symKey, this.keypair);

    const target   = tableAddress ?? this.tableClient.tableAddress;
    const callData = TABLE_IFACE.encodeFunctionData('update', [key, ciphertext, encryptedKey, 0]);
    this.ops.push({ type: 'update', target, callData, key });
    return this;
  }

  /**
   * Stage a delete.
   */
  stageDelete(key: string, tableAddress?: string): this {
    const target   = tableAddress ?? this.tableClient.tableAddress;
    const callData = TABLE_IFACE.encodeFunctionData('deleteRecord', [key]);
    this.ops.push({ type: 'delete', target, callData, key });
    return this;
  }

  /** Number of staged operations. */
  get size(): number { return this.ops.length; }

  /** Clear all staged operations without submitting. */
  clear(): void { this.ops = []; }

  // ── Submit ──────────────────────────────────────────────────

  /**
   * Submit all staged operations as a single Multicall3 transaction.
   *
   * @param allowFailure  If true (default), individual call failures don't revert
   *                      the whole batch. Set false for full atomicity.
   * @returns             The transaction receipt + per-call results.
   */
  async submit(allowFailure = true): Promise<{
    receipt : ethers.TransactionReceipt;
    results : BatchResult[];
  }> {
    if (this.ops.length === 0) throw new Error('BatchWriter: no operations staged');

    const calls = this.ops.map((op) => ({
      target      : op.target,
      allowFailure,
      callData    : op.callData,
    }));

    // Pre-flight simulation to capture per-call success/failure BEFORE spending gas.
    // Using staticCall avoids any state mutation while giving us the return data.
    let simResults: { success: boolean; returnData: string }[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = await (this.multicall as any).aggregate3.staticCall(calls);
      simResults = raw as { success: boolean; returnData: string }[];
    } catch (simErr) {
      if (!allowFailure) {
        // Bail early — entire batch would revert; no gas wasted.
        throw new BatchError('Batch would revert entirely (pre-flight check failed)', [], simErr);
      }
      // allowFailure=true: simulation threw (e.g. RPC issue), proceed anyway.
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx      = await (this.multicall as any).aggregate3(calls);
    const receipt = await tx.wait() as ethers.TransactionReceipt;

    const opsSnapshot = this.ops.slice(); // capture before clearing
    this.ops = [];

    const results: BatchResult[] = opsSnapshot.map((op, i) => {
      const sim = simResults[i];
      return {
        index     : i,
        type      : op.type,
        key       : op.key,
        success   : sim?.success ?? true,
        returnData: sim?.returnData ?? '0x',
        error     : sim ? decodeRevertReason(sim.returnData, sim.success) : undefined,
      };
    });

    return { receipt, results };
  }

  // ── Convenience: batch seed ─────────────────────────────────

  /**
   * Encode and stage N write operations from an array of (key, plaintext) pairs,
   * then submit in chunks to avoid hitting block gas limits.
   *
   * @param rows          Array of { key, plaintext } to write.
   * @param chunkSize     Max records per transaction. Default: 50.
   * @param allowFailure  Passed to each submit() call.
   */
  async seedBatch(
    rows        : { key: string; plaintext: string }[],
    chunkSize   : number = 50,
    allowFailure: boolean = true,
  ): Promise<{ receipts: ethers.TransactionReceipt[]; failed: BatchResult[] }> {
    const receipts: ethers.TransactionReceipt[] = [];
    const failed: BatchResult[] = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      for (const row of chunk) await this.stageWrite(row.key, row.plaintext);
      const { receipt, results } = await this.submit(allowFailure);
      receipts.push(receipt);
      failed.push(...results.filter((r) => !r.success));
    }
    return { receipts, failed };
  }
}

// ─────────────────────────────────────────────────────────────
//  Multi-table batch  (writes across several tables in one tx)
// ─────────────────────────────────────────────────────────────

export interface CrossTableOp {
  tableAddress: string;
  type        : 'write' | 'update' | 'delete';
  key         : string;
  plaintext?  : string;
}

/**
 * Build a Multicall3 batch across multiple different table contracts.
 *
 * Each op specifies the target table address explicitly, so you can write
 * to `users`, `posts`, and `comments` in a single atomic transaction.
 */
export async function buildCrossTableBatch(
  ops    : CrossTableOp[],
  keypair: EncryptionKeypair,
): Promise<{ target: string; allowFailure: boolean; callData: string }[]> {
  const calls: { target: string; allowFailure: boolean; callData: string }[] = [];

  for (const op of ops) {
    let callData: string;

    if (op.type === 'delete') {
      callData = TABLE_IFACE.encodeFunctionData('deleteRecord', [op.key]);
    } else {
      if (!op.plaintext) throw new Error(`buildCrossTableBatch: plaintext required for ${op.type}`);
      const data         = new TextEncoder().encode(op.plaintext);
      const symKey       = generateSymmetricKey();
      const ciphertext   = encryptData(data, symKey);
      const encryptedKey = encryptKeyForSelf(symKey, keypair);
      const fn           = op.type === 'write' ? 'write' : 'update';
      callData = TABLE_IFACE.encodeFunctionData(fn, [op.key, ciphertext, encryptedKey]);
    }

    calls.push({ target: op.tableAddress, allowFailure: true, callData });
  }

  return calls;
}
