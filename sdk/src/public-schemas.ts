/**
 * @file   public-schemas.ts
 * @notice Schema definitions, TypeScript interfaces, and MigrationRunners
 *         for the two built-in Web3QL public tables: Project and Campaign.
 *
 * These tables use Web3QLPublicTable which means:
 *   • Data is plaintext — stored and readable by anyone
 *   • restrictedWrites = true — only the table admin (platform deployer) can write
 *   • ~80-100k gas cheaper per write than private tables because:
 *       - No NaCl encryption / decryption
 *       - No encryptedKey SSTORE
 *       - No collaborator mapping
 *       - No gatedRead access check path
 *   • Reads need no wallet — any JSON-RPC provider works (great for SSR/APIs)
 *
 * What the public table pattern avoids vs encrypted private tables:
 * ─────────────────────────────────────────────────────────────
 *   Skipped on every write:
 *     • NaCl secretbox encryption of payload          (~0.5-2ms CPU)
 *     • NaCl box key-wrap for each collaborator        (~0.5ms × n CPU)
 *     • encryptedKey SSTORE on chain                   (~20k gas)
 *     • collaborator list push                         (~20k gas each)
 *   Skipped on every read:
 *     • encryptedKey SLOAD + X25519 key-derivation    (~0.5ms CPU)
 *     • NaCl secretbox decrypt of payload             (~0.5ms CPU)
 *     • gatedRead role check                          (1 SLOAD)
 *   Skipped entirely:
 *     • deriveKeypairFromWallet() wallet signature    (~50ms)
 *     • Per-user public key registry lookup           (1 eth_call)
 * ─────────────────────────────────────────────────────────────
 *
 * Usage:
 * ─────────────────────────────────────────────────────────────
 *   import {
 *     projectSchema, campaignSchema,
 *     projectMigrations, campaignMigrations,
 *     TypedPublicTableClient, PublicTableClient,
 *   } from '@web3ql/sdk';
 *
 *   const projects = new TypedPublicTableClient<Project>(
 *     'projects',
 *     new PublicTableClient(projectTableAddress, signer),
 *     projectSchema,
 *     projectMigrations,
 *   );
 *
 *   const campaigns = new TypedPublicTableClient<Campaign>(
 *     'campaigns',
 *     new PublicTableClient(campaignTableAddress, signer),
 *     campaignSchema,
 *     campaignMigrations,
 *   );
 *
 *   // Create a project (admin only when restrictedWrites = true)
 *   await projects.create(1n, {
 *     id: 1n, title: 'Web3QL Launch', description: 'First Web3QL project',
 *     owner: adminAddress, status: 'active', category: 'infrastructure',
 *   });
 *
 *   // Anyone can read
 *   const p = await projects.findUnique(1n);
 *
 *   // Create a campaign under a project
 *   await campaigns.create(1n, {
 *     id: 1n, projectId: 1n, title: 'Q2 Growth', status: 'draft',
 *     owner: adminAddress, budget: '10000.00',
 *   });
 * ─────────────────────────────────────────────────────────────
 */

import type { SchemaDefinition } from './types.js';
import {
  MigrationRunner,
  addColumn,
  addColumnSchema,
  dropColumn,
  dropColumnSchema,
  renameColumn,
  renameColumnSchema,
} from './migrations.js';

// ─────────────────────────────────────────────────────────────
//  Project
// ─────────────────────────────────────────────────────────────

/**
 * TypeScript interface for a Project record.
 * Matches projectSchema v1 (latest).
 */
export interface Project {
  id          : bigint;    // primary key — uint256 stored as decimal string
  title       : string;    // required — human-readable project name
  description : string;    // optional long form description
  owner       : string;    // 0x address — the wallet that created this project
  status      : string;    // ENUM: 'active' | 'paused' | 'completed' | 'archived'
  category    : string;    // open tag — e.g. 'infrastructure', 'defi', 'dao'
  tags        : unknown;   // JSON array of string tags  (null OK)
  budget      : string;    // DECIMAL(18,2) — max budget in USD or platform currency
  createdAt   : Date;      // auto-set on first write (TIMESTAMP)
  updatedAt   : Date;      // updated on every write   (TIMESTAMP)
  campaignCount: number;   // UINT32 — number of campaigns under this project
}

/**
 * On-chain schema for the `projects` public table.
 *
 * Stored as ABI-encoded FieldInfo[] in the contract.
 * Required fields (notNull = true, primaryKey = false) are enforced both:
 *   • Client-side in TypedPublicTableClient.create() / update()
 *   • On-chain in Web3QLPublicTable.write() / update() via _requiredFieldHashes
 */
export const projectSchema: SchemaDefinition = [
  { name: 'id',           type: 'BIGINT',    primaryKey: true },
  { name: 'title',        type: 'TEXT',      notNull: true },
  { name: 'description',  type: 'TEXT' },
  { name: 'owner',        type: 'ADDRESS',   notNull: true },
  {
    name      : 'status',
    type      : 'ENUM',
    notNull   : true,
    enumValues: ['active', 'paused', 'completed', 'archived'],
    default   : 'active',
  },
  { name: 'category',     type: 'TEXT',      default: '' },
  { name: 'tags',         type: 'JSON',      default: [] },
  {
    name     : 'budget',
    type     : 'DECIMAL',
    precision: [18, 2],
    default  : '0.00',
  },
  { name: 'createdAt',    type: 'TIMESTAMP', notNull: true, default: () => new Date() },
  { name: 'updatedAt',    type: 'TIMESTAMP', notNull: true, default: () => new Date() },
  { name: 'campaignCount',type: 'UINT32',    default: 0 },
];

/**
 * Migration history for the `projects` table.
 *
 * All migrations are applied client-side on read (lazy migration pattern).
 * Records written at older schema versions are transparently upgraded by the
 * MigrationRunner without any on-chain transaction or re-write.
 *
 * A re-write only happens on the next create()/update() — at which point the
 * record is stored at the current schemaVersion and needs no further migration.
 *
 * Current latest version: 1
 *
 * What migrations avoid:
 *   • No DROP/ALTER TABLE gas (there is no gas — it's client-side)
 *   • No coordinated redeploy of the contract
 *   • No downtime — old and new schema versions coexist during rollout
 *   • No need to re-encrypt all records (there is no encryption for public tables)
 *
 * To add a migration:
 *   1. Bump the version number
 *   2. Add a `{ version: N, description: '...', up: ..., schema: ... }` entry
 *   3. Call table.updateSchema(newSchemaBytes) to push the new schema on-chain
 */
export const projectMigrations = new MigrationRunner([
  // v1 — initial schema.  No up-migration needed (base state).
  {
    version    : 1,
    description: 'Initial schema — add campaignCount to replace manual counting',
    up         : addColumn({ name: 'campaignCount', type: 'UINT32', default: 0 }),
    schema     : addColumnSchema({ name: 'campaignCount', type: 'UINT32', default: 0 }),
  },
  // Example future migration (commented out until needed):
  //
  // {
  //   version    : 2,
  //   description: 'Rename category → vertical (platform terminology change)',
  //   up         : renameColumn('category', 'vertical'),
  //   schema     : renameColumnSchema('category', 'vertical'),
  // },
  // {
  //   version    : 3,
  //   description: 'Add websiteUrl field',
  //   up         : addColumn({ name: 'websiteUrl', type: 'TEXT', default: '' }),
  //   schema     : addColumnSchema({ name: 'websiteUrl', type: 'TEXT', default: '' }),
  // },
]);

// ─────────────────────────────────────────────────────────────
//  Campaign
// ─────────────────────────────────────────────────────────────

/**
 * TypeScript interface for a Campaign record.
 * Matches campaignSchema v1 (latest).
 */
export interface Campaign {
  id          : bigint;   // primary key
  projectId   : bigint;   // foreign key → projects.id
  title       : string;   // required
  description : string;   // optional
  owner       : string;   // 0x address — wallet that created the campaign
  status      : string;   // ENUM: 'draft' | 'active' | 'paused' | 'ended'
  startAt     : Date;     // campaign start timestamp (null = not scheduled)
  endAt       : Date;     // campaign end timestamp   (null = open-ended)
  budget      : string;   // DECIMAL(18,2)
  spent       : string;   // DECIMAL(18,2) — tracks spend against budget
  impressions : bigint;   // total impressions / reach counter
  clicks      : bigint;   // total engagement counter
  conversions : number;   // UINT32 — tracked conversion events
  createdAt   : Date;
  updatedAt   : Date;
}

/**
 * On-chain schema for the `campaigns` public table.
 */
export const campaignSchema: SchemaDefinition = [
  { name: 'id',          type: 'BIGINT',    primaryKey: true },
  { name: 'projectId',   type: 'BIGINT',    notNull: true },
  { name: 'title',       type: 'TEXT',      notNull: true },
  { name: 'description', type: 'TEXT' },
  { name: 'owner',       type: 'ADDRESS',   notNull: true },
  {
    name      : 'status',
    type      : 'ENUM',
    notNull   : true,
    enumValues: ['draft', 'active', 'paused', 'ended'],
    default   : 'draft',
  },
  { name: 'startAt',     type: 'TIMESTAMP' },
  { name: 'endAt',       type: 'TIMESTAMP' },
  {
    name     : 'budget',
    type     : 'DECIMAL',
    precision: [18, 2],
    default  : '0.00',
  },
  {
    name     : 'spent',
    type     : 'DECIMAL',
    precision: [18, 2],
    default  : '0.00',
  },
  { name: 'impressions', type: 'BIGINT',  default: 0n },
  { name: 'clicks',      type: 'BIGINT',  default: 0n },
  { name: 'conversions', type: 'UINT32',  default: 0 },
  { name: 'createdAt',   type: 'TIMESTAMP', notNull: true, default: () => new Date() },
  { name: 'updatedAt',   type: 'TIMESTAMP', notNull: true, default: () => new Date() },
];

/**
 * Migration history for the `campaigns` table.
 *
 * Current latest version: 1
 *
 * The migration runner runs entirely off-chain — no gas cost, no contract
 * redeployment, no downtime.  Old records are lazily upgraded on the next write.
 */
export const campaignMigrations = new MigrationRunner([
  // v1 — added performance counters (impressions, clicks, conversions).
  //       Old records written before v1 will receive default values on read.
  {
    version    : 1,
    description: 'Add impressions, clicks, conversions performance counters',
    up(row) {
      return {
        impressions : row['impressions']  ?? 0n,
        clicks      : row['clicks']       ?? 0n,
        conversions : row['conversions']  ?? 0,
        ...row,
      };
    },
    schema(schema) {
      return [
        ...schema,
        ...([
          { name: 'impressions', type: 'BIGINT', default: 0n },
          { name: 'clicks',      type: 'BIGINT', default: 0n },
          { name: 'conversions', type: 'UINT32', default: 0 },
        ] as SchemaDefinition).filter((f) => !schema.some((s) => s.name === f.name)),
      ];
    },
  },
  // Example future migration (commented out until needed):
  //
  // {
  //   version    : 2,
  //   description: 'Add targetAudience field',
  //   up         : addColumn({ name: 'targetAudience', type: 'JSON', default: [] }),
  //   schema     : addColumnSchema({ name: 'targetAudience', type: 'JSON', default: [] }),
  // },
  // {
  //   version    : 3,
  //   description: 'Drop legacy "spent" field (replaced by on-chain RelationWire counter)',
  //   up         : dropColumn('spent'),
  //   schema     : dropColumnSchema('spent'),
  // },
]);
