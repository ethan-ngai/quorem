/** @file remote.ts @description Scoped private case-service adapter. @module runner */
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { Readable } from "node:stream";
import { checkedInput } from "./input.ts";
import { decodeCaseFrames, type AttemptFence } from "@quorem/execution";
import { CaseOutputLimit, readinessBudget } from "./budget.ts";
import { confirmCaseFailure, confirmCaseOutput } from "./proof.ts";
import {
  type CaseOutput,
  type IsolatedSandbox,
  UnconfirmedTeardown,
  validateCaseRequest,
} from "./types.ts";
const text = new TextEncoder();
function local(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}
function join(parts: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
/** Each configured origin is one immutable sandbox namespace. */
export function remoteSandbox(config: {
  origin: string;
  secret: string;
  namespaceId: string;
  ownerPublicKey: string;
  cleanupMs: number;
  fetch?: typeof fetch;
}): IsolatedSandbox & { readonly scope: string } {
  let base: URL;
  try {
    base = new URL(config.origin);
  } catch {
    throw new Error("Invalid sandbox configuration");
  }
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.pathname !== "/" && base.pathname !== "") ||
    (base.protocol !== "https:" && !(base.protocol === "http:" && local(base.hostname))) ||
    text.encode(config.secret).length < 32 ||
    /\s/.test(config.secret) ||
    !/^[a-f0-9]{64}$/.test(config.namespaceId) ||
    !Number.isSafeInteger(config.cleanupMs) ||
    config.cleanupMs < 1
  )
    throw new Error("Invalid sandbox configuration");
  const client = config.fetch ?? fetch;
  let ownerKey: ReturnType<typeof createPublicKey>;
  try {
    ownerKey = createPublicKey(config.ownerPublicKey);
    if (ownerKey.asymmetricKeyType !== "ed25519") throw new Error("key");
  } catch {
    throw new Error("Invalid sandbox configuration");
  }
  const fingerprint = createHash("sha256")
    .update(ownerKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const scope = `remote:${createHash("sha256")
    .update(JSON.stringify([base.origin, config.namespaceId, fingerprint]))
    .digest("hex")}`;
  const attested = (
    response: Response,
    method: string,
    attempt: string,
    token: string | undefined,
    nonce: string,
    caseFields: readonly string[],
  ) => {
    const signature = response.headers.get("x-quorem-owner-signature");
    if (response.headers.get("x-quorem-owner-namespace") !== config.namespaceId) return false;
    if (!signature || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
    const bytes = Buffer.from(signature, "base64");
    if (bytes.length !== 64 || bytes.toString("base64") !== signature) return false;
    return verify(
      null,
      Buffer.from(
        JSON.stringify([
          scope,
          config.namespaceId,
          method,
          attempt,
          token ?? "",
          response.status,
          nonce,
          ...caseFields,
        ]),
      ),
      ownerKey,
      bytes,
    );
  };
  const endpoint = (attempt: string) => new URL(`/internal/case/${attempt}`, base);
  async function remove(
    fence: AttemptFence,
    token: string | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    if (fence.sandboxScope !== scope || !/^[A-Za-z0-9-]{1,128}$/.test(fence.attemptId))
      throw new UnconfirmedTeardown();
    try {
      const nonce = randomUUID();
      const response = await client(endpoint(fence.attemptId), {
        method: "DELETE",
        redirect: "manual",
        headers: {
          authorization: `Bearer ${config.secret}`,
          "x-quorem-owner-nonce": nonce,
          "x-quorem-owner-scope": scope,
          ...(token ? { "x-case-token": token } : {}),
        },
        signal: AbortSignal.any([
          AbortSignal.timeout(config.cleanupMs),
          ...(signal ? [signal] : []),
        ]),
      });
      const signatureValid = attested(response, "DELETE", fence.attemptId, token, nonce, [
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
      const confirmed = response.status === 204 && signatureValid;
      await response.body?.cancel();
      if (!confirmed)
        throw new UnconfirmedTeardown({ httpStatus: response.status, signatureValid });
    } catch (error) {
      if (error instanceof UnconfirmedTeardown) throw error;
      throw new UnconfirmedTeardown({
        transport:
          error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
            ? "timeout"
            : "error",
      });
    }
  }
  return {
    scope,
    async teardownAttempt(fence, signal) {
      await remove(fence, undefined, signal);
    },
    async runCase(request, signal): Promise<CaseOutput> {
      validateCaseRequest(request, scope);
      const token = randomUUID(),
        nonce = randomUUID(),
        controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), request.timeoutMs);
      const budget = readinessBudget({
        initialMs: 60000,
        compileMs: request.compileMs ?? 60000,
        wallMs: request.limits.wallTimeMs,
        markers: ["python", "postgresql"].includes(request.language) ? 1 : 2,
        signal,
      });
      const combined = AbortSignal.any([controller.signal, budget.signal]);
      const bodyHash = request.input.hash;
      const caseFields = [
        request.binding,
        bodyHash,
        String(request.ordinal),
        request.language,
        String(request.limits.memoryBytes),
        String(request.limits.maxProcesses),
      ];
      let complete = false;
      let failure: unknown;
      try {
        const response = await client(endpoint(request.fence.attemptId), {
          method: "POST",
          redirect: "manual",
          headers: {
            authorization: `Bearer ${config.secret}`,
            "x-quorem-owner-nonce": nonce,
            "x-quorem-owner-scope": scope,
            "x-case-token": token,
            "x-case-language": request.language,
            "x-case-memory": String(request.limits.memoryBytes),
            "x-case-processes": String(request.limits.maxProcesses),
            "x-quorem-case-binding": request.binding,
            "x-quorem-body-sha256": bodyHash,
            "x-quorem-case-ordinal": String(request.ordinal),
          },
          body: Readable.toWeb(
            Readable.from(checkedInput(request.input)),
          ) as ReadableStream<Uint8Array>,
          duplex: "half",
          signal: combined,
        } as RequestInit & { duplex: "half" });
        if (
          response.status !== 200 ||
          !response.body ||
          !attested(response, "POST", request.fence.attemptId, token, nonce, caseFields)
        ) {
          await response.body?.cancel();
          throw new Error("Case service unavailable");
        }
        const stdout: Uint8Array[] = [],
          stderr: Uint8Array[] = [];
        let out = 0,
          err = 0;
        const code = await decodeCaseFrames(
          response.body,
          { stdoutBytes: request.outputLimit * 6 + 1024, stderrBytes: request.limits.outputBytes },
          async (channel, data) => {
            const copy = new Uint8Array(data);
            if (channel === "stdout") {
              budget.observe(copy);
              stdout.push(copy);
              out += copy.length;
            } else {
              stderr.push(copy);
              err += copy.length;
            }
          },
          combined,
        );
        if (!budget.ready()) throw new Error("Sandbox did not become ready");
        complete = true;
        return confirmCaseOutput(request, {
          stdout: join(stdout, out),
          stderr: join(stderr, err),
          exitCode: code,
          compilationMs: budget.compilationMs(),
        });
      } catch (error) {
        failure =
          budget.deadline() ??
          (error instanceof Error && /(?:stdout|stderr) limit exceeded/.test(error.message)
            ? new CaseOutputLimit()
            : error);
      } finally {
        clearTimeout(timer);
        budget.close();
        if (!complete) await remove(request.fence, token);
      }
      if (failure instanceof Error) throw confirmCaseFailure(request, failure);
      throw failure;
    },
  };
}
