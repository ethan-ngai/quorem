/** @file durable.ts @description Hibernating browser socket transport. @module runtime */
// @ts-expect-error Provided by the Worker runtime, not Node's TypeScript libraries.
import { DurableObject } from "cloudflare:workers";
import { socketHandshake } from "./handshake.ts";
import { ApplicationError } from "../../../application/error.ts";
import { mapIdentityError } from "../../../modules/identity/routes.ts";
import { IdentityError } from "../../../modules/identity/model.ts";
import { SocketSession } from "../../../modules/events/socket/session.ts";
import type {
  CommandHandler,
  SocketSecurity,
  SocketSnapshotSource,
} from "../../../modules/events/socket/ports.ts";
import type { Notice } from "../../../modules/events/dispatch/ports.ts";
import type { Principal } from "../../../modules/identity/model.ts";
import type { VerifiedGrant } from "../../../modules/identity/grant.ts";

type Mode = "interview" | "match" | "invite" | "submission" | "membership";
/** Private server storage; attachment contains only its opaque key. */
export interface StoredSocket {
  grant: VerifiedGrant;
  mode: Mode;
  resourceId: string;
  lease?: string;
  leaseOwner?: string;
}
export interface SocketAuthority {
  /** Verify the request, authorize the resource and acquire the canonical window lease. */
  issue(request: Request): Promise<StoredSocket>;
  /** Rehydrate live authority and canonical domain ports, never trusting attachment fields. */
  open(
    record: StoredSocket,
    binding: string,
  ): Promise<{
    security: SocketSecurity;
    commands?: CommandHandler;
    snapshot?: SocketSnapshotSource;
    renew?: (principal: Principal) => Promise<boolean>;
  }>;
  release(record: StoredSocket): Promise<void>;
}
interface DurableSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
interface SocketStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string; limit: number }): Promise<Map<string, T>>;
  setAlarm(time: number): Promise<void>;
  transaction<T>(callback: (tx: SocketStorage) => Promise<T>): Promise<T>;
}
interface SocketState {
  storage: SocketStorage;
  acceptWebSocket(socket: DurableSocket): void;
  getWebSockets(): DurableSocket[];
  waitUntil(promise: Promise<unknown>): void;
}
declare const WebSocketPair: new () => { 0: DurableSocket; 1: DurableSocket };
const key = (id: string) => `socket:${id}`;
const attachment = (socket: DurableSocket): string | undefined => {
  const value: unknown = socket.deserializeAttachment();
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : undefined;
};
/** Dependencies are supplied by the runtime composition, not by request-controlled headers. */
export function browserSocketObject<Env>(
  build: (env: Env) => { origins: readonly string[]; authority: SocketAuthority },
) {
  return class BrowserSocketObject extends DurableObject {
    private readonly state: SocketState;
    private readonly authority: SocketAuthority;
    private readonly origins: readonly string[];
    private readonly sessions = new Map<
      DurableSocket,
      Promise<{ session: SocketSession; record: StoredSocket }>
    >();
    private readonly listeners = new Map<DurableSocket, (notice: Notice) => void>();
    constructor(state: SocketState, env: Env) {
      super(state, env);
      this.state = state;
      const config = build(env);
      this.authority = config.authority;
      this.origins = config.origins;
    }
    private async ensure(socket: DurableSocket) {
      const existing = this.sessions.get(socket);
      if (existing) return existing;
      const pending = (async () => {
        const id = attachment(socket);
        if (!id) throw new Error("Invalid socket attachment");
        const record = await this.state.storage.get<StoredSocket>(key(id));
        if (!record || record.grant.expiresAt * 1000 <= Date.now())
          throw new Error("Socket grant expired");
        const opened = await this.authority.open(record, id);
        const session = new SocketSession({
          mode: record.mode,
          ...opened,
          security: {
            ...opened.security,
            verify: async (signal) => {
              let verified: Awaited<ReturnType<SocketSecurity["verify"]>>;
              try {
                verified = await opened.security.verify(signal);
              } catch (error) {
                throw mapIdentityError(error);
              }
              if (verified.binding !== id || record.grant.expiresAt * 1000 <= Date.now())
                throw new ApplicationError("unauthenticated", "Invalid socket grant", 401);
              return {
                ...verified,
                expiresAt: Math.min(verified.expiresAt ?? Infinity, record.grant.expiresAt * 1000),
              };
            },
            authorize: async (principal, signal) => {
              try {
                return await opened.security.authorize(principal, signal);
              } catch (error) {
                throw mapIdentityError(error);
              }
            },
          },
          transport: {
            send: async (frame) => {
              socket.send(frame);
            },
            ping: async () => {},
            close: (code, reason) => {
              try {
                socket.close(code, reason);
              } finally {
                this.state.waitUntil(this.cleanup(socket));
              }
            },
          },
          subscription: {
            subscribe: async (notice) => {
              this.listeners.set(socket, notice);
              return () => {
                this.listeners.delete(socket);
              };
            },
          },
        });
        this.state.waitUntil(session.start());
        return { session, record };
      })();
      this.sessions.set(socket, pending);
      try {
        return await pending;
      } catch (error) {
        this.sessions.delete(socket);
        throw error;
      }
    }
    private async cleanup(socket: DurableSocket) {
      const id = attachment(socket);
      this.listeners.delete(socket);
      this.sessions.delete(socket);
      if (!id) return;
      const record = await this.state.storage.get<StoredSocket>(key(id));
      if (!record) return;
      if (await this.state.storage.delete(key(id))) await this.authority.release(record);
    }
    async fetch(request: Request): Promise<Response> {
      const rejection = socketHandshake(request, this.origins);
      if (rejection) return new Response(null, { status: rejection });
      if (
        this.state.getWebSockets().length >= 1024 ||
        (await this.state.storage.list({ prefix: "socket:", limit: 1024 })).size >= 1024
      )
        return new Response(null, { status: 503 });
      let record: StoredSocket | undefined;
      let storedId: string | undefined;
      let accepted: DurableSocket | undefined;
      try {
        record = await this.authority.issue(request);
        if (
          !Number.isSafeInteger(record.grant.expiresAt) ||
          record.grant.expiresAt * 1000 <= Date.now() ||
          ((record.grant.kind === "invite" ||
            (record.grant.kind === "guest" &&
              (record.mode === "interview" || record.mode === "match"))) &&
            record.grant.resourceId !== record.resourceId) ||
          (record.grant.kind === "invite" && record.mode !== "invite") ||
          (record.grant.kind !== "invite" && record.mode === "invite")
        )
          throw new IdentityError("unauthorized");
        if (new TextEncoder().encode(JSON.stringify(record)).length > 24 * 1024)
          throw new IdentityError("unauthorized");
        const id = crypto.randomUUID();
        const opened = await this.authority.open(record, id);
        const verified = await opened.security.verify(new AbortController().signal);
        await opened.security.authorize(verified.principal, new AbortController().signal);
        if (
          verified.binding !== id ||
          (verified.expiresAt !== undefined && verified.expiresAt <= Date.now())
        )
          throw new Error("Invalid grant");
        await this.state.storage.transaction(async (tx) => {
          if ((await tx.list({ prefix: "socket:", limit: 1024 })).size >= 1024)
            throw new Error("Socket capacity");
          await tx.put(key(id), record);
        });
        storedId = id;
        const pair = new WebSocketPair();
        pair[1].serializeAttachment({ id });
        this.state.acceptWebSocket(pair[1]);
        accepted = pair[1];
        await this.state.storage.setAlarm(Date.now() + 10_000);
        this.state.waitUntil(
          this.ensure(pair[1]).catch(() => {
            pair[1].close(1008, "Access changed");
            return this.cleanup(pair[1]);
          }),
        );
        return new Response(null, {
          status: 101,
          headers: { "sec-websocket-protocol": "quorem" },
          webSocket: pair[0],
        } as ResponseInit);
      } catch (error) {
        accepted?.close(1013, "Realtime unavailable");
        if (record && (!storedId || (await this.state.storage.delete(key(storedId)))))
          await this.authority.release(record);
        const status =
          error instanceof IdentityError && error.kind === "unauthorized"
            ? 401
            : error instanceof ApplicationError &&
                [400, 401, 403, 404, 409, 410, 422, 429].includes(error.status)
              ? error.status
              : 503;
        return new Response(null, {
          status,
          headers: {
            "cache-control": "no-store",
            ...(status === 429 ? { "retry-after": "1" } : {}),
          },
        });
      }
    }
    async webSocketMessage(socket: DurableSocket, message: string | ArrayBuffer): Promise<void> {
      try {
        const { session } = await this.ensure(socket);
        if (typeof message !== "string") {
          session.close(1008, "Invalid frame");
          return;
        }
        session.receive(message);
      } catch {
        socket.close(1008, "Access changed");
        await this.cleanup(socket);
      }
    }
    async webSocketClose(socket: DurableSocket): Promise<void> {
      const current = this.sessions.get(socket);
      if (current) (await current.catch(() => undefined))?.session.close();
      await this.cleanup(socket);
    }
    async webSocketError(socket: DurableSocket): Promise<void> {
      await this.webSocketClose(socket);
    }
    /** Called only by trusted runtime fanout, never a browser route. */
    async publish(notice: Notice): Promise<void> {
      await Promise.all(
        this.state.getWebSockets().map(async (socket) => {
          try {
            const { record } = await this.ensure(socket);
            if (record.resourceId === notice.aggregateId) this.listeners.get(socket)?.(notice);
          } catch {
            socket.close(1008, "Access changed");
            await this.cleanup(socket);
          }
        }),
      );
    }
    async alarm(): Promise<void> {
      const sockets = this.state.getWebSockets();
      await Promise.all(
        sockets.map(async (socket) => {
          try {
            await (await this.ensure(socket)).session.heartbeat();
          } catch {
            socket.close(1008, "Access changed");
            await this.cleanup(socket);
          }
        }),
      );
      const active = new Set(
        sockets
          .map(attachment)
          .filter((id): id is string => !!id)
          .map(key),
      );
      for (const [storedKey, record] of await this.state.storage.list<StoredSocket>({
        prefix: "socket:",
        limit: 1024,
      })) {
        if (!active.has(storedKey) && (await this.state.storage.delete(storedKey)))
          await this.authority.release(record);
      }
      if (sockets.length) await this.state.storage.setAlarm(Date.now() + 10_000);
    }
  };
}
