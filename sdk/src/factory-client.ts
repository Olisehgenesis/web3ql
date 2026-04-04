/**
 * @file   factory-client.ts
 * @notice High-level client for the Web3QL Factory + Database contracts.
 *
 * Entry point for every Web3QL app:
 * ─────────────────────────────────────────────────────────────
 *   const web3ql = new Web3QLClient(factoryAddress, signer, keypair, registryAddress);
 *
 *   // Register your public key once (one-time, ~40k gas)
 *   await web3ql.register();
 *
 *   // Create a personal database (or get existing)
 *   const db = await web3ql.getOrCreateDatabase();
 *
 *   // Create a table
 *   const tableAddr = await db.createTable('users', schemaBytes);
 *
 *   // Get an encrypted client for that table
 *   const users = db.table(tableAddr);
 *
 *   // Write (auto-encrypts)
 *   await users.writeRaw(users.deriveKey('users', 1n), '{"name":"Alice"}');
 */

import { ethers }                               from 'ethers';
import { EncryptedTableClient }                 from './table-client.js';
import { PublicKeyRegistryClient }              from './registry.js';
import type { EncryptionKeypair }               from './crypto.js';

// ─────────────────────────────────────────────────────────────
//  ABIs
// ─────────────────────────────────────────────────────────────

const FACTORY_ABI = [
  'function createDatabase(string calldata name) external returns (address)',
  'function getUserDatabases(address user) external view returns (address[] memory)',
  'function databaseImplementation() external view returns (address)',
  'function tableImplementation() external view returns (address)',
  'function databaseCount() external view returns (uint256)',
  'function removeDatabase(address db) external',
  'event DatabaseCreated(address indexed owner, address indexed db, uint256 indexed index)',
  'event DatabaseRemoved(address indexed owner, address indexed db)',
] as const;

const DATABASE_ABI = [
  'function createTable(string calldata name, bytes calldata schemaBytes) external returns (address)',
  'function getTable(string calldata name) external view returns (address)',
  'function listTables() external view returns (string[] memory)',
  'event TableCreated(string name, address indexed tableContract, address indexed owner)',
] as const;

// ─────────────────────────────────────────────────────────────
//  DatabaseClient
// ─────────────────────────────────────────────────────────────

export class DatabaseClient {
  readonly address : string;
  private contract : ethers.Contract;
  private signer   : ethers.Signer;
  private keypair  : EncryptionKeypair;

  constructor(
    address  : string,
    signer   : ethers.Signer,
    keypair  : EncryptionKeypair,
  ) {
    this.address  = address;
    this.signer   = signer;
    this.keypair  = keypair;
    this.contract = new ethers.Contract(address, DATABASE_ABI, signer);
  }

  /**
   * Create a new encrypted table inside this database.
   * @param name        Human-readable table name (matches your schema).
   * @param schemaBytes ABI-encoded schema from @web3ql/compiler's compileSchema().
   * @returns           Address of the deployed table proxy.
   */
  async createTable(name: string, schemaBytes: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx      = await (this.contract as any).createTable(name, schemaBytes) as { wait(): Promise<ethers.TransactionReceipt> };
    const receipt = await tx.wait();

    const iface = new ethers.Interface(DATABASE_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'TableCreated') {
          return parsed.args['tableContract'] as string;
        }
      } catch { /* skip non-matching logs */ }
    }
    throw new Error('DatabaseClient.createTable: TableCreated event not found in logs');
  }

  /**
   * Get the address of an existing table by name.
   * Returns ethers.ZeroAddress if not found.
   */
  async getTable(name: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.contract as any).getTable(name) as Promise<string>;
  }

  /**
   * List all table names in this database.
   */
  async listTables(): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.contract as any).listTables() as Promise<string[]>;
  }

  /**
   * Drop (remove from registry) a table by name.
   * Records inside the table are NOT purged by this call — they remain
   * as unreachable ciphertext. Use SchemaManager.dropTable() first to
   * bulk-delete records if you want storage refunds.
   */
  async dropTable(name: string): Promise<ethers.TransactionReceipt> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await (this.contract as any).dropTable(name) as { wait(): Promise<ethers.TransactionReceipt> };
    return tx.wait();
  }

  /**
   * Get an EncryptedTableClient for a specific table address.
   * Use this after createTable() or getTable() to read/write records.
   */
  table(tableAddress: string): EncryptedTableClient {
    return new EncryptedTableClient(tableAddress, this.signer, this.keypair);
  }
}

// ─────────────────────────────────────────────────────────────
//  Web3QLClient  (top-level entry point)
// ─────────────────────────────────────────────────────────────

export class Web3QLClient {
  private factory  : ethers.Contract;
  private signer   : ethers.Signer;
  private keypair  : EncryptionKeypair;
  readonly registry: PublicKeyRegistryClient;

  constructor(
    factoryAddress   : string,
    signer           : ethers.Signer,
    keypair          : EncryptionKeypair,
    registryAddress  : string,
  ) {
    this.signer   = signer;
    this.keypair  = keypair;
    this.factory  = new ethers.Contract(factoryAddress, FACTORY_ABI, signer);
    this.registry = new PublicKeyRegistryClient(registryAddress, signer);
  }

  /**
   * Register the caller's encryption public key on-chain.
   * Must be called once per address before anyone can share records
   * with that address.  Safe to call again — will overwrite.
   */
  async register(): Promise<ethers.TransactionReceipt> {
    return this.registry.register(this.keypair);
  }

  /**
   * Check if an address has registered its public key.
   */
  async isRegistered(address: string): Promise<boolean> {
    return this.registry.hasKey(address);
  }

  /**
   * Create a new personal database for the calling wallet.
   * Most users only ever need one database — use getOrCreateDatabase().
   * @param name  Human-readable label stored immutably on-chain.
   */
  async createDatabase(name: string = ''): Promise<DatabaseClient> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx      = await (this.factory as any).createDatabase(name) as { wait(): Promise<ethers.TransactionReceipt> };
    const receipt = await tx.wait();

    const iface = new ethers.Interface(FACTORY_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'DatabaseCreated') {
          return new DatabaseClient(
            parsed.args['db'] as string,
            this.signer,
            this.keypair,
          );
        }
      } catch { /* skip */ }
    }
    throw new Error('Web3QLClient.createDatabase: DatabaseCreated event not found');
  }

  /**
   * Get all database proxies owned by a user.
   */
  async getDatabases(owner?: string): Promise<string[]> {
    const addr = owner ?? await this.signer.getAddress();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.factory as any).getUserDatabases(addr) as Promise<string[]>;
  }

  /**
   * Return the first existing database for the caller, or create one
   * if none exists.  Idempotent — safe to call on every app startup.
   * @param name  Passed to createDatabase() only when a new one is created.
   */
  async getOrCreateDatabase(name: string = ''): Promise<DatabaseClient> {
    const dbs = await this.getDatabases();
    if (dbs.length > 0) {
      return new DatabaseClient(dbs[0]!, this.signer, this.keypair);
    }
    return this.createDatabase(name);
  }

  /**
   * Wrap an already-known database address (e.g. loaded from config).
   */
  database(address: string): DatabaseClient {
    return new DatabaseClient(address, this.signer, this.keypair);
  }

  /**
   * Remove a database from the factory’s registry.
   * The proxy contract is NOT destroyed — it remains on-chain.
   * After calling this it will no longer appear in getDatabases().
   */
  async removeDatabase(dbAddress: string): Promise<ethers.TransactionReceipt> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await (this.factory as any).removeDatabase(dbAddress) as { wait(): Promise<ethers.TransactionReceipt> };
    return tx.wait();
  }
}
