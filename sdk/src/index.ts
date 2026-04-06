/**
 * @web3ql/sdk — Public API  (v1.2)
 *
 * ─────────────────────────────────────────────────────────────
 *  import {
 *    // Core clients
 *    Web3QLClient, DatabaseClient, EncryptedTableClient,
 *    // High-level typed API
 *    TypedTableClient,
 *    // Type system (v1.1+)
 *    validateAndEncode, decodeRow, encodeFieldValue, decodeFieldValue,
 *    // Query builder (v1.1+)
 *    query,
 *    // Migrations (v1.1+)
 *    MigrationRunner, addColumn, dropColumn, renameColumn, changeType,
 *    // Constraints (v1.2)
 *    ConstraintEngine, ConstraintViolation, AutoIncrementCounter,
 *    // Index cache (v1.2)
 *    TableIndexCache, QueryRelayClient,
 *    // Batch writes (v1.2)
 *    BatchWriter, buildCrossTableBatch,
 *    // Access control (v1.2)
 *    AccessManager, PublicTableClient,
 *    // Schema management (v1.2)
 *    SchemaManager, decodeSchemaBytes, diffSchema,
 *    // Crypto
 *    deriveKeypairFromWallet,
 *    Role,
 *  } from '@web3ql/sdk';
 * ─────────────────────────────────────────────────────────────
 */

// ── Core clients ──────────────────────────────────────────────
export { Web3QLClient, DatabaseClient }               from './factory-client.js';
export { EncryptedTableClient, Role }                 from './table-client.js';
export type { RawRecord }                             from './table-client.js';
export { PublicKeyRegistryClient }                    from './registry.js';

// ── Errors ────────────────────────────────────────────────────
export {
  Web3QLError,
  SchemaValidationError,
  RecordNotFoundError,
  VersionConflictError,
  DecryptionError,
  AccessDeniedError,
  BatchError,
}                                                     from './errors.js';
export type { BatchResult }                           from './errors.js';

// ── High-level typed API (Prisma-style) ───────────────────────
export { TypedTableClient }                           from './typed-table.js';
export type {
  FindManyOptions,
  RecordWithId,
  WhereTuple,
  SchemaDefinition,
}                                                     from './typed-table.js';

// ── v1.1 Type system (encode/decode/validate) ─────────────────
export {
  NULL_SENTINEL,
  validateAndEncode,
  decodeRow,
  encodeFieldValue,
  decodeFieldValue,
}                                                     from './types.js';
export type { FieldType, FieldDescriptor }            from './types.js';

// ── v1.1 Query builder ────────────────────────────────────────
export { query, QueryBuilder }                        from './query.js';
export type {
  Row,
  WhereOperator,
  WhereClause,
  OrderByClause,
  SortDirection,
  AggregateOptions,
  AggregateResult,
  JoinType,
  JoinClause,
  TimeBucketUnit,
  HavingClause,
}                                                     from './query.js';

// ── v1.1 Migration framework ──────────────────────────────────
export {
  MigrationRunner,
  addColumn,
  addColumnSchema,
  dropColumn,
  dropColumnSchema,
  renameColumn,
  renameColumnSchema,
  changeType,
  computeColumn,
}                                                     from './migrations.js';
export type { Migration, RowTransformer, SchemaTransformer } from './migrations.js';

// ── v1.2 Integrity constraints ────────────────────────────────
export {
  ConstraintEngine,
  ConstraintViolation,
  AutoIncrementCounter,
}                                                     from './constraints.js';
export type {
  Constraint,
  UniqueConstraint,
  CheckConstraint,
  ForeignKeyConstraint,
  NotNullConstraint,
}                                                     from './constraints.js';

// ── v1.2 Index cache + relay query client ─────────────────────
export {
  TableIndexCache,
  QueryRelayClient,
}                                                     from './index-cache.js';
export type {
  IndexEntry,
  IndexCacheOptions,
  RelayQueryRequest,
  RelayQueryResponse,
}                                                     from './index-cache.js';

// ── v1.2 Batch writes (Multicall3) ────────────────────────────
export {
  BatchWriter,
  buildCrossTableBatch,
  MULTICALL3_ADDRESS,
}                                                     from './batch.js';
export type { CrossTableOp }                          from './batch.js';

// ── v1.2 Advanced access control ─────────────────────────────
export {
  AccessManager,
  grantMetaKey,
  generateColumnKeySet,
  encryptWithColumnKeys,
  decryptColumnBlobs,
}                                                     from './access.js';
export type {
  TimedGrant,
  CapabilityToken,
  ColumnKeySet,
}                                                     from './access.js';

// ── Public table (Web3QLPublicTable) ──────────────────────────
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

// ── v1.2 Schema management ────────────────────────────────────
export {
  SchemaManager,
  decodeSchemaBytes,
  diffSchema,
}                                                     from './schema-manager.js';
export type {
  SchemaChange,
  SchemaChangeType,
}                                                     from './schema-manager.js';

// ── Crypto primitives ─────────────────────────────────────────
export {
  KEY_DERIVATION_MESSAGE,
  deriveKeypairFromWallet,  // ✅ browser-compatible (recommended)
  deriveKeypair,            // ⚠️  deprecated: different keypair to browser
  publicKeyFromPrivate,
  generateSymmetricKey,
  encryptData,
  decryptData,
  encryptKeyForSelf,
  encryptKeyForRecipient,
  decryptKeyForSelf,
  decryptKeyFromSender,
  publicKeyToHex,
  hexToPublicKey,
}                                                     from './crypto.js';
export type { EncryptionKeypair }                     from './crypto.js';

// ── v1.3 ORM — Model + Relation wires ────────────────────────
export { Model }                                      from './model.js';
export type {
  ModelOptions,
  RelatedCreateOptions,
}                                                     from './model.js';
