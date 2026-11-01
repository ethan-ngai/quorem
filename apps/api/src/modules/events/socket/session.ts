/** @file session.ts @description Bounded transport-neutral socket session. @module events */
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../identity/model.ts";
import type { Notice } from "../dispatch/ports.ts";
import type {
  CommandHandler,
  SocketCommand,
  SocketSecurity,
  SocketSnapshotSource,
  SocketSubscription,
  SocketTransport,
} from "./ports.ts";
import { parseSocketCommand } from "./parse.ts";
const encoder = new TextEncoder();
class SocketDeadline extends Error {}
const denied = (e: unknown) => e instanceof ApplicationError && [401, 403, 404].includes(e.status);
const unavailable = {
  code: "temporarily_unavailable",
  status: 503,
  message: "Realtime temporarily unavailable",
};
const identity = (p: Principal | undefined, binding: string) =>
  JSON.stringify([binding, p?.kind, p?.userId, p?.sessionId]);
type Lane = { queue: SocketCommand[]; running: boolean };
/** Each instance belongs to one socket and never stores bearer or guest credentials. */
export class SocketSession {
  private closed = false;
  private started = false;
  private stop?: () => void;
  private abort = new AbortController();
  private cached?: { principal: Principal | undefined; until: number; identity: string };
  private verifying?: Promise<Principal | undefined>;
  private lanes: { command: Lane; advisory: Lane } = {
    command: { queue: [], running: false },
    advisory: { queue: [], running: false },
  };
  private active = new Set<string>();
  private pendingWrites = 0;
  private receipt?: { id: string; resolve: () => void; reject: () => void };
  private writing: Promise<void> = Promise.resolve();
  private refreshing = false;
  private dirty = false;
  private noticeKind?: string;
  private version?: bigint;
  private credits = 120;
  private creditAt = Date.now();
  private deps: {
    transport: SocketTransport;
    security: SocketSecurity;
    subscription: SocketSubscription;
    commands?: CommandHandler;
    snapshot?: SocketSnapshotSource;
    mode: "interview" | "match" | "submission" | "invite" | "membership";
    now?: () => number;
    renew?: (p: Principal) => Promise<boolean>;
  };
  constructor(deps: SocketSession["deps"]) {
    this.deps = deps;
  }
  private now() {
    return this.deps.now?.() ?? Date.now();
  }
  private async deadline<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    if (this.abort.signal.aborted) throw new SocketDeadline("Socket closed");
    const stop = () => controller.abort();
    this.abort.signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, 5000);
    try {
      return await Promise.race([
        fn(controller.signal),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener(
            "abort",
            () => reject(new SocketDeadline("Socket operation timed out")),
            { once: true },
          ),
        ),
      ]);
    } finally {
      clearTimeout(timer);
      this.abort.signal.removeEventListener("abort", stop);
    }
  }
  private async principal(): Promise<Principal | undefined> {
    const now = this.now();
    if (this.cached && now < this.cached.until) return this.cached.principal;
    if (this.verifying) return this.verifying;
    this.verifying = (async () => {
      const verified = await this.deadline((signal) => this.deps.security.verify(signal));
      if (!verified.binding || verified.binding.length > 256)
        throw new ApplicationError("unauthenticated", "Invalid socket grant", 401);
      if (this.deps.mode !== "invite" && !verified.principal)
        throw new ApplicationError("unauthenticated", "Sign in required", 401);
      const current = identity(verified.principal, verified.binding);
      if (this.cached && this.cached.identity !== current)
        throw new ApplicationError("unauthenticated", "Session changed", 401);
      if (verified.expiresAt !== undefined && verified.expiresAt <= this.now())
        throw new ApplicationError("unauthenticated", "Session expired", 401);
      this.cached = {
        principal: verified.principal,
        until: Math.min(this.now() + 2000, verified.expiresAt ?? Infinity),
        identity: current,
      };
      return verified.principal;
    })();
    try {
      return await this.verifying;
    } finally {
      this.verifying = undefined;
    }
  }
  private async authorized(): Promise<{ principal: Principal | undefined; stamp: string }> {
    const principal = await this.principal();
    return {
      principal,
      stamp: await this.deadline((signal) => this.deps.security.authorize(principal, signal)),
    };
  }
  private fail(error: unknown) {
    if (denied(error)) {
      this.close(1008, "Access changed");
      return;
    }
    if (!this.closed) this.dirty = true;
  }
  private send(value: unknown, stamp?: string): Promise<void> {
    if (this.closed) return Promise.resolve();
    let frame: string;
    try {
      frame = JSON.stringify({ receipt: crypto.randomUUID(), payload: value });
    } catch {
      this.close(1011, "Invalid response");
      return Promise.resolve();
    }
    if (encoder.encode(frame).length > 256 * 1024 || this.pendingWrites >= 16) {
      this.close(1013, "Realtime backpressure");
      return Promise.resolve();
    }
    this.pendingWrites++;
    const next = this.writing
      .then(async () => {
        if (this.closed) return;
        if (stamp !== undefined && (await this.authorized()).stamp !== stamp) {
          this.dirty = true;
          void this.refresh();
          return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const id = (JSON.parse(frame) as { receipt: string }).receipt;
          const acknowledged = new Promise<void>((resolve, reject) => {
            this.receipt = { id, resolve, reject: () => reject(new Error("receipt cancelled")) };
          });
          await Promise.race([
            Promise.all([this.deps.transport.send(frame, controller.signal), acknowledged]),
            new Promise<never>((_, reject) =>
              controller.signal.addEventListener("abort", () => reject(new Error("send timeout")), {
                once: true,
              }),
            ),
          ]);
        } finally {
          clearTimeout(timer);
          this.receipt = undefined;
        }
      })
      .catch((error) => {
        this.fail(error);
        if (!denied(error)) this.close(1013, "Realtime unavailable");
      })
      .finally(() => {
        this.pendingWrites--;
      });
    this.writing = next;
    return next;
  }
  async start(): Promise<void> {
    if (this.started || this.closed) throw new Error("Socket already started");
    this.started = true;
    try {
      await this.authorized();
      if (this.closed) return;
      let abandoned = false;
      const stop = await this.deadline((signal) => {
        const pending = this.deps.subscription.subscribe(
          (n) => this.notice(n),
          () => this.close(1013, "Realtime unavailable"),
          signal,
        );
        void pending.then(
          (release) => {
            if (abandoned) release();
          },
          () => {},
        );
        return pending;
      }).catch((error) => {
        abandoned = true;
        throw error;
      });
      if (this.closed) {
        stop();
        return;
      }
      this.stop = stop;
      this.dirty = true;
      await this.refresh();
    } catch (e) {
      this.fail(e);
      if (!denied(e)) this.close(1013, "Realtime unavailable");
    }
  }
  close(code = 1000, reason = "Closed") {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    this.receipt?.reject();
    this.receipt = undefined;
    this.stop?.();
    this.stop = undefined;
    for (const lane of Object.values(this.lanes)) lane.queue.length = 0;
    this.active.clear();
    this.deps.transport.close(code, reason);
  }
  notice(n: Notice) {
    if (this.closed) return;
    this.noticeKind = n.type;
    this.dirty = true;
    void this.refresh();
  }
  private async refresh(): Promise<void> {
    if (this.refreshing || this.closed || !this.stop) return;
    this.refreshing = true;
    try {
      while (this.dirty && !this.closed) {
        this.dirty = false;
        const kind = this.noticeKind;
        this.noticeKind = undefined;
        const { principal: p, stamp } = await this.authorized();
        if (this.deps.mode === "interview")
          await this.send({ type: "changed", ...(kind ? { kind } : {}) });
        else if (this.deps.mode === "invite" || this.deps.mode === "submission")
          await this.send({ type: "changed" });
        else if (this.deps.mode === "membership") await this.send({ type: "membership.updated" });
        else if (this.deps.snapshot) {
          const snapshot = await this.deadline((signal) => this.deps.snapshot!.read(p, signal));
          if ((await this.authorized()).stamp !== stamp) {
            this.dirty = true;
            continue;
          }
          if (snapshot.version !== undefined) {
            if (!/^(0|[1-9]\d*)$/.test(snapshot.version)) throw new Error("Invalid version");
            const v = BigInt(snapshot.version);
            if (this.version !== undefined && v < this.version) continue;
            this.version = v;
          }
          let value: unknown;
          try {
            value = JSON.parse(snapshot.body);
          } catch {
            throw new Error("Invalid snapshot");
          }
          await this.send(value, stamp);
          if ((await this.authorized()).stamp !== stamp) {
            this.dirty = true;
            continue;
          }
          if (snapshot.terminal) {
            this.close(1000, "Complete");
            return;
          }
        }
      }
    } catch (e) {
      this.fail(e);
    } finally {
      this.refreshing = false;
    }
  }
  async heartbeat(): Promise<void> {
    if (this.closed) return;
    try {
      try {
        await this.deadline((signal) => this.deps.transport.ping(signal));
      } catch {
        this.close(1013, "Heartbeat unavailable");
        return;
      }
      void this.send({ type: "heartbeat" });
      const { principal: p } = await this.authorized();
      if (this.deps.renew && (!p || !(await this.deadline(() => this.deps.renew!(p))))) {
        this.close(1013, "Lease expired");
        return;
      }
      this.dirty = true;
      void this.refresh();
    } catch (e) {
      this.fail(e);
    }
  }
  receive(text: string): void {
    if (this.closed) return;
    if (text.length <= 128) {
      try {
        const frame: unknown = JSON.parse(text);
        if (
          frame &&
          typeof frame === "object" &&
          !Array.isArray(frame) &&
          (frame as { type?: unknown }).type === "receipt"
        ) {
          const id = (frame as { id?: unknown }).id;
          if (typeof id !== "string" || id !== this.receipt?.id) {
            this.close(1008, "Invalid receipt");
            return;
          }
          const pending = this.receipt;
          this.receipt = undefined;
          pending.resolve();
          return;
        }
      } catch {
        /* Normal command parser reports invalid JSON. */
      }
    }
    if (this.deps.mode !== "interview" || !this.deps.commands) {
      this.close(1008, "Commands unavailable");
      return;
    }
    let command: SocketCommand;
    try {
      command = parseSocketCommand(text);
    } catch {
      this.close(1008, "Invalid command");
      return;
    }
    const now = this.now();
    this.credits = Math.min(120, this.credits + Math.max(0, now - this.creditAt) * 0.06);
    this.creditAt = now;
    if (this.credits < 1) {
      this.close(1008, "Command rate exceeded");
      return;
    }
    this.credits--;
    if (this.active.has(command.id)) {
      this.close(1008, "Duplicate request");
      return;
    }
    const lane = ["push", "pull", "rule-event"].includes(command.type)
      ? this.lanes.command
      : this.lanes.advisory;
    if (lane.queue.length >= 16) {
      void this.send({ type: "response", id: command.id, error: unavailable });
      return;
    }
    this.active.add(command.id);
    lane.queue.push(command);
    void this.run(lane);
  }
  private async run(lane: Lane): Promise<void> {
    if (lane.running) return;
    lane.running = true;
    try {
      while (lane.queue.length && !this.closed) {
        const cmd = lane.queue.shift()!;
        try {
          const { principal: p, stamp } = await this.authorized();
          if (!p) throw new ApplicationError("unauthenticated", "Sign in required", 401);
          const value = await this.deadline((signal) =>
            this.deps.commands!.execute(p, cmd, signal),
          );
          if (!this.closed) await this.send({ type: "response", id: cmd.id, value }, stamp);
        } catch (e) {
          if (e instanceof SocketDeadline) {
            this.close(1013, "Command timed out");
            return;
          }
          if (denied(e)) {
            this.close(1008, "Access changed");
            return;
          }
          const error =
            e instanceof ApplicationError
              ? { code: e.code, status: e.status, message: e.message }
              : unavailable;
          await this.send({ type: "response", id: cmd.id, error });
        } finally {
          this.active.delete(cmd.id);
        }
      }
    } finally {
      lane.running = false;
    }
  }
}
