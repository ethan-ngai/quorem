/** @file verification-http.ts @description Dedicated private transport for a result verifier. @module judging */
import type { ConnectionScope } from "@quorem/database/core";
import { postgresInputReader } from "../inputs/read.ts";
import { postgresVerificationSource } from "./verification-source.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const encoder = new TextEncoder();
function base64(bytes: Uint8Array): string {
  let s = "";
  for (const value of bytes) s += String.fromCharCode(value);
  return btoa(s);
}
function decode(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length > 87384 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw new Error("Invalid bytes");
  const raw = atob(value);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      n += chunk.value.length;
      if (n > 90000) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      parts.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(n);
  let pos = 0;
  for (const part of parts) {
    all.set(part, pos);
    pos += part.length;
  }
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request");
  return value as Record<string, unknown>;
}
/** Mount only on the private API; credential is distinct from runner credentials. */
export function createVerificationSourceHandler(run: Run, credential: Uint8Array) {
  if (credential.length !== 32) throw new Error("Invalid verification credential");
  const secret = new Uint8Array(credential);
  const source = postgresVerificationSource(run),
    inputs = postgresInputReader(run);
  return async (request: Request): Promise<Response> => {
    const auth = request.headers.get("authorization") ?? "",
      token = /^Bearer [0-9a-f]{64}$/.test(auth)
        ? Uint8Array.from(auth.slice(7).match(/../g)!, (v) => parseInt(v, 16))
        : new Uint8Array(32);
    let diff = /^Bearer [0-9a-f]{64}$/.test(auth) ? 0 : 1;
    for (let i = 0; i < 32; i++) diff |= token[i] ^ secret[i];
    if (diff) return new Response(null, { status: 401 });
    if (request.method !== "POST") return new Response(null, { status: 404 });
    const url = new URL(request.url);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      return new Response(null, { status: 400 });
    try {
      const data = await body(request);
      if (
        typeof data.challenge !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.challenge)
      )
        throw new Error("Invalid challenge");
      const id = data.challenge,
        frozen = await source.frozenCase(id);
      let result: unknown;
      switch (new URL(request.url).pathname) {
        case "/internal/verification/frozen":
          result = frozen;
          break;
        case "/internal/verification/field": {
          if (
            (data.field !== "actual" && data.field !== "sqlTypes") ||
            typeof data.offset !== "number"
          )
            throw new Error("Invalid field");
          const page = await source.fieldPage(id, data.field, data.offset);
          result = { ...page, bytes: base64(page.bytes) };
          break;
        }
        case "/internal/verification/manifest":
          result = await inputs.inputManifest(frozen.job);
          break;
        case "/internal/verification/ref":
          result = await inputs.inputCaseRef(frozen.job, frozen.ordinal);
          break;
        case "/internal/verification/page": {
          if ((data.kind !== "metadata" && data.kind !== "case") || typeof data.offset !== "number")
            throw new Error("Invalid page");
          const page = await inputs.inputPage(
            frozen.job,
            data.kind,
            data.kind === "case" ? frozen.ordinal : 0,
            data.offset,
          );
          result = { ...page, bytes: base64(page.bytes) };
          break;
        }
        case "/internal/verification/output": {
          if (
            (data.field !== "actual" && data.field !== "expected") ||
            typeof data.ordinal !== "number"
          )
            throw new Error("Invalid output");
          await source.putChunk(id, data.field, data.ordinal, decode(data.bytes));
          result = { ok: true };
          break;
        }
        default:
          return new Response(null, { status: 404 });
      }
      return Response.json(result, { headers: { "cache-control": "no-store" } });
    } catch {
      return new Response(null, { status: 503, headers: { "cache-control": "no-store" } });
    }
  };
}
