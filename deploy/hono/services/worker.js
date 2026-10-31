/** Staged, purpose-scoped ingress for trusted services and attested cases. */
import { DurableObject } from "cloudflare:workers";
import { ContainerLifecycle } from "../../container.js";
import { caseRequest } from "../../case-service.js";
import { signedCaseProbe } from "../../case-proof.js";
export { CaseSandbox } from "../../case-sandbox.js";

const runnerKeys = [
  "QUOREM_RUNNER_COMMAND_ORIGIN",
  "QUOREM_RUNNER_COMMAND_SECRET",
  "QUOREM_RUNNER_DRAIN_SECRET",
  "QUOREM_CASE_ORIGIN",
  "QUOREM_CASE_SECRET",
  "QUOREM_CASE_NAMESPACE_ID",
  "QUOREM_CASE_OWNER_PUBLIC_KEY_PEM",
  "QUOREM_CASE_ACCESS_CLIENT_ID",
  "QUOREM_CASE_ACCESS_CLIENT_SECRET",
  "QUOREM_RUNNER_SLOTS",
  "QUOREM_SANDBOX_CLEANUP_MS",
];
const verifierKeys = [
  "QUOREM_VERIFICATION_SOURCE_ORIGIN",
  "QUOREM_VERIFICATION_SOURCE_KEY",
  "QUOREM_VERIFICATION_SERVICE_KEY",
  "QUOREM_VERIFICATION_SIGNING_KEY_PEM",
  "QUOREM_VERIFICATION_TIMEOUT_MS",
];
function selected(env, keys) {
  return Object.fromEntries(
    keys.filter((key) => typeof env[key] === "string").map((key) => [key, env[key]]),
  );
}
function config(env) {
  const secrets = [
    env.QUOREM_RUNNER_COMMAND_SECRET,
    env.QUOREM_RUNNER_DRAIN_SECRET,
    env.QUOREM_CASE_SECRET,
    env.QUOREM_VERIFICATION_SOURCE_KEY,
    env.QUOREM_VERIFICATION_SERVICE_KEY,
    env.RUNNER_API_ACCESS_CLIENT_SECRET,
    env.VERIFIER_API_ACCESS_CLIENT_SECRET,
    env.QUOREM_CASE_ACCESS_CLIENT_SECRET,
  ];
  if (
    secrets.some((value) => typeof value !== "string" || value.length < 32 || /\s/.test(value)) ||
    new Set(secrets).size !== secrets.length
  )
    throw new Error("Invalid private service configuration");
  const accessIds = [
    env.RUNNER_API_ACCESS_CLIENT_ID,
    env.VERIFIER_API_ACCESS_CLIENT_ID,
    env.QUOREM_CASE_ACCESS_CLIENT_ID,
  ];
  if (
    accessIds.some((value) => typeof value !== "string" || !value || /\s/.test(value)) ||
    new Set(accessIds).size !== accessIds.length ||
    !env.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM ||
    !env.QUOREM_VERIFICATION_SIGNING_KEY_PEM ||
    !env.CASE_OWNER_PRIVATE_KEY
  )
    throw new Error("Invalid private ingress credentials");
  const origins = [env.DRAIN_ORIGIN, env.VERIFIER_ORIGIN, env.CASE_ORIGIN].map((value) => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid private origin");
    return url.origin;
  });
  if (new Set(origins).size !== origins.length || origins[2] !== env.QUOREM_CASE_ORIGIN)
    throw new Error("Distinct private origins required");
  return origins;
}
async function caseScope(env) {
  const namespace = env.CASES.idFromName("quorem-sandbox-namespace-v1").toString();
  const pem = env.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM;
  const encoded = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const digest = (value) =>
    crypto.subtle
      .digest("SHA-256", value)
      .then((x) => Array.from(new Uint8Array(x), (b) => b.toString(16).padStart(2, "0")).join(""));
  const fingerprint = await digest(bytes);
  const scope = `remote:${await digest(new TextEncoder().encode(JSON.stringify([new URL(env.CASE_ORIGIN).origin, namespace, fingerprint])))}`;
  return { namespace, scope };
}
function clean(request) {
  const headers = new Headers(request.headers);
  headers.delete("CF-Access-Client-Id");
  headers.delete("CF-Access-Client-Secret");
  return new Request(request, { headers });
}
class Service extends DurableObject {
  constructor(ctx, env, kind) {
    super(ctx, env);
    const runner = kind === "runner";
    const values = selected(env, runner ? runnerKeys : verifierKeys);
    values.CLOUDFLARE_ACCESS_CLIENT_ID = runner
      ? env.RUNNER_API_ACCESS_CLIENT_ID
      : env.VERIFIER_API_ACCESS_CLIENT_ID;
    values.CLOUDFLARE_ACCESS_CLIENT_SECRET = runner
      ? env.RUNNER_API_ACCESS_CLIENT_SECRET
      : env.VERIFIER_API_ACCESS_CLIENT_SECRET;
    Object.assign(
      values,
      runner
        ? {
            QUOREM_RUNNER_MODE: "http",
            QUOREM_RUNNER_LISTEN: "0.0.0.0:8090",
            QUOREM_SANDBOX_PROVIDER: "remote",
            QUOREM_PRIVATE_SERVICE: "runner",
          }
        : { QUOREM_VERIFIER_LISTEN: "0.0.0.0:8091", QUOREM_PRIVATE_SERVICE: "verifier" },
    );
    this.lifecycle = new ContainerLifecycle(ctx, values, runner ? 8090 : 8091, 60000, 120000);
  }
  fetch(request) {
    return this.lifecycle.forward(clean(request), 240000);
  }
}
export class RunnerService extends Service {
  constructor(ctx, env) {
    super(ctx, env, "runner");
  }
}
export class VerifierService extends Service {
  constructor(ctx, env) {
    super(ctx, env, "verifier");
  }
}
export default {
  async fetch(request, env) {
    try {
      const [drain, verifier, cases] = config(env),
        url = new URL(request.url);
      if (url.search || url.hash) return new Response(null, { status: 404 });
      if (
        url.origin === cases &&
        url.pathname === "/internal/case/namespace" &&
        request.method === "GET" &&
        request.headers.get("authorization") === `Bearer ${env.QUOREM_CASE_SECRET}`
      ) {
        if (env.CASE_DIAGNOSTICS !== "true") return new Response(null, { status: 404 });
        const namespace = env.CASES.idFromName("quorem-sandbox-namespace-v1").toString();
        return await signedCaseProbe(env, {
          kind: "namespace",
          scope: "",
          attempt: "namespace",
          nonce: request.headers.get("x-quorem-owner-nonce"),
          value: { namespace },
        });
      }
      if (
        url.origin === drain &&
        url.pathname === "/internal/drain" &&
        request.method === "POST" &&
        request.headers.get("authorization") === `Bearer ${env.QUOREM_RUNNER_DRAIN_SECRET}`
      ) {
        if (
          env.CASES.idFromName("quorem-sandbox-namespace-v1").toString() !==
          env.QUOREM_CASE_NAMESPACE_ID
        )
          return new Response(null, { status: 503 });
        return env.RUNNERS.getByName("runner").fetch(clean(request));
      }
      if (
        url.origin === verifier &&
        url.pathname === "/internal/results/verify" &&
        request.method === "POST" &&
        request.headers.get("authorization") === `Bearer ${env.QUOREM_VERIFICATION_SERVICE_KEY}`
      )
        return env.VERIFIERS.getByName("verifier").fetch(clean(request));
      const attempt =
        url.origin === cases &&
        url.pathname.match(/^\/internal\/case\/([a-zA-Z0-9-]{1,128})$/)?.[1];
      if (attempt) {
        if (
          request.method === "GET" &&
          attempt !== "ready" &&
          (env.CASE_DIAGNOSTICS !== "true" ||
            request.headers.get("x-quorem-case-probe") !== "lifecycle" ||
            !request.headers.get("x-quorem-owner-nonce") ||
            !request.headers.get("x-quorem-owner-scope"))
        )
          return new Response(null, { status: 404 });
        if (
          request.method === "POST" ||
          (request.method === "GET" && request.headers.get("x-quorem-case-probe") === "lifecycle")
        ) {
          if (request.method === "GET" && request.headers.has("x-case-token"))
            return new Response(null, { status: 404 });
          const bound = await caseScope(env);
          if (
            bound.namespace !== env.QUOREM_CASE_NAMESPACE_ID ||
            request.headers.get("x-quorem-owner-scope") !== bound.scope
          )
            return new Response(null, { status: request.method === "POST" ? 503 : 404 });
        }
        if (
          request.method !== "GET" &&
          (!request.headers.get("x-quorem-owner-nonce") ||
            !request.headers.get("x-quorem-owner-scope"))
        )
          return new Response(null, { status: 404 });
        return caseRequest(request, env, attempt, env.QUOREM_CASE_SECRET);
      }
      return new Response(null, { status: 404 });
    } catch {
      return new Response(null, { status: 503 });
    }
  },
};
