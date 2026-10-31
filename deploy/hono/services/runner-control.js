/** Durable release authority; proof validation belongs to its trusted caller. */
import { DurableObject } from "cloudflare:workers";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const releasePattern = /^[0-9a-f]{40}$/;
const bindingPattern = /^[0-9a-f]{64}$/;
const maxBody = 4096;
const initial = () => ({ generation: 0, status: "paused", release: null, bindings: null });
const matches = (pattern, value) => typeof value === "string" && pattern.test(value);
const generation = (value) => Number.isSafeInteger(value) && value >= 0;
const historyKey = (value) => `history:${String(value).padStart(16, "0")}`;
const response = (status, value) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
const failure = (status) =>
  response(status, { error: status === 409 ? "conflict" : "invalid request" });
function validKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .join(",") === [...keys].sort((a, b) => a.localeCompare(b)).join(",")
  );
}
async function readJson(request) {
  if (!request.body || Number(request.headers.get("content-length")) > maxBody)
    throw new Error("Invalid body");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBody) {
        await reader.cancel();
        throw new Error("Invalid body");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export class RunnerReleaseControl extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.origin !== "https://runner-control.internal" || url.hash) return failure(404);
    try {
      if (request.method === "GET" && url.pathname === "/state" && !url.search) {
        const current = (await this.ctx.storage.get("state")) ?? initial();
        const { token: _token, ...publicState } = current;
        return response(200, publicState);
      }
      if (request.method === "GET" && url.pathname === "/history") {
        const params = [...url.searchParams];
        if (
          params.some(([key]) => !["after", "limit"].includes(key)) ||
          new Set(params.map(([key]) => key)).size !== params.length
        )
          return failure(400);
        const after = url.searchParams.get("after") ?? "0",
          limit = url.searchParams.get("limit") ?? "32";
        if (
          !/^(0|[1-9]\d{0,15})$/.test(after) ||
          !/^[1-9]\d?$/.test(limit) ||
          Number(limit) > 64 ||
          !generation(Number(after))
        )
          return failure(400);
        const rows = await this.ctx.storage.list({
          prefix: "history:",
          startAfter: historyKey(Number(after)),
          limit: Number(limit),
        });
        return response(200, { items: [...rows.values()] });
      }
      if (
        request.method !== "POST" ||
        url.search ||
        !["/prepare", "/activate", "/pause", "/gate"].includes(url.pathname)
      )
        return failure(404);
      let body;
      try {
        body = await readJson(request);
      } catch {
        return failure(400);
      }
      if (url.pathname === "/gate") {
        if (
          !validKeys(body, ["generation", "release"]) ||
          !generation(body.generation) ||
          !matches(releasePattern, body.release)
        )
          return failure(400);
        const state = (await this.ctx.storage.get("state")) ?? initial();
        if (
          state.status !== "active" ||
          state.generation !== body.generation ||
          state.release !== body.release
        )
          return failure(409);
        return response(200, {
          generation: state.generation,
          release: state.release,
          runner: `runner:${state.release}:${state.generation}`,
        });
      }
      const keys =
        url.pathname === "/prepare"
          ? ["operationId", "expectedGeneration", "release", "bindings"]
          : url.pathname === "/activate"
            ? ["operationId", "generation", "release", "bindings", "token"]
            : ["operationId", "generation"];
      if (!validKeys(body, keys) || !matches(uuid, body.operationId)) return failure(400);
      if (
        url.pathname === "/prepare" &&
        (!generation(body.expectedGeneration) ||
          body.expectedGeneration === Number.MAX_SAFE_INTEGER ||
          !matches(releasePattern, body.release) ||
          !matches(bindingPattern, body.bindings))
      )
        return failure(400);
      if (url.pathname !== "/prepare" && !generation(body.generation)) return failure(400);
      if (
        url.pathname === "/activate" &&
        (!matches(releasePattern, body.release) ||
          !matches(bindingPattern, body.bindings) ||
          !matches(uuid, body.token))
      )
        return failure(400);
      // Canonical field order makes retries independent of incoming JSON property order.
      const fingerprint = JSON.stringify([url.pathname, ...keys.map((key) => body[key])]);
      const outcome = await this.ctx.storage.transaction(async (tx) => {
        const key = `operation:${body.operationId}`;
        const previous = await tx.get(key);
        if (previous) return previous.fingerprint === fingerprint ? previous.receipt : null;
        const reject = async () => {
          await tx.put(key, { fingerprint, receipt: null });
          return null;
        };
        const state = (await tx.get("state")) ?? initial();
        let next, receipt;
        if (url.pathname === "/prepare") {
          if (state.generation !== body.expectedGeneration || state.status === "prepared")
            return reject();
          const nextGeneration = state.generation + 1,
            token = crypto.randomUUID();
          next = {
            generation: nextGeneration,
            status: "prepared",
            release: body.release,
            bindings: body.bindings,
            token,
          };
          receipt = {
            generation: nextGeneration,
            release: body.release,
            bindings: body.bindings,
            token,
            status: "prepared",
          };
          await tx.put(historyKey(nextGeneration), {
            generation: nextGeneration,
            release: body.release,
            bindings: body.bindings,
          });
        } else if (url.pathname === "/activate") {
          if (
            state.status !== "prepared" ||
            state.generation !== body.generation ||
            state.release !== body.release ||
            state.bindings !== body.bindings ||
            state.token !== body.token
          )
            return reject();
          next = {
            generation: state.generation,
            status: "active",
            release: state.release,
            bindings: state.bindings,
          };
          receipt = { ...next };
        } else {
          if (state.generation !== body.generation) return reject();
          next = {
            generation: state.generation,
            status: "paused",
            release: state.release,
            bindings: state.bindings,
          };
          receipt = { ...next };
        }
        await tx.put("state", next);
        await tx.put(key, { fingerprint, receipt });
        return receipt;
      });
      return outcome ? response(200, outcome) : failure(409);
    } catch {
      return response(503, { error: "unavailable" });
    }
  }
}
