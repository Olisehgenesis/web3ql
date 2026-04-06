/**
 * @file   errors.ts
 * @notice Typed error classes for Web3QL SDK.
 *         Callers can instanceof-check these to handle specific failures.
 */

export class Web3QLError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'Web3QLError';
  }
}

export class SchemaValidationError extends Web3QLError {
  constructor(public readonly violations: string[]) {
    super(`Schema validation failed:\n  ${violations.join('\n  ')}`, 'SCHEMA_VALIDATION');
    this.name = 'SchemaValidationError';
  }
}

export class RecordNotFoundError extends Web3QLError {
  constructor(key: string) {
    super(`Record not found: ${key}`, 'RECORD_NOT_FOUND');
    this.name = 'RecordNotFoundError';
  }
}

export class VersionConflictError extends Web3QLError {
  constructor(key: string, expected: number, actual: number) {
    super(
      `Version conflict on ${key}: expected ${expected}, got ${actual}`,
      'VERSION_CONFLICT',
    );
    this.name = 'VersionConflictError';
  }
}

export class DecryptionError extends Web3QLError {
  constructor(key: string) {
    super(
      `Decryption failed for key ${key} — wrong keypair or tampered data`,
      'DECRYPTION_FAILED',
    );
    this.name = 'DecryptionError';
  }
}

export class AccessDeniedError extends Web3QLError {
  constructor(key: string) {
    super(
      `Access denied for key ${key} — caller is not an authorised key holder`,
      'ACCESS_DENIED',
    );
    this.name = 'AccessDeniedError';
  }
}

/** Per-operation result returned by BatchWriter.submit(). */
export interface BatchResult {
  index     : number;
  type      : 'write' | 'update' | 'delete';
  key       : string;
  success   : boolean;
  returnData: string;
  error?    : string;
}

export class BatchError extends Web3QLError {
  constructor(
    message: string,
    public readonly results: BatchResult[],
    public readonly cause?: unknown,
  ) {
    super(message, 'BATCH_ERROR');
    this.name = 'BatchError';
  }
}
