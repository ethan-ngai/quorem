/** @file appsync.ts @description Server-only AppSync Events notice fanout. @module events */
import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import type { Notice } from "../../../modules/events/dispatch/ports.ts";
import { endpoint, validChannel, wireNotice } from "./common.ts";
import { RemoteSocket, responseJson, abortable } from "./remote.ts";
type Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
export type AppSyncAuth =
  | { apiKey: string }
  | { region: string; credentials: () => Promise<Credentials> };
export class AppSyncFanout {
  private readonly http: URL;
  private readonly socket: URL;
  private readonly auth: AppSyncAuth;
  constructor(http: string, socket: string, auth: AppSyncAuth) {
    this.http = endpoint(http);
    this.socket = endpoint(socket, true);
    this.auth = auth;
    if ("apiKey" in auth ? !auth.apiKey : !auth.region)
      throw new Error("Invalid AppSync configuration");
  }
  async authorization(body: string, signingDate?: Date): Promise<Record<string, string>> {
    const host = this.http.host;
    if ("apiKey" in this.auth) return { host, "x-api-key": this.auth.apiKey };
    const signer = new SignatureV4({
      credentials: this.auth.credentials,
      region: this.auth.region,
      service: "appsync",
      sha256: Sha256,
    });
    const req = new HttpRequest({
      protocol: this.http.protocol,
      hostname: this.http.hostname,
      port: this.http.port ? Number(this.http.port) : undefined,
      path: this.http.pathname,
      method: "POST",
      headers: {
        host,
        accept: "application/json, text/javascript",
        "content-encoding": "amz-1.0",
        "content-type": "application/json; charset=UTF-8",
      },
      body,
    });
    const signed = await signer.sign(req, signingDate ? { signingDate } : {});
    return signed.headers;
  }
  async publish(channel: string, notice: Notice): Promise<void> {
    if (!validChannel(channel)) throw new Error("Invalid event channel");
    const body = JSON.stringify({ channel, events: [JSON.stringify(wireNotice(channel, notice))] });
    try {
      const deadline = AbortSignal.timeout(5000);
      const headers = await abortable(deadline, this.authorization(body));
      delete headers.host;
      if (!headers["content-type"]) headers["content-type"] = "application/json";
      const response = await fetch(this.http, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: deadline,
      });
      const result = (await responseJson(response)) as {
        successful?: unknown[];
        failed?: unknown[];
      };
      if (
        !Array.isArray(result.successful) ||
        result.successful.length !== 1 ||
        (result.failed !== undefined && (!Array.isArray(result.failed) || result.failed.length > 0))
      )
        throw new Error();
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
    if (!validChannel(channel)) throw new Error("Invalid event channel");
    let remote: RemoteSocket | undefined;
    try {
      const boot = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
      const authorization = await this.authorization("{}");
      const header = Buffer.from(JSON.stringify(authorization)).toString("base64url");
      remote = new RemoteSocket(
        this.socket.toString(),
        ["aws-appsync-event-ws", `header-${header}`],
        {},
        signal,
      );
      await remote.open(boot);
      remote.send({ type: "connection_init" });
      const ack = await remote.next(boot);
      if (
        ack.type !== "connection_ack" ||
        typeof ack.connectionTimeoutMs !== "number" ||
        ack.connectionTimeoutMs <= 0 ||
        ack.connectionTimeoutMs > 300000
      )
        throw new Error();
      const auth = await abortable(boot, this.authorization(JSON.stringify({ channel })));
      remote.send({ type: "subscribe", id: "quorem", channel, authorization: auth });
      let subscribed = await remote.next(boot);
      while (subscribed.type === "ka") subscribed = await remote.next(boot);
      if (
        subscribed.type !== "subscribe_success" ||
        (subscribed.id !== undefined && subscribed.id !== "quorem")
      )
        throw new Error();
      return remote.listen(
        channel,
        (raw) => {
          const frame = JSON.parse(raw) as { type: string; id?: string; event?: unknown };
          if (frame.type === "ka") return [];
          if (frame.type !== "data" || frame.id !== "quorem" || !Array.isArray(frame.event))
            throw new Error();
          return frame.event.map((value) => {
            if (typeof value !== "string") throw new Error();
            return JSON.parse(value);
          });
        },
        notice,
        lost,
        ack.connectionTimeoutMs,
      );
    } catch {
      remote?.close();
      throw new Error("Fanout unavailable");
    }
  }
}
