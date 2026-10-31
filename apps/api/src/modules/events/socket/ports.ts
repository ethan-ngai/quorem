/** @file ports.ts @description Transport-neutral browser socket boundaries. @module events */
import type { Principal } from "../../identity/model.ts";
import type { Notice } from "../dispatch/ports.ts";
/** A transport sends exactly one message from a pull-driven sequence. */
export interface SocketTransport {
  send(frame: string, signal: AbortSignal): Promise<void>;
  ping(signal: AbortSignal): Promise<void>;
  close(code: number, reason: string): void;
}
export interface SocketSecurity {
  /** Verify live credentials; report expiry from the trusted verifier. */
  verify(): Promise<{ principal: Principal; expiresAt?: number }>;
  /** Recheck current scope and role; failures must never be cached. */
  authorize(principal: Principal): Promise<string>;
}
export interface SocketSubscription {
  subscribe(onNotice: (notice: Notice) => void, onLost: () => void): Promise<() => void>;
}
export type Snapshot = { body: string; version?: string; terminal?: boolean };
export interface SocketSnapshotSource {
  read(principal: Principal): Promise<Snapshot>;
}
export interface SocketCommand {
  id: string;
  type: string;
  fields: Record<string, unknown>;
  /** Exact nested push object, already validated as JSON. */
  rawPush?: string;
}
export interface CommandHandler {
  execute(principal: Principal, command: SocketCommand): Promise<unknown>;
}
