/** @file errors.ts @description PostgreSQL failure categories. @module database */
export type DatabaseErrorKind = 'unique' | 'foreign_key' | 'check' | 'not_null' | 'lock_timeout' | 'query_cancelled' | 'serialization' | 'deadlock' | 'connection' | 'aborted' | 'unknown_commit' | 'other';

export class DatabaseFailure extends Error {
  readonly kind: DatabaseErrorKind;
  constructor(kind: DatabaseErrorKind, cause?: unknown) {
    super(kind, { cause });
    this.kind = kind;
  }
}

export function classifyDatabaseError(error: unknown): DatabaseErrorKind {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof DatabaseFailure) return current.kind;
    if ('code' in current && typeof current.code === 'string') {
      const codes: Record<string, DatabaseErrorKind> = { '23505': 'unique', '23503': 'foreign_key', '23514': 'check', '23502': 'not_null', '55P03': 'lock_timeout', '57014': 'query_cancelled', '40001': 'serialization', '40P01': 'deadlock' };
      if (codes[current.code]) return codes[current.code];
      if (current.code.startsWith('08') || ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT'].includes(current.code)) return 'connection';
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return 'other';
}

export function isDefinitiveServerError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && typeof current.code === 'string' && 'severity' in current && typeof current.severity === 'string') {
      return current.severity === 'ERROR' && /^[0-9A-Z]{5}$/.test(current.code) && !current.code.startsWith('08') && !['57P01', '57P02', '57P03'].includes(current.code);
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
