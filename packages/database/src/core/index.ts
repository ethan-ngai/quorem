/** @file index.ts @description Backend connection and transaction primitives. @module database */
export { createNodePool, withNodeConnection, withWorkerConnection } from './connection.ts';
export type { ConnectionOptions, ConnectionScope, ScopeOptions, NodePoolOptions, Transaction, TransactionOptions } from './connection.ts';
export { classifyDatabaseError, DatabaseFailure } from './errors.ts';
export type { DatabaseErrorKind } from './errors.ts';
