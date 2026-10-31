import { DurableObject } from "cloudflare:workers";
import { signedCaseProbe } from "../../case-proof.js";
import { readControlJson } from "./control-http.js";

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
  /^[a-f0-9]{40}$/.test(v.release);
const same = (a, b) =>
  !!a &&
  genesisValid(b) &&
  ["namespace", "scope", "operation", "release"].every((key) => a[key] === b[key]);

const operationValid = (v) => typeof v === "string" && /^[a-f0-9-]{36}$/.test(v);
const generationValid = (v) => Number.isSafeInteger(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER;
const objectKeys = (v, keys) =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === keys;
const equalFields = (a, b) => Object.keys(b).every((key) => a[key] === b[key]);
/** Inventory persists across explicitly activated generations. */
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
        const value = await readControlJson(request);
        const result = await this.ctx.storage.transaction(async (tx) => {
          const state = (await tx.get("state")) ?? {
            genesis: null,
            active: false,
            generation: 0,
            release: null,
            bindings: null,
            activationOperation: null,
            pauseOperation: null,
          };
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
            if (
              !objectKeys(value, "bindings,expectedGeneration,operation,release") ||
              !operationValid(value.operation) ||
              !generationValid(value.expectedGeneration) ||
              typeof value.release !== "string" ||
              !/^[a-f0-9]{40}$/.test(value.release) ||
              typeof value.bindings !== "string" ||
              !/^[a-f0-9]{64}$/.test(value.bindings)
            )
              return 400;
            const previous = await tx.get(`operation:${value.operation}`);
            if (previous)
              return previous.kind === "activate" && equalFields(previous.value, value) ? 204 : 409;
            if (
              !state.genesis ||
              state.active ||
              state.generation !== value.expectedGeneration ||
              state.generation >= Number.MAX_SAFE_INTEGER - 1
            )
              return 409;
            await tx.put(`operation:${value.operation}`, { kind: "activate", value });
            state.generation++;
            state.active = true;
            state.release = value.release;
            state.bindings = value.bindings;
            state.activationOperation = value.operation;
            state.pauseOperation = null;
            await tx.put("state", state);
            return 204;
          }
          if (path === "/pause") {
            if (
              !objectKeys(value, "expectedGeneration,operation") ||
              !operationValid(value.operation) ||
              !generationValid(value.expectedGeneration)
            )
              return 400;
            const previous = await tx.get(`operation:${value.operation}`);
            if (previous)
              return previous.kind === "pause" && equalFields(previous.value, value) ? 204 : 409;
            if (!state.genesis || !state.active || state.generation !== value.expectedGeneration)
              return 409;
            await tx.put(`operation:${value.operation}`, { kind: "pause", value });
            state.active = false;
            state.pauseOperation = value.operation;
            await tx.put("state", state);
            return 204;
          }
          if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            Object.keys(value).sort().join() !== "attempt,generation,release" ||
            typeof value.attempt !== "string" ||
            !attemptPattern.test(value.attempt) ||
            !generationValid(value.generation) ||
            typeof value.release !== "string" ||
            !/^[a-f0-9]{40}$/.test(value.release)
          )
            return 400;
          if (
            !state.genesis ||
            !state.active ||
            state.generation !== value.generation ||
            state.release !== value.release
          )
            return 503;
          const prior = await tx.get(`attempt:${value.attempt}`);
          if (prior && (prior.generation !== value.generation || prior.release !== value.release))
            return 409;
          await tx.put(`attempt:${value.attempt}`, {
            generation: value.generation,
            release: value.release,
          });
          return 204;
        });
        return new Response(null, { status: result, headers: { "cache-control": "no-store" } });
      }
      if (request.method !== "GET" || !["/state", "/inventory"].includes(path))
        return new Response(null, { status: 404 });
      const state = (await this.ctx.storage.get("state")) ?? {
        genesis: null,
        active: false,
        generation: 0,
        release: null,
        bindings: null,
        activationOperation: null,
        pauseOperation: null,
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
        value = {
          namespace: state.genesis.namespace,
          scope: state.genesis.scope,
          initialOperation: state.genesis.operation,
          initialRelease: state.genesis.release,
          generation: state.generation,
          release: state.release,
          bindings: state.bindings,
          activationOperation: state.activationOperation,
          pauseOperation: state.pauseOperation,
          paused: !state.active,
        };
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
