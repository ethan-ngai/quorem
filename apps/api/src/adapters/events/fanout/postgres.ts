/** @file postgres.ts @description PostgreSQL LISTEN fanout and reconnect. @module events */
import { Client, Pool } from "pg";
import type { Notice } from "../../../modules/events/dispatch/ports.ts";
import { MemoryFanout } from "./memory.ts";
import { safeNotice, wireNotice } from "./common.ts";
export class PostgresFanout {
  private hub: MemoryFanout;
  private listener?: Client;
  private reconnect?: ReturnType<typeof setTimeout>;
  private closed = false;
  private ready = false;
  private readonly pool: Pool;
  private readonly listenURL: string;
  private readonly capacity: number;
  constructor(databaseURL: string, listenURL: string, capacity = 4096) {
    this.listenURL = listenURL;
    this.capacity = capacity;
    this.hub = new MemoryFanout(capacity);
    this.pool = new Pool({
      connectionString: databaseURL,
      max: 1,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      query_timeout: 5000,
    });
    this.pool.on("error", () => this.disconnected());
  }
  async start(): Promise<void> {
    await this.connect();
  }
  private async connect(): Promise<void> {
    if (this.closed) return;
    const client = new Client({
      connectionString: this.listenURL,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    });
    let ended = false;
    const lost = () => {
      ended = true;
      if (this.listener === client) this.disconnected();
    };
    client.on("error", lost);
    client.on("end", lost);
    client.on("notification", (event) => {
      if (
        event.channel !== "quorem_realtime_fanout" ||
        !event.payload ||
        Buffer.byteLength(event.payload) > 7000
      )
        return;
      try {
        const e = JSON.parse(event.payload) as { Channel: string; Notice: unknown };
        void this.hub.publish(e.Channel, safeNotice(e.Channel, e.Notice)).catch(() => {});
      } catch {
        /* Invalid untrusted notification. */
      }
    });
    try {
      await client.connect();
      await client.query("LISTEN quorem_realtime_fanout");
      if (this.closed) {
        await client.end();
        return;
      }
      if (ended) throw new Error("Fanout unavailable");
      this.listener = client;
      this.ready = true;
    } catch {
      await client.end().catch(() => {});
      throw new Error("Fanout unavailable");
    }
  }
  private disconnected(): void {
    if (this.closed || !this.ready) return;
    this.ready = false;
    const old = this.listener;
    this.listener = undefined;
    void old?.end().catch(() => {});
    this.hub.close();
    this.hub = new MemoryFanout(this.capacity);
    const retry = () => {
      if (this.closed) return;
      this.reconnect = setTimeout(() => void this.connect().catch(retry), 1000);
      this.reconnect.unref();
    };
    retry();
  }
  async publish(channel: string, notice: Notice): Promise<void> {
    const payload = JSON.stringify({ Channel: channel, Notice: wireNotice(channel, notice) });
    if (Buffer.byteLength(payload) > 7000 || this.closed) throw new Error("Fanout unavailable");
    try {
      await this.pool.query("SELECT pg_notify('quorem_realtime_fanout',$1)", [payload]);
    } catch {
      throw new Error("Fanout unavailable");
    }
  }
  subscribe(
    channel: string,
    notice: (n: Notice) => void,
    lost: () => void,
    signal?: AbortSignal,
  ): Promise<() => void> {
    if (!this.ready) return Promise.reject(new Error("Fanout unavailable"));
    return this.hub.subscribe(channel, notice, lost, signal);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    if (this.reconnect) clearTimeout(this.reconnect);
    this.hub.close();
    await this.listener?.end().catch(() => {});
    await this.pool.end();
  }
}
