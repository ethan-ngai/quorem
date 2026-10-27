/** Private infrastructure relay; browser identity and match access remain in the Go API. */
interface Env {
  MATCH_RELAYS: DurableObjectNamespace;
  RELAY_TOKEN: string;
}
const channelPattern = /^\/(matches|match-invites|interviews|memberships)\/[0-9a-fA-F-]{36}$/;

async function authorized(request: Request, secret: string): Promise<boolean> {
  if (!secret || secret.length < 32) return false;
  const provided = request.headers.get("Authorization") ?? "";
  // Fixed-length digests avoid revealing a matching credential prefix.
  const digest = (value: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [left, right] = await Promise.all([digest(provided), digest(`Bearer ${secret}`)]);
  return crypto.subtle.timingSafeEqual(left, right);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!(await authorized(request, env.RELAY_TOKEN))) return new Response(null, { status: 401 });
    const channel = new URL(request.url).pathname;
    if (!channelPattern.test(channel)) return new Response(null, { status: 404 });
    if (
      request.method !== "POST" &&
      !(request.method === "GET" && request.headers.get("Upgrade")?.toLowerCase() === "websocket")
    ) {
      return new Response(null, { status: 405 });
    }
    return env.MATCH_RELAYS.get(env.MATCH_RELAYS.idFromName(channel)).fetch(request);
  },
};

/** One bounded fanout group per match; no product state or source code is stored here. */
export class MatchRelay {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      if (this.state.getWebSockets().length >= 256) return new Response(null, { status: 429 });
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    let length = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      chunks.push(value);
    }
    const body = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
    const notice: unknown = (() => {
      try {
        return JSON.parse(body);
      } catch {
        return undefined;
      }
    })();
    if (!validNotice(notice, new URL(request.url).pathname))
      return new Response(null, { status: 400 });
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(body);
      } catch {
        socket.close(1011, "Relay unavailable");
      }
    }
    return new Response(null, { status: 204 });
  }

  webSocketMessage(socket: WebSocket) {
    socket.close(1008, "Read-only subscription");
  }
  webSocketClose(socket: WebSocket, code: number) {
    socket.close(code);
  }
  webSocketError(socket: WebSocket) {
    socket.close(1011, "Relay unavailable");
  }
}

function validNotice(notice: unknown, channel: string): boolean {
  if (!notice || typeof notice !== "object") return false;
  const n = notice as Record<string, unknown>;
  const keys = ["ID", "AggregateID", "Version", "Type", "OccurredAt"];
  return (
    channelPattern.test(channel) &&
    Object.keys(n).every((key) => keys.includes(key)) &&
    keys.every(
      (key) =>
        typeof n[key] === "string" &&
        (n[key] as string).length > 0 &&
        (n[key] as string).length <= 128,
    ) &&
    (channel === `/matches/${n.AggregateID as string}` ||
      channel === `/match-invites/${n.AggregateID as string}` ||
      channel === `/interviews/${n.AggregateID as string}` ||
      channel === `/memberships/${n.AggregateID as string}`) &&
    Number.isFinite(Date.parse(n.OccurredAt as string))
  );
}
