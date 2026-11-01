/** @file cloudflare.ts @description Private Cloudflare relay client. @module events */
import type { Notice } from "../../../modules/events/dispatch/ports.ts";
import { endpoint, validChannel, wireNotice } from "./common.ts";
import { RemoteSocket } from "./remote.ts";
export class CloudflareFanout {
  private readonly base: URL;
  constructor(base: string, privateToken: string) {
    this.base = endpoint(base);
    if (privateToken.length < 32) throw new Error("Invalid relay credential");
    this.token = privateToken;
  }
  private readonly token: string;
  private target(channel: string, socket = false): string {
    if (!validChannel(channel)) throw new Error("Invalid event channel");
    const u = new URL(this.base);
    u.pathname = u.pathname.replace(/\/$/, "") + channel;
    if (socket) u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.toString();
  }
  async publish(channel: string, notice: Notice): Promise<void> {
    const body = JSON.stringify(wireNotice(channel, notice));
    try {
      const res = await fetch(this.target(channel), {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      await res.body?.cancel();
      if (res.status !== 204) throw new Error();
    } catch {
      throw new Error("Fanout unavailable");
    }
  }
  async subscribe(
    channel: string,
    notice: (n: Notice) => void,
    lost: () => void,
    signal: AbortSignal,
  ): Promise<() => void> {
    const boot = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
    const remote = new RemoteSocket(
      this.target(channel, true),
      [],
      { authorization: `Bearer ${this.token}` },
      signal,
    );
    try {
      await remote.open(boot);
      return remote.listen(channel, (raw) => [JSON.parse(raw)], notice, lost);
    } catch {
      remote.close();
      throw new Error("Fanout unavailable");
    }
  }
}
