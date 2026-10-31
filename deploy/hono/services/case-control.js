import { DurableObject } from "cloudflare:workers";
import { signedCaseProbe } from "../../case-proof.js";

const attemptPattern = /^[A-Za-z0-9-]{1,128}$/;
const genesisValid = (v) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join() === "namespace,operation,release,scope" &&
  typeof v.namespace === "string" &&
  /^[a-f0-9]{64}$/.test(v.namespace) &&
  v.namespace !== "0".repeat(64) &&
  typeof v.scope === "string" &&
  /^remote:[a-f0-9]{64}$/.test(v.scope) &&
  typeof v.operation === "string" &&
  /^[a-f0-9-]{36}$/.test(v.operation) &&
  typeof v.release === "string" &&
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v.release);
const same = (a, b) =>
  !!a &&
  genesisValid(b) &&
  ["namespace", "scope", "operation", "release"].every((key) => a[key] === b[key]);

async function json(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const parts = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 2048) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** One permanent inventory and irreversible pause for a case namespace. */
export class CaseControl extends DurableObject {
  async fetch(request) {
    try {
      const url = new URL(request.url),
        path = url.pathname;
      if (
        request.method === "POST" &&
        ["/initialize", "/activate", "/pause", "/register"].includes(path)
      ) {
        if (url.search) return new Response(null, { status: 400 });
        const value = await json(request);
        const result = await this.ctx.storage.transaction(async (tx) => {
          const state = (await tx.get("state")) ?? { genesis: null, active: false, halted: false };
          if (path === "/initialize") {
            if (
              !genesisValid(value) ||
              value.namespace !==
                this.env.CASES.idFromName("quorem-sandbox-namespace-v1").toString()
            )
              return 400;
            if (state.genesis && !same(state.genesis, value)) return 409;
            if (!state.genesis) {
              state.genesis = value;
              await tx.put("state", state);
            }
            return 204;
          }
          if (path === "/activate") {
            if (!same(state.genesis, value) || state.halted) return 409;
            state.active = true;
            await tx.put("state", state);
            return 204;
          }
          if (path === "/pause") {
            if (!same(state.genesis, value)) return 409;
            state.active = false;
            state.halted = true;
            await tx.put("state", state);
            return 204;
          }
          if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            Object.keys(value).join() !== "attempt" ||
            typeof value.attempt !== "string" ||
            !attemptPattern.test(value.attempt)
          )
            return 400;
          if (!state.genesis || !state.active || state.halted) return 503;
          await tx.put(`attempt:${value.attempt}`, true);
          return 204;
        });
        return new Response(null, { status: result, headers: { "cache-control": "no-store" } });
      }
      if (request.method !== "GET" || !["/state", "/inventory"].includes(path))
        return new Response(null, { status: 404 });
      const state = (await this.ctx.storage.get("state")) ?? {
        genesis: null,
        active: false,
        halted: false,
      };
      const scope = request.headers.get("x-quorem-owner-scope"),
        nonce = request.headers.get("x-quorem-owner-nonce");
      if (
        !state.genesis ||
        scope !== state.genesis.scope ||
        state.genesis.namespace !==
          this.env.CASES.idFromName("quorem-sandbox-namespace-v1").toString()
      )
        return new Response(null, { status: 503 });
      let value, kind;
      if (path === "/state") {
        if (url.search) return new Response(null, { status: 400 });
        kind = "control-state";
        value = { ...state.genesis, paused: !state.active, halted: state.halted };
      } else {
        if (
          [...url.searchParams.keys()].some((k) => !["after", "limit"].includes(k)) ||
          url.searchParams.getAll("after").length > 1 ||
          url.searchParams.getAll("limit").length > 1
        )
          return new Response(null, { status: 400 });
        const after = url.searchParams.get("after") ?? "",
          limit = url.searchParams.get("limit") ?? "4";
        if ((after && !attemptPattern.test(after)) || !/^[1-4]$/.test(limit))
          return new Response(null, { status: 400 });
        const entries = await this.ctx.storage.list({
          prefix: "attempt:",
          ...(after ? { startAfter: `attempt:${after}` } : {}),
          limit: Number(limit),
        });
        const attempts = [...entries.keys()].map((key) => key.slice(8));
        kind = "control-inventory";
        value = {
          after,
          attempts,
          next: attempts.length === Number(limit) ? attempts.at(-1) : null,
        };
      }
      return await signedCaseProbe(this.env, { kind, scope, attempt: "control", nonce, value });
    } catch {
      return new Response(null, { status: 503 });
    }
  }
}
