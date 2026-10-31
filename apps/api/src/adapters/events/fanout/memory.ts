/** @file memory.ts @description Bounded local safe-notice fanout. @module events */
import type { Notice } from "../../../modules/events/dispatch/ports.ts";
import { safeNotice, validChannel } from "./common.ts";
type Subscriber = { notice: (n: Notice) => void; lost: () => void };
export class MemoryFanout {
  private readonly subscriptions = new Map<string, Set<Subscriber>>();
  private closed = false;
  private readonly limit: number;
  constructor(limit = 4096) {
    this.limit = limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4096)
      throw new RangeError("Invalid fanout capacity");
  }
  async publish(channel: string, value: Notice): Promise<void> {
    if (this.closed) throw new Error("Fanout unavailable");
    const notice = safeNotice(channel, value);
    for (const s of this.subscriptions.get(channel) ?? []) {
      try {
        s.notice(notice);
      } catch {
        try {
          s.lost();
        } catch {
          /* Continue delivering to other subscribers. */
        }
      }
    }
  }
  async subscribe(
    channel: string,
    notice: (n: Notice) => void,
    lost: () => void,
    signal?: AbortSignal,
  ): Promise<() => void> {
    if (this.closed || signal?.aborted || !validChannel(channel))
      throw new Error("Fanout unavailable");
    const count = [...this.subscriptions.values()].reduce((n, s) => n + s.size, 0);
    const existing = this.subscriptions.get(channel);
    if (
      count >= this.limit ||
      (existing?.size ?? 0) >= (channel.startsWith("/interviews/") ? 48 : 8)
    )
      throw new Error("Fanout capacity");
    const set = existing ?? new Set<Subscriber>();
    this.subscriptions.set(channel, set);
    const subscriber = { notice, lost };
    set.add(subscriber);
    const stop = () => {
      signal?.removeEventListener("abort", stop);
      set.delete(subscriber);
      if (!set.size) this.subscriptions.delete(channel);
    };
    signal?.addEventListener("abort", stop, { once: true });
    return stop;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const set of this.subscriptions.values())
      for (const s of set) {
        try {
          s.lost();
        } catch {
          /* Other subscribers still need closure. */
        }
      }
    this.subscriptions.clear();
  }
}
