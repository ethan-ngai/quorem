/** Exercise a real staged submission through the deployed Worker and drain. */
import { randomUUID } from "node:crypto";
import { accessFetch } from "../packages/execution/src/transport/access.ts";

function stagedOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/(^|-)stag(e|ing)(-|$)/.test(url.hostname.split(".")[0])
  )
    throw new Error("Invalid staged origin");
  return url.origin;
}
async function json(response) {
  if (!response.body) throw new Error("Missing stage response");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Error("Oversized stage response");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}

export async function hostedAcceptance(env, send = fetch) {
  const api = stagedOrigin(env.HONO_STAGE_API_ORIGIN),
    drain = stagedOrigin(env.HONO_DRAIN_ORIGIN);
  if (
    api === drain ||
    !/^[0-9a-f-]{36}$/.test(env.HONO_STAGE_WORKSPACE_ID ?? "") ||
    !env.HONO_STAGE_SESSION_COOKIE ||
    /[\r\n]/.test(env.HONO_STAGE_SESSION_COOKIE) ||
    !env.HONO_STAGE_ACCEPT_SOURCE ||
    new TextEncoder().encode(env.HONO_STAGE_ACCEPT_SOURCE).length > 65536
  )
    throw new Error("Invalid staged acceptance fixture");
  const token = env.EXECUTION_DRAIN_SECRET,
    id = env.EXECUTION_DRAIN_ACCESS_CLIENT_ID,
    secret = env.EXECUTION_DRAIN_ACCESS_CLIENT_SECRET;
  if (
    !token ||
    token.length < 32 ||
    !id ||
    !secret ||
    id === secret ||
    /\s/.test(token + id + secret)
  )
    throw new Error("Invalid staged drain credentials");
  const privateFetch = accessFetch(drain, { id, secret }, send);
  const headers = {
    cookie: env.HONO_STAGE_SESSION_COOKIE,
    origin: api,
    "content-type": "application/json",
  };
  const admission = await send(`${api}/v1/submissions`, {
    method: "POST",
    headers: { ...headers, "idempotency-key": `stage-${randomUUID()}` },
    body: JSON.stringify({
      workspaceId: env.HONO_STAGE_WORKSPACE_ID,
      kind: "submit",
      source: env.HONO_STAGE_ACCEPT_SOURCE,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (admission.status !== 202) throw new Error("Stage admission failed");
  const submission = (await json(admission)).id;
  if (!/^[0-9a-f-]{36}$/.test(submission ?? "")) throw new Error("Invalid stage submission");
  const drained = await privateFetch(`${drain}/internal/drain`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(210000),
  });
  if (drained.status !== 200) throw new Error("Stage drain failed");
  const response = await send(`${api}/v1/submissions/${submission}`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status !== 200 || (await json(response)).verdict !== "accepted")
    throw new Error("Stage submission not accepted");
  return { submission };
}
