/** Staged, purpose-scoped ingress for trusted services and attested cases. */
import {
  CASE_SCOPE_REVISION,
  JUDGING_DEFAULTS,
} from "../../../packages/execution/src/scheduling.ts";
import { DurableObject } from "cloudflare:workers";
import { ContainerLifecycle } from "../../container.js";
import { caseRequest } from "../../case-service.js";
import { signedCaseProbe, validRunnerControlState } from "../../case-proof.js";
import { controlRequest, readControlJson } from "./control-http.js";
export { CaseControl } from "./case-control.js";
export { RunnerReleaseControl } from "./runner-control.js";
export { CaseSandbox } from "../../case-sandbox.js";

function config(env) {
  if (
    !/^[a-f0-9]{40}$/.test(env.SERVICES_RELEASE ?? "") ||
    !/^[a-f0-9]{64}$/.test(env.SERVICES_BINDINGS ?? "") ||
    !/^[1-9][0-9]{0,15}$/.test(env.SERVICES_GENERATION ?? "") ||
    !Number.isSafeInteger(Number(env.SERVICES_GENERATION))
  )
    throw new Error("Invalid release authority");
  const imageEnabled = env.IMAGE_SERVICE_ENABLED === "true";
  if (env.IMAGE_SERVICE_ENABLED && !["true", "false"].includes(env.IMAGE_SERVICE_ENABLED))
    throw new Error("Invalid image configuration");
  const secrets = [
    env.RECOVERY_CONTROL_SECRET,
    env.QUOREM_RUNNER_COMMAND_SECRET,
    env.QUOREM_RUNNER_DRAIN_SECRET,
    env.QUOREM_CASE_SECRET,
    ...(imageEnabled ? [env.IMAGE_SERVICE_TOKEN] : []),
    ...(env.MAIL_RELAY_ENABLED === "true" ? [env.MAIL_RELAY_TOKEN] : []),
  ];
  if (
    secrets.some((value) => typeof value !== "string" || value.length < 32 || /\s/.test(value)) ||
    new Set(secrets).size !== secrets.length
  )
    throw new Error("Invalid private service configuration");
  if (!env.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM || !env.CASE_OWNER_PRIVATE_KEY)
    throw new Error("Invalid private ingress credentials");
  const origins = [
    env.DRAIN_ORIGIN,
    env.VERIFIER_ORIGIN,
    env.CASE_ORIGIN,
    ...(imageEnabled ? [env.IMAGE_ORIGIN] : []),
  ].map((value) => {
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
  if (env.MAIL_RELAY_ENABLED === "true") {
    const mail = new URL(env.MAIL_RELAY_ORIGIN);
    if (
      mail.protocol !== "https:" ||
      mail.origin !== env.MAIL_RELAY_ORIGIN ||
      origins.includes(mail.origin)
    )
      throw new Error("Invalid mail relay origin");
  } else if (env.MAIL_RELAY_ENABLED && env.MAIL_RELAY_ENABLED !== "false")
    throw new Error("Invalid mail relay mode");
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
  const identity = [new URL(env.CASE_ORIGIN).origin, namespace, fingerprint];
  const hashScope = async (parts) =>
    `remote:${await digest(new TextEncoder().encode(JSON.stringify(parts)))}`;
  const [controlScope, scope] = await Promise.all([
    hashScope(identity),
    hashScope([...identity, CASE_SCOPE_REVISION]),
  ]);
  return { namespace, scope, controlScope };
}
function clean(request) {
  const headers = new Headers(request.headers);
  headers.delete("CF-Access-Client-Id");
  headers.delete("CF-Access-Client-Secret");
  return new Request(request, { headers });
}
function cleanImage(request) {
  const headers = new Headers();
  for (const key of ["authorization", "content-type", "x-image-format"]) {
    const value = request.headers.get(key);
    if (value !== null) headers.set(key, value);
  }
  return new Request(request, { headers });
}
/** Resolve the active runner generation for both queue and alarm wakes. */
async function activeRunner(env) {
  if (
    env.CASES.idFromName("quorem-sandbox-namespace-v1").toString() !== env.QUOREM_CASE_NAMESPACE_ID
  )
    return null;
  const generation = Number(env.SERVICES_GENERATION);
  const release = env.SERVICES_RELEASE;
  const runner = `runner:${release}:${generation}`;
  const gate = await env.RUNNER_CONTROL.getByName("runner-control").fetch(
    new Request("https://runner-control.internal/gate", {
      method: "POST",
      body: JSON.stringify({ generation, release }),
    }),
  );
  if (gate.status !== 200) {
    await gate.body?.cancel();
    return null;
  }
  const allowed = await gate.json();
  return allowed.generation === generation &&
    allowed.release === release &&
    allowed.bindings === env.SERVICES_BINDINGS &&
    allowed.runner === runner
    ? runner
    : null;
}

export class RunnerService extends DurableObject {
  children(runner) {
    return Array.from({ length: JUDGING_DEFAULTS.slots }, (_, index) => `${runner}:slot:${index}`);
  }
  command(path) {
    return new Request(`https://runner.internal/internal/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.env.QUOREM_RUNNER_DRAIN_SECRET}` },
    });
  }
  async wakeChildren(runner) {
    if (!(await this.ctx.storage.get("shards-started")))
      await this.ctx.storage.put("shards-started", true);
    const children = this.children(runner);
    for (let start = 0; start < children.length; start += 3)
      await Promise.all(
        children.slice(start, start + 3).map(async (name) => {
          const response = await this.env.RUNNERS.getByName(name, { locationHint: "enam" }).fetch(
            this.command("wake"),
          );
          await response.body?.cancel();
          if (response.status !== 204) throw new Error("Runner slot wake unavailable");
        }),
      );
  }
  async haltParent(parent) {
    const response = await parent.fetch(this.command("slot-failed"));
    await response.body?.cancel();
    if (response.status !== 204) throw new Error("Runner failure propagation unavailable");
  }
  async queueState(signal) {
    const command = async (operation) => {
      const response = await fetch(
        new URL(`/internal/runner/${operation}`, this.env.QUOREM_RUNNER_COMMAND_ORIGIN),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.env.QUOREM_RUNNER_COMMAND_SECRET}`,
            "content-type": "application/json",
          },
          body: "{}",
          redirect: "manual",
          signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Runner queue state unavailable");
      }
      return readControlJson(response, 2048);
    };
    const state = await command("state");
    if (
      !state ||
      !Number.isSafeInteger(state.queued) ||
      state.queued < 0 ||
      !Number.isSafeInteger(state.running) ||
      state.running < 0
    )
      throw new Error("Invalid runner queue state");
    const empty = state.queued === 0 && state.running === 0 ? await command("empty") : false;
    if (typeof empty !== "boolean") throw new Error("Invalid runner empty confirmation");
    return Response.json(state, { status: empty ? 200 : 202 });
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method !== "POST") return new Response(null, { status: 404 });
    if (path === "/internal/pause") {
      await this.ctx.storage.put("recovery-paused", true);
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    }
    if (
      ![
        "/internal/drain",
        "/internal/wake",
        "/internal/profile",
        "/internal/slot-gate",
        "/internal/slot-failed",
      ].includes(path)
    )
      return new Response(null, { status: 404 });
    if (request.headers.get("authorization") !== `Bearer ${this.env.QUOREM_RUNNER_DRAIN_SECRET}`)
      return new Response(null, { status: 401 });
    if (path === "/internal/profile") {
      if (!(await this.ctx.storage.get("shards-started")))
        return Response.json((await this.ctx.storage.get("last-profile")) ?? null);
      const runner = `runner:${this.env.SERVICES_RELEASE}:${this.env.SERVICES_GENERATION}`;
      const profiles = [];
      for (const name of this.children(runner)) {
        const response = await this.env.RUNNERS.getByName(name).fetch(this.command("profile"));
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("Runner profile unavailable");
        }
        const profile = await response.json();
        if (profile) profiles.push(profile);
      }
      return Response.json({ shards: profiles });
    }
    if (path === "/internal/slot-failed") {
      await this.ctx.storage.put("teardown-failed", true);
      return new Response(null, { status: 204 });
    }
    if (
      (await this.ctx.storage.get("recovery-paused")) ||
      (await this.ctx.storage.get("teardown-failed"))
    )
      return new Response(null, { status: 503, headers: { "cache-control": "no-store" } });
    if (this.teardownFailure) return new Response(null, { status: 503 });
    if (path === "/internal/slot-gate") return new Response(null, { status: 204 });
    try {
      const response = path === "/internal/wake" ? null : await this.queueState(request.signal);
      // An empty authoritative queue needs no slot fanout; future admissions retain their own wake.
      if (!response || response.status === 202) {
        const pending = await this.ctx.storage.getAlarm();
        if (pending === null || pending > Date.now()) await this.ctx.storage.setAlarm(Date.now());
        const root = `runner:${this.env.SERVICES_RELEASE}:${this.env.SERVICES_GENERATION}`;
        if (
          path === "/internal/wake" &&
          this.ctx.id.toString() === this.env.RUNNERS.idFromName(root).toString()
        ) {
          const runner = await activeRunner(this.env);
          if (runner !== root) throw new Error("Runner wake gate unavailable");
          // Arm independent slot invocations now; the parent alarm recovers interrupted fanout.
          await this.wakeChildren(runner);
        }
      }
      return response ?? new Response(null, { status: 204 });
    } catch {
      return new Response(null, { status: 503 });
    }
  }

  async alarm() {
    const runner = await activeRunner(this.env);
    const own = this.ctx.id.toString();
    const root = runner && this.env.RUNNERS.idFromName(runner).toString() === own;
    const slot =
      runner &&
      this.children(runner).some((name) => this.env.RUNNERS.idFromName(name).toString() === own);
    if (!runner || (!root && !slot) || (await this.ctx.storage.get("recovery-paused"))) return;
    const failed = this.teardownFailure || (await this.ctx.storage.get("teardown-failed"));
    if (root) {
      if (!failed) await this.wakeChildren(runner);
      return;
    }
    const parent = this.env.RUNNERS.getByName(runner);
    if (failed) return this.haltParent(parent);
    const gate = await parent.fetch(this.command("slot-gate"));
    await gate.body?.cancel();
    if (gate.status !== 204) return;
    // An alarm is an independent top-level invocation; one user gets its own I/O budget.
    const response = await this.drain(AbortSignal.timeout(210000), true);
    const pending = response.status === 202 ? await response.json() : null;
    if (!pending) await response.body?.cancel();
    if (this.teardownFailure) {
      await this.haltParent(parent);
    }
    if (!response.ok) throw new Error("Runner wake drain failed");
    // The durable queue retains global running-work recovery; an idle slot need not poll its peers.
    if (pending?.queued > 0) await this.ctx.storage.setAlarm(Date.now() + 1);
  }

  async drain(signal, singleAttempt = false) {
    if (this.draining) return Response.json({ queued: 0, running: 0 }, { status: 202 });
    this.draining = true;
    try {
      const response = await fetch(
        new URL("/internal/runner/drain", this.env.QUOREM_RUNNER_COMMAND_ORIGIN),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.env.QUOREM_RUNNER_COMMAND_SECRET}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: this.env.QUOREM_CASE_ORIGIN,
            secret: this.env.QUOREM_CASE_SECRET,
            namespaceId: this.env.QUOREM_CASE_NAMESPACE_ID,
            ownerPublicKey: this.env.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM,
            ...(singleAttempt ? { singleAttempt: true } : {}),
          }),
          redirect: "manual",
          signal,
        },
      );
      if (
        response.status === 503 &&
        response.headers.get("content-type")?.includes("application/json")
      ) {
        const value = await readControlJson(response.clone(), 2048).catch(() => null);
        if (value?.failure?.kind === "teardown") {
          this.teardownFailure = true;
          await this.ctx.storage.put("teardown-failed", true);
        }
      }
      const profile = response.headers.get("x-quorem-judging-profile");
      if (profile && profile.length <= 16384) {
        const value = JSON.parse(profile);
        if (value.metrics?.["sandbox.runCase"]?.calls > 0)
          await this.ctx.storage.put("last-profile", value);
      }
      return response;
    } finally {
      this.draining = false;
    }
  }
}
export class ImageService extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const values = {
      IMAGE_SERVICE_TRANSPORT: "cloudflare-container",
      IMAGE_SERVICE_HOST: "0.0.0.0",
      IMAGE_SERVICE_PORT: "8083",
      IMAGE_SERVICE_TOKEN: env.IMAGE_SERVICE_TOKEN,
    };
    this.lifecycle = new ContainerLifecycle(ctx, values, 8083, 60000, 120000, undefined, {
      authorization: `Bearer ${env.IMAGE_SERVICE_TOKEN}`,
    });
  }
  fetch(request) {
    return this.lifecycle.forward(cleanImage(request), 15000);
  }
}
/** SMTP credentials stay in the trusted relay container. */
export class MailRelayService extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.lifecycle = new ContainerLifecycle(
      ctx,
      {
        MAIL_RELAY_TOKEN: env.MAIL_RELAY_TOKEN,
        AUTH_EMAIL_FROM: env.AUTH_EMAIL_FROM,
        SMTP_HOST: env.SMTP_HOST,
        SMTP_PORT: env.SMTP_PORT,
        SMTP_USERNAME: env.SMTP_USERNAME,
        SMTP_PASSWORD: env.SMTP_PASSWORD,
        APP_ENV: "production",
        MAIL_RELAY_LISTEN: "0.0.0.0:8092",
      },
      8092,
      60000,
      120000,
    );
  }
  fetch(request) {
    const target =
      new URL(request.url).pathname === "/internal/mail/health"
        ? new Request("https://mail.internal/health", { headers: request.headers })
        : clean(request);
    return this.lifecycle.forward(target, 30000);
  }
}
const ingress = {
  async fetch(request, env, ctx) {
    const receivedAt = Date.now();
    try {
      const [drain, , cases, image] = config(env),
        url = new URL(request.url);
      if (
        env.MAIL_RELAY_ENABLED === "true" &&
        url.origin === env.MAIL_RELAY_ORIGIN &&
        ["/internal/mail/send", "/internal/mail/health"].includes(url.pathname) &&
        !url.search &&
        !url.hash &&
        ((url.pathname === "/internal/mail/send" && request.method === "POST") ||
          (url.pathname === "/internal/mail/health" && request.method === "GET")) &&
        request.headers.get("authorization") === `Bearer ${env.MAIL_RELAY_TOKEN}`
      )
        return env.MAIL.getByName("mail").fetch(clean(request));
      if (url.hash) return new Response(null, { status: 404 });
      const caseControl =
        url.origin === cases &&
        url.pathname.match(
          /^\/internal\/control\/case\/(initialize|activate|pause|state|inventory)$/,
        )?.[1];
      const runnerControl =
        url.origin === drain &&
        url.pathname.match(
          /^\/internal\/control\/runner\/(prepare|activate|pause|state|history)$/,
        )?.[1];
      if (caseControl || runnerControl) {
        const operation = caseControl || runnerControl;
        const reading = ["state", "inventory", "history"].includes(operation);
        if (
          request.headers.get("authorization") !== `Bearer ${env.RECOVERY_CONTROL_SECRET}` ||
          request.method !== (reading ? "GET" : "POST")
        )
          return new Response(null, { status: 404 });
        const bound = await caseScope(env);
        if (bound.namespace !== env.QUOREM_CASE_NAMESPACE_ID || bound.namespace === "0".repeat(64))
          return new Response(null, { status: 503 });
        if (
          (caseControl || (runnerControl && operation === "state")) &&
          (request.headers.get("x-quorem-owner-scope") !== bound.controlScope ||
            !/^[a-f0-9-]{36}$/.test(request.headers.get("x-quorem-owner-nonce") ?? ""))
        )
          return new Response(null, { status: 404 });
        const target = new URL(
          `https://${caseControl ? "case" : "runner"}-control.internal/${operation}`,
        );
        target.search = url.search;
        const control = caseControl
          ? env.CASE_CONTROL.getByName("case-control")
          : env.RUNNER_CONTROL.getByName("runner-control");
        const response = await control.fetch(await controlRequest(request, target));
        if (runnerControl && operation === "state") {
          if (response.status !== 200) {
            await response.body?.cancel();
            return new Response(null, { status: 503 });
          }
          const value = await readControlJson(response, 1024);
          if (!validRunnerControlState(value)) return new Response(null, { status: 503 });
          return await signedCaseProbe(env, {
            kind: "runner-control-state",
            scope: bound.controlScope,
            attempt: "runner-control",
            nonce: request.headers.get("x-quorem-owner-nonce"),
            value,
          });
        }
        return response;
      }
      if (url.search) return new Response(null, { status: 404 });
      if (
        image &&
        url.origin === image &&
        url.pathname === "/" &&
        request.method === "POST" &&
        request.headers.get("authorization") === `Bearer ${env.IMAGE_SERVICE_TOKEN}`
      )
        return env.IMAGES.getByName("image").fetch(cleanImage(request));
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
      const directWake =
        url.origin === "https://runner-wake.internal" && url.pathname === "/internal/wake";
      if (
        (directWake ||
          (url.origin === drain &&
            ["/internal/drain", "/internal/pause", "/internal/profile"].includes(url.pathname))) &&
        request.method === "POST" &&
        request.headers.get("authorization") === `Bearer ${env.QUOREM_RUNNER_DRAIN_SECRET}`
      ) {
        if (url.pathname === "/internal/pause") {
          if (
            env.CASES.idFromName("quorem-sandbox-namespace-v1").toString() !==
            env.QUOREM_CASE_NAMESPACE_ID
          )
            return new Response(null, { status: 503 });
          const runner = `runner:${env.SERVICES_RELEASE}:${env.SERVICES_GENERATION}`;
          return env.RUNNERS.getByName(runner).fetch(clean(request));
        }
        // The alarm rechecks the gate when it runs, including after a release changes.
        const runner = directWake
          ? `runner:${env.SERVICES_RELEASE}:${env.SERVICES_GENERATION}`
          : await activeRunner(env);
        if (!runner) return new Response(null, { status: 503 });
        return env.RUNNERS.getByName(runner).fetch(clean(request));
      }
      const attempt =
        url.origin === cases &&
        url.pathname.match(/^\/internal\/case\/([a-zA-Z0-9-]{1,128})$/)?.[1];
      if (attempt) {
        if (
          request.method === "GET" &&
          attempt !== "ready" &&
          (env.CASE_DIAGNOSTICS !== "true" ||
            !["lifecycle", "diagnostics"].includes(request.headers.get("x-quorem-case-probe")) ||
            !request.headers.get("x-quorem-owner-nonce") ||
            !request.headers.get("x-quorem-owner-scope"))
        )
          return new Response(null, { status: 404 });
        if (
          request.method !== "GET" &&
          (!request.headers.get("x-quorem-owner-nonce") ||
            !request.headers.get("x-quorem-owner-scope"))
        )
          return new Response(null, { status: 404 });
        if (
          request.method === "POST" ||
          request.method === "DELETE" ||
          (request.method === "GET" &&
            ["lifecycle", "diagnostics"].includes(request.headers.get("x-quorem-case-probe")))
        ) {
          if (request.method === "GET" && request.headers.has("x-case-token"))
            return new Response(null, { status: 404 });
          const bound = await caseScope(env);
          if (
            bound.namespace === "0".repeat(64) ||
            bound.namespace !== env.QUOREM_CASE_NAMESPACE_ID ||
            request.headers.get("x-quorem-owner-scope") !== bound.scope
          )
            return new Response(null, { status: request.method === "GET" ? 404 : 503 });
        }
        let beforeDelegate;
        if (request.method === "POST") {
          if (request.headers.get("authorization") !== `Bearer ${env.QUOREM_CASE_SECRET}`)
            return new Response(null, { status: 404 });
          beforeDelegate = async (signal) => {
            const registered = await env.CASE_CONTROL.getByName("case-control").fetch(
              new Request("https://case-control.internal/register", {
                method: "POST",
                signal,
                body: JSON.stringify({
                  attempt,
                  generation: Number(env.SERVICES_GENERATION),
                  release: env.SERVICES_RELEASE,
                }),
              }),
            );
            await registered.body?.cancel();
            if (registered.status !== 204) throw new Error("Case admission unavailable");
          };
        }
        const response = await caseRequest(request, env, attempt, env.QUOREM_CASE_SECRET, {
          beforeDelegate,
          waitUntil: ctx ? (work) => ctx.waitUntil(work) : undefined,
        });
        const headers = new Headers(response.headers);
        headers.set("x-quorem-case-received-at", String(receivedAt));
        return new Response(response.body, { status: response.status, headers });
      }
      return new Response(null, { status: 404 });
    } catch {
      return new Response(null, { status: 503 });
    }
  },
};

export default ingress;
