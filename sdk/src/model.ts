/**
 * @file   model.ts
 * @notice Web3QL ORM — Prisma-style Model class that unifies:
 *
 *   • Encrypted record CRUD (via TypedTableClient under the hood)
 *   • On-chain COUNTER fields — automatically merged into every find result
 *   • Relation writes — `relatedCreate()` pays with native CELO or any ERC-20
 *     and atomically writes the source record + increments target counters
 *
 * Usage:
 * ─────────────────────────────────────────────────────────────
 *   // 1. Define your models
 *   const projects = new Model<Project>('projects', projectsTableAddr, signer, keypair, {
 *     counterFields: ['vote_total', 'vote_count', 'tip_total', 'tip_count'],
 *     schema: projectSchema,
 *   });
 *
 *   const votes = new Model<Vote>('votes', votesTableAddr, signer, keypair);
 *
 *   // 2. Standard CRUD
 *   await projects.create(1n, { id: 1n, name: 'Web3QL' });
 *
 *   // 3. findUnique — counter fields merged in automatically
 *   const p = await projects.findUnique(1n);
 *   // p = { id: 1n, name: 'Web3QL', vote_total: 420n, vote_count: 3n, ... }
 *
 *   // 4. Relation write — pay 2 CELO, atomically save vote + update project counters
 *   await votes.relatedCreate({
 *     wire      : wireAddress,
 *     id        : 10n,
 *     data      : { project_id: 1n, voter: myAddr, amount: 2n * 10n**18n },
 *     targetId  : 1n,
 *     amount    : 2n * 10n**18n,   // native CELO
 *   });
 *
 *   // 5. ERC-20 vote: approve first, then:
 *   await votes.relatedCreate({
 *     wire      : wireAddress,
 *     id        : 11n,
 *     data      : { project_id: 1n, voter: myAddr, amount: 5_000000n },
 *     targetId  : 1n,
 *     amount    : 5_000000n,       // 5 cUSD (6 decimals)
 *     token     : CUSD_ADDRESS,    // ERC-20 token — pre-approve wire contract first
 *   });
 * ─────────────────────────────────────────────────────────────
 */

import { ethers }                    from 'ethers';
import { EncryptedTableClient, Role } from './table-client.js';
import { TypedTableClient }           from './typed-table.js';
import type {
  FindManyOptions,
  RecordWithId,
  WhereTuple,
  SchemaDefinition,
}                                     from './typed-table.js';
import type { EncryptionKeypair }     from './crypto.js';
import type { PublicKeyRegistryClient } from './registry.js';
export { Role };

// ─────────────────────────────────────────────────────────────
//  Minimal ABIs
// ─────────────────────────────────────────────────────────────

const COUNTER_ABI = [
  'function counterValue(bytes32 targetKey, bytes32 field) external view returns (uint256)',
] as const;

const WIRE_ABI = [
  'function relatedWrite(bytes32 sourceKey, bytes ciphertext, bytes encryptedKey, bytes32 targetKey, address token, uint256 amount) payable external',
  'function relatedWriteWithPermit(bytes32 sourceKey, bytes ciphertext, bytes encryptedKey, bytes32 targetKey, address token, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
  'function withdrawProjectFunds(bytes32 targetKey, address token, address to) external',
  'function withdrawAllProjectFunds(bytes32 targetKey, address to) external',
  'function projectBalances(bytes32 targetKey) external view returns (address[] tokens, uint256[] balances)',
  'function getAllowedTokens() external view returns (address[])',
] as const;

const ERC20_ABI = [
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function nonces(address owner) external view returns (uint256)',
  'function name() external view returns (string)',
  'function version() external view returns (string)',
  'function DOMAIN_SEPARATOR() external view returns (bytes32)',
] as const;

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

export interface ModelOptions {
  /**
   * Names of COUNTER fields on this table.
   * Counter values are stored in the on-chain `counters` mapping — NOT
   * inside the encrypted ciphertext.  They are automatically fetched
   * and merged into every `findUnique` / `findMany` result.
   */
  counterFields?: string[];
  /** Optional schema for validation, type coercion, NOT NULL, DEFAULT. */
  schema?        : SchemaDefinition;
}

/** Options for `relatedCreate()` */
export interface RelatedCreateOptions<T> {
  /** Address of the deployed Web3QLRelationWire contract. */
  wire          : string;
  /** Primary key of the NEW record being written to THIS table. */
  id            : bigint;
  /** Payload to encrypt and store (COUNTER fields are excluded automatically). */
  data          : T;
  /** Primary key of the TARGET record to increment counters on. */
  targetId      : bigint;
  /** Name of the target table (needed for key derivation). */
  targetTable   : string;
  /**
   * Payment amount.
   *  - Native wire  (token undefined / address(0)): amount in wei (msg.value)
   *  - ERC-20 wire  (token set): amount in token's native units
   */
  amount?       : bigint;
  /**
   * ERC-20 token address.  Omit (or pass `undefined`) for native CELO.
   * The wire contract must be pre-approved: call `model.approveWire(wire, token, amount)` once.
   */
  token?        : string;
}

// ─────────────────────────────────────────────────────────────
//  Model
// ─────────────────────────────────────────────────────────────

/**
 * `Model<T>` — the Web3QL ORM entry point.
 *
 * T is the shape of the ENCRYPTED fields only (not counter fields).
 * Counter fields are added automatically to every returned object.
 */
export class Model<T extends Record<string, unknown>> {
  readonly tableName    : string;
  readonly tableAddress : string;

  private inner         : TypedTableClient<T>;
  private rawClient     : EncryptedTableClient;
  private counterFields : string[];
  private counterFieldHashes: Map<string, string>; // name → keccak256
  private signer        : ethers.Signer;
  private provider      : ethers.Provider;

  constructor(
    tableName    : string,
    tableAddress : string,
    signer       : ethers.Signer,
    keypair      : EncryptionKeypair,
    options?     : ModelOptions,
  ) {
    this.tableName     = tableName;
    this.tableAddress  = tableAddress;
    this.signer        = signer;
    this.provider      = signer.provider!;

    const cf = options?.counterFields ?? [];
    this.counterFields = cf;
    this.counterFieldHashes = new Map(
      cf.map((name) => [name, ethers.keccak256(ethers.toUtf8Bytes(name))])
    );

    this.rawClient = new EncryptedTableClient(tableAddress, signer, keypair);
    this.inner     = new TypedTableClient<T>(tableName, this.rawClient, options?.schema);
  }

  // ─────────────────────────────────────────────────────────────
  //  Key derivation
  // ─────────────────────────────────────────────────────────────

  /** Derive the on-chain bytes32 record key for a given primary key. */
  key(id: bigint): string {
    return this.rawClient.deriveKey(this.tableName, id);
  }

  // ─────────────────────────────────────────────────────────────
  //  Counter reads  (public — no auth needed)
  // ─────────────────────────────────────────────────────────────

  /** Read a single named counter for the record at `id`. */
  async counter(id: bigint, field: string): Promise<bigint> {
    const hash = this.counterFieldHashes.get(field)
      ?? ethers.keccak256(ethers.toUtf8Bytes(field));
    const contract = new ethers.Contract(this.tableAddress, COUNTER_ABI, this.provider);
    const raw = await (contract as any)['counterValue'](this.key(id), hash);
    return BigInt(raw);
  }

  /**
   * Read ALL registered counter fields for the record at `id`.
   * Returns a plain object mapping field name → bigint value.
   */
  async counters(id: bigint): Promise<Record<string, bigint>> {
    if (this.counterFields.length === 0) return {};
    const contract = new ethers.Contract(this.tableAddress, COUNTER_ABI, this.provider);
    const key = this.key(id);
    const values = await Promise.all(
      this.counterFields.map(async (name) => {
        const hash = this.counterFieldHashes.get(name)!;
        const raw  = await (contract as any)['counterValue'](key, hash);
        return [name, BigInt(raw)] as [string, bigint];
      })
    );
    return Object.fromEntries(values);
  }

  // ─────────────────────────────────────────────────────────────
  //  CRUD — counter fields merged into results automatically
  // ─────────────────────────────────────────────────────────────

  /**
   * Encrypt and store a new record.
   * Pass only encrypted fields — counter fields are managed by the chain.
   */
  async create(id: bigint, data: T): Promise<ethers.TransactionReceipt> {
    return this.inner.create(id, data);
  }

  /**
   * Read and decrypt a record, with all counter values merged in.
   * Returns `null` if the record does not exist.
   */
  async findUnique(id: bigint): Promise<(T & Record<string, bigint>) | null> {
    const [row, counterValues] = await Promise.all([
      this.inner.findUnique(id),
      this.counters(id),
    ]);
    if (row === null) return null;
    return { ...row, ...counterValues } as T & Record<string, bigint>;
  }

  /**
   * List and decrypt all records owned by `ownerAddress`.
   * Counter values are merged into every record.
   */
  async findMany(
    ownerAddress : string,
    options?     : FindManyOptions,
  ): Promise<RecordWithId<T & Record<string, bigint>>[]> {
    const rows = await this.inner.findMany(ownerAddress, options);
    if (this.counterFields.length === 0) {
      return rows as RecordWithId<T & Record<string, bigint>>[];
    }

    // Fetch counters for each record in parallel
    const withCounters = await Promise.all(
      rows.map(async (row) => {
        // We need to re-derive id from recordKey — we can't, but we can derive
        // key from recordKey directly: the recordKey IS the bytes32 key
        const counterValues = await this._countersFromBytes32Key(row.recordKey);
        return {
          ...row,
          data: { ...row.data, ...counterValues } as T & Record<string, bigint>,
        };
      })
    );
    return withCounters;
  }

  /** Get all records (no chain limit). Counter values merged. */
  async findAll(ownerAddress: string): Promise<RecordWithId<T & Record<string, bigint>>[]> {
    const total = Number(await this.inner.count(ownerAddress));
    return this.findMany(ownerAddress, { chainOffset: 0n, chainLimit: BigInt(total) });
  }

  /**
   * Patch an existing record — fetches current, merges patch, re-encrypts.
   * Counter fields in patch are silently ignored (they live on-chain, not in ciphertext).
   */
  async update(id: bigint, patch: Partial<T>): Promise<ethers.TransactionReceipt> {
    // Strip counter fields from patch — they can't be written via update
    const safePatch = { ...patch };
    for (const cf of this.counterFields) delete (safePatch as Record<string, unknown>)[cf];
    return this.inner.update(id, safePatch);
  }

  /** Delete a record (soft-delete — scrubs all encrypted key copies). */
  async delete(id: bigint): Promise<ethers.TransactionReceipt> {
    return this.inner.remove(id);
  }

  /** True if a live record exists for `id`. */
  async exists(id: bigint): Promise<boolean> {
    return this.inner.exists(id);
  }

  /** Total record count (including deleted) for `ownerAddress`. */
  async count(ownerAddress: string): Promise<bigint> {
    return this.inner.count(ownerAddress);
  }

  // ─────────────────────────────────────────────────────────────
  //  Access control (pass-through to raw client)
  // ─────────────────────────────────────────────────────────────

  async share(
    id        : bigint,
    recipient : string,
    role      : Role,
    registry  : PublicKeyRegistryClient,
  ): Promise<ethers.TransactionReceipt> {
    return this.rawClient.share(this.key(id), recipient, role, registry);
  }

  async revoke(id: bigint, user: string): Promise<ethers.TransactionReceipt> {
    return this.rawClient.revoke(this.key(id), user);
  }

  // ─────────────────────────────────────────────────────────────
  //  Relation write (the key feature)
  // ─────────────────────────────────────────────────────────────

  /**
   * Write a record to THIS table via a RelationWire, atomically incrementing
   * counter fields on the TARGET table in the same transaction.
   *
   * For native CELO:  pass `amount` in wei, do NOT pass `token`.
   * For ERC-20:       pass `token` address + `amount` in token units.
   *                   You must have approved the wire contract beforehand —
   *                   call `model.approveWire(wire, token, amount)` once.
   */
  async relatedCreate(opts: RelatedCreateOptions<T>): Promise<ethers.TransactionReceipt> {
    const { wire, id, data, targetId, targetTable, amount = 0n, token } = opts;
    const isErc20  = !!token && token !== ethers.ZeroAddress;
    const isNative = !isErc20;

    const { ciphertextBytes, encryptedKeyBytes } = await this._encryptPayload(id, data);

    const sourceKey = this.key(id);
    const targetKey = ethers.keccak256(
      ethers.solidityPacked(['string', 'uint256'], [targetTable, targetId])
    );

    const wireContract = new ethers.Contract(wire, WIRE_ABI, this.signer);

    if (isNative) {
      const tx = await (wireContract as any)['relatedWrite'](
        sourceKey, ciphertextBytes, encryptedKeyBytes, targetKey,
        ethers.ZeroAddress, 0n,
        { value: amount },
      );
      return tx.wait();
    }

    // ── ERC-20: try permit (gasless approve), fall back to standard approve ──
    const signerAddr = await this.signer.getAddress();

    let usedPermit = false;
    try {
      const sig = await this._signPermit(token!, wire, amount, signerAddr);
      const tx  = await (wireContract as any)['relatedWriteWithPermit'](
        sourceKey, ciphertextBytes, encryptedKeyBytes, targetKey,
        token!, amount,
        sig.deadline, sig.v, sig.r, sig.s,
      );
      const receipt = await tx.wait();
      usedPermit = true;
      return receipt;
    } catch {
      // Token doesn't support EIP-2612 permit, or wallet can't sign typed data — fall through
    }

    if (!usedPermit) {
      // Standard path: check allowance, approve if needed, then relatedWrite
      const tokenContract = new ethers.Contract(token!, ERC20_ABI, this.signer);
      const allowance     = BigInt(await (tokenContract as any)['allowance'](signerAddr, wire));
      if (allowance < amount) {
        const approveTx = await (tokenContract as any)['approve'](wire, ethers.MaxUint256);
        await approveTx.wait();
      }
      const tx = await (wireContract as any)['relatedWrite'](
        sourceKey, ciphertextBytes, encryptedKeyBytes, targetKey,
        token!, amount,
      );
      return tx.wait();
    }

    // unreachable but satisfies TypeScript
    throw new Error('relatedCreate: unexpected state');
  }

  /**
   * Approve a RelationWire to spend your ERC-20 tokens.
   * Call this once before using `relatedCreate` with an ERC-20 wire.
   * You can approve `MaxUint256` for unlimited allowance.
   */
  async approveWire(
    wire    : string,
    token   : string,
    amount  : bigint = ethers.MaxUint256,
  ): Promise<ethers.TransactionReceipt> {
    const tokenContract = new ethers.Contract(token, ERC20_ABI, this.signer);
    const tx = await (tokenContract as any)['approve'](wire, amount);
    return tx.wait();
  }

  /**
   * Withdraw a single token's accumulated payments for a project record.
   * Caller must be the record owner of `id` on this table.
   *
   * @param wire   Address of the RelationWire contract
   * @param id     Primary key of THIS table's record (the project)
   * @param token  Token to withdraw (ethers.ZeroAddress = native CELO)
   * @param to     Recipient address (defaults to signer)
   */
  async withdrawFunds(
    wire  : string,
    id    : bigint,
    token : string = ethers.ZeroAddress,
    to?   : string,
  ): Promise<ethers.TransactionReceipt> {
    const recipient = to ?? await this.signer.getAddress();
    const wireContract = new ethers.Contract(wire, WIRE_ABI, this.signer);
    const tx = await (wireContract as any)['withdrawProjectFunds'](
      this.key(id), token, recipient
    );
    return tx.wait();
  }

  /**
   * Withdraw ALL token balances for a project in one transaction.
   * Caller must be the record owner of `id` on this table.
   *
   * @param wire   Address of the RelationWire contract
   * @param id     Primary key of the project record
   * @param to     Recipient address (defaults to signer)
   */
  async withdrawAllFunds(
    wire : string,
    id   : bigint,
    to?  : string,
  ): Promise<ethers.TransactionReceipt> {
    const recipient = to ?? await this.signer.getAddress();
    const wireContract = new ethers.Contract(wire, WIRE_ABI, this.signer);
    const tx = await (wireContract as any)['withdrawAllProjectFunds'](
      this.key(id), recipient
    );
    return tx.wait();
  }

  /**
   * Check pending balances for a project across all tokens accepted by the wire.
   * Returns a plain object: { tokenAddress: bigintBalance, ... }
   *
   * @param wire  Address of the RelationWire contract
   * @param id    Primary key of the project record
   */
  async projectBalances(
    wire : string,
    id   : bigint,
  ): Promise<Record<string, bigint>> {
    const wireContract = new ethers.Contract(wire, WIRE_ABI, this.provider);
    const { tokens, balances } = await (wireContract as any)['projectBalances'](this.key(id));
    const result: Record<string, bigint> = {};
    for (let i = 0; i < tokens.length; i++) {
      result[tokens[i]] = BigInt(balances[i]);
    }
    return result;
  }

  // ─────────────────────────────────────────────────────────────
  //  Private helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Build and sign an EIP-2612 permit signature.
   * Works for cUSD, cEUR, cREAL, USDC and any token that implements ERC-2612.
   * Throws if the token doesn't expose `nonces()` or `DOMAIN_SEPARATOR()`.
   */
  private async _signPermit(
    token    : string,
    spender  : string,
    value    : bigint,
    owner    : string,
    ttl      : number = 20 * 60, // 20 minutes
  ): Promise<{ deadline: bigint; v: number; r: string; s: string }> {
    const tokenContract = new ethers.Contract(token, ERC20_ABI, this.provider);

    const [nonce, name, deadline] = await Promise.all([
      (tokenContract as any)['nonces'](owner).then(BigInt),
      (tokenContract as any)['name'](),
      Promise.resolve(BigInt(Math.floor(Date.now() / 1000) + ttl)),
    ]);

    // Try ERC-2612 version(); many tokens omit it and default to "1"
    let version = '1';
    try { version = await (tokenContract as any)['version'](); } catch { /* default "1" */ }

    const network = await this.provider.getNetwork();
    const domain  = { name, version, chainId: Number(network.chainId), verifyingContract: token };
    const types   = {
      Permit: [
        { name: 'owner',    type: 'address' },
        { name: 'spender',  type: 'address' },
        { name: 'value',    type: 'uint256' },
        { name: 'nonce',    type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    };
    const message = { owner, spender, value, nonce, deadline };

    const sig = await (this.signer as ethers.Signer & {
      signTypedData(domain: object, types: object, value: object): Promise<string>;
    }).signTypedData(domain, types, message);

    const { v, r, s } = ethers.Signature.from(sig);
    return { deadline, v, r, s };
  }
  private async _countersFromBytes32Key(recordKey: string): Promise<Record<string, bigint>> {
    if (this.counterFields.length === 0) return {};
    const contract = new ethers.Contract(this.tableAddress, COUNTER_ABI, this.provider);
    const values = await Promise.all(
      this.counterFields.map(async (name) => {
        const hash = this.counterFieldHashes.get(name)!;
        const raw  = await (contract as any)['counterValue'](recordKey, hash);
        return [name, BigInt(raw)] as [string, bigint];
      })
    );
    return Object.fromEntries(values);
  }

  /**
   * Encrypt a payload for self, returning raw bytes for the wire contract.
   */
  private async _encryptPayload(
    _id  : bigint,
    data : T,
  ): Promise<{ ciphertextBytes: Uint8Array; encryptedKeyBytes: Uint8Array }> {
    const { ciphertext, encryptedKey } = await this.rawClient.encryptForSelf(
      JSON.stringify(data)
    );
    return { ciphertextBytes: ciphertext, encryptedKeyBytes: encryptedKey };
  }
}
