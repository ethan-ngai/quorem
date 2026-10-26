/** Local ingress/storage/upgrade fixture; no container runtime or account credentials. */
import { DurableObject } from "cloudflare:workers";
import worker from "./worker.js";
export { AppPool } from "./router.js";

export class RoutingApp extends DurableObject {
  async fetch(request) {
    const headers = new Headers();
    headers.append("Set-Cookie", "session=fixture; HttpOnly; Secure; SameSite=Lax");
    headers.append("Set-Cookie", "csrf=fixture; Secure; SameSite=Lax");
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const server = pair[1];
      server.accept();
      server.addEventListener("message", (event) => server.send(event.data));
      headers.set("Sec-WebSocket-Protocol", "quorem");
      return new Response(null, { status: 101, webSocket: pair[0], headers });
    }
    return Response.json({ instance: this.ctx.id.toString() }, { headers });
  }
}

export default worker;
