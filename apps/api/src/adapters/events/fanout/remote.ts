/** @file remote.ts @description Bounded server-only fanout transport. @module events */
import WebSocket from "ws";
import type { Notice } from "../../../modules/events/dispatch/ports.ts";
import { safeNotice, frameText } from "./common.ts";
export async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("Fanout unavailable");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > 65536) throw new Error("Fanout unavailable");
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new Error("Fanout unavailable");
  }
}
export async function abortable<T>(signal: AbortSignal, action: Promise<T>): Promise<T> {
  if (signal.aborted) throw new Error("Fanout unavailable");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("Fanout unavailable"));
    signal.addEventListener("abort", abort, { once: true });
    void action.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
export class RemoteSocket {
  readonly ws: WebSocket;
  private queue: string[] = [];
  private waiter?: { resolve: (v: string) => void; reject: () => void };
  private closed = false;
  private onLost?: () => void;
  private handler?: (raw: string) => void;
  private readonly signal: AbortSignal;
  private readonly onAbort: () => void;
  constructor(
    url: string,
    protocols: string[],
    headers: Record<string, string>,
    signal: AbortSignal,
  ) {
    this.signal = signal;
    this.onAbort = () => this.close();
    this.ws = new WebSocket(url, protocols, {
      headers,
      handshakeTimeout: 10000,
      maxPayload: 65536,
      perMessageDeflate: false,
      followRedirects: false,
    });
    this.ws.on("error", () => this.fail());
    this.ws.on("close", () => this.fail());
    this.ws.on("message", (raw, binary) => {
      if (binary) {
        this.fail();
        return;
      }
      const value = frameText(raw);
      if (this.handler) {
        try {
          this.handler(value);
        } catch {
          this.fail();
        }
      } else if (this.waiter) {
        const waiter = this.waiter;
        this.waiter = undefined;
        waiter.resolve(value);
      } else if (this.queue.length < 16) this.queue.push(value);
      else this.fail();
    });
    signal.addEventListener("abort", this.onAbort, { once: true });
    if (signal.aborted) this.close();
  }
  private fail() {
    if (this.closed) return;
    this.closed = true;
    this.signal.removeEventListener("abort", this.onAbort);
    this.waiter?.reject();
    this.waiter = undefined;
    this.ws.terminate();
    this.onLost?.();
  }
  async open(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error("Fanout unavailable");
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        cleanup();
        reject(new Error("Fanout unavailable"));
      };
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        this.ws.off("error", abort);
      };
      signal.addEventListener("abort", abort, { once: true });
      this.ws.once("error", abort);
      this.ws.once("open", () => {
        cleanup();
        resolve();
      });
    });
  }
  send(value: unknown): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) throw new Error("Fanout unavailable");
    this.ws.send(JSON.stringify(value));
  }
  async next(signal: AbortSignal): Promise<Record<string, unknown>> {
    if (this.closed || signal.aborted) throw new Error("Fanout unavailable");
    const raw =
      this.queue.shift() ??
      (await new Promise<string>((resolve, reject) => {
        const abort = () => {
          this.waiter = undefined;
          reject(new Error("Fanout unavailable"));
        };
        signal.addEventListener("abort", abort, { once: true });
        this.waiter = {
          resolve: (value) => {
            signal.removeEventListener("abort", abort);
            resolve(value);
          },
          reject: () => {
            signal.removeEventListener("abort", abort);
            reject(new Error("Fanout unavailable"));
          },
        };
      }));
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error("Fanout unavailable");
    }
  }
  listen(
    channel: string,
    decode: (raw: string) => unknown[],
    notice: (n: Notice) => void,
    lost: () => void,
    idle = 0,
  ): () => void {
    if (this.closed) {
      lost();
      return () => {};
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (!idle) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this.fail(), idle);
      timer.unref();
    };
    this.onLost = () => {
      if (timer) clearTimeout(timer);
      lost();
    };
    this.handler = (raw) => {
      arm();
      for (const value of decode(raw)) notice(safeNotice(channel, value));
    };
    for (const raw of this.queue.splice(0)) {
      try {
        this.handler(raw);
      } catch {
        this.fail();
        break;
      }
    }
    if (!this.closed) arm();
    return () => {
      if (timer) clearTimeout(timer);
      this.onLost = undefined;
      this.close();
    };
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.signal.removeEventListener("abort", this.onAbort);
    this.waiter?.reject();
    this.waiter = undefined;
    this.ws.terminate();
  }
}
