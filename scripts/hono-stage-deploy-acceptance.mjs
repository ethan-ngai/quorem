/** Exercise a real staged submission through the deployed Worker and drain. */
import { randomUUID } from "node:crypto";

export function stagedOrigin(value) {
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
export async function json(response) {
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

export async function hostedAcceptance(
  env,
  send = fetch,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const api = stagedOrigin(env.HONO_STAGE_API_ORIGIN),
    drain = stagedOrigin(env.HONO_DRAIN_ORIGIN),
    browser = stagedOrigin(env.HONO_STAGE_BROWSER_ORIGIN);
  if (
    api === drain ||
    !env.ALLOWED_ORIGINS?.split(",").includes(browser) ||
    !/^[0-9a-f-]{36}$/.test(env.HONO_STAGE_PROBLEM_VERSION_ID ?? "") ||
    !["manual", "queue"].includes(env.HONO_STAGE_ACCEPTANCE_MODE) ||
    !env.HONO_STAGE_SESSION_COOKIE ||
    /[\r\n]/.test(env.HONO_STAGE_SESSION_COOKIE) ||
    !env.HONO_STAGE_ACCEPT_SOURCE ||
    new TextEncoder().encode(env.HONO_STAGE_ACCEPT_SOURCE).length > 65536
  )
    throw new Error("Invalid staged acceptance fixture");
  const token = env.EXECUTION_DRAIN_SECRET;
  if (!token || token.length < 32 || /\s/.test(token))
    throw new Error("Invalid staged drain credentials");
  const headers = { origin: browser, "content-type": "application/json", authorization: "" };
  async function refreshToken() {
    const response = await send(`${api}/api/auth/token`, {
      headers: { cookie: env.HONO_STAGE_SESSION_COOKIE, origin: browser },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (response.status !== 200) throw new Error("Stage token exchange failed");
    const bearer = (await json(response)).token;
    if (typeof bearer !== "string" || !bearer || bearer.length > 16384 || /\s/.test(bearer))
      throw new Error("Invalid stage bearer");
    headers.authorization = `Bearer ${bearer}`;
  }
  await refreshToken();
  const workspaceResponse = await send(`${api}/v1/workspaces`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      problemVersionId: env.HONO_STAGE_PROBLEM_VERSION_ID,
      language: "python",
    }),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (workspaceResponse.status !== 201) throw new Error("Stage workspace creation failed");
  const workspace = (await json(workspaceResponse)).id;
  if (!/^[0-9a-f-]{36}$/.test(workspace ?? "")) throw new Error("Invalid stage workspace");
  const admission = await send(`${api}/v1/submissions`, {
    method: "POST",
    headers: { ...headers, "idempotency-key": `stage-${randomUUID()}` },
    body: JSON.stringify({
      workspaceId: workspace,
      kind: "submit",
      source: env.HONO_STAGE_ACCEPT_SOURCE,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (admission.status !== 202) throw new Error("Stage admission failed");
  const submission = (await json(admission)).id;
  if (!/^[0-9a-f-]{36}$/.test(submission ?? "")) throw new Error("Invalid stage submission");
  const deadline = Date.now() + 600000;
  for (;;) {
    if (env.HONO_STAGE_ACCEPTANCE_MODE === "manual") {
      const drained = await send(`${drain}/internal/drain`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(Math.max(1, Math.min(210000, deadline - Date.now()))),
      });
      if (![200, 202].includes(drained.status)) {
        let diagnostic;
        try {
          const value = await json(drained);
          if (
            value.error === "container-readiness" &&
            [8090, 8091, 8083].includes(value.port) &&
            Number.isInteger(value.probes) &&
            value.probes > 0 &&
            value.probes < 1000 &&
            Number.isInteger(value.status) &&
            value.status >= 0 &&
            value.status <= 599 &&
            [
              "none",
              "http",
              "refused",
              "closed",
              "timeout",
              "stopped",
              "unsupported",
              "transport",
            ].includes(value.failure) &&
            typeof value.running === "boolean"
          ) {
            diagnostic = {
              port: value.port,
              probes: value.probes,
              status: value.status,
              failure: value.failure,
              running: value.running,
            };
          }
          if (
            value.error === "unavailable" &&
            value.command &&
            /^[a-z]{1,20}$/.test(value.command.operation ?? "") &&
            Number.isInteger(value.command.status) &&
            value.command.status >= 0 &&
            value.command.status <= 599 &&
            ["http", "timeout", "transport", "decode"].includes(value.command.failure)
          ) {
            diagnostic = {
              command: {
                operation: value.command.operation,
                status: value.command.status,
                failure: value.command.failure,
              },
            };
          }
          if (
            value.error === "unavailable" &&
            value.failure &&
            ["command", "teardown", "other"].includes(value.failure.kind) &&
            /^[a-f0-9]{64}$/.test(value.failure.fingerprint ?? "")
          ) {
            diagnostic = {
              ...diagnostic,
              failure: {
                kind: value.failure.kind,
                fingerprint: value.failure.fingerprint,
                ...(value.failure.kind === "teardown" && value.failure.teardown
                  ? {
                      teardown: {
                        httpStatus:
                          Number.isInteger(value.failure.teardown.httpStatus) &&
                          value.failure.teardown.httpStatus >= 0 &&
                          value.failure.teardown.httpStatus <= 599
                            ? value.failure.teardown.httpStatus
                            : undefined,
                        signatureValid:
                          typeof value.failure.teardown.signatureValid === "boolean"
                            ? value.failure.teardown.signatureValid
                            : undefined,
                        transport: ["timeout", "error"].includes(value.failure.teardown.transport)
                          ? value.failure.teardown.transport
                          : undefined,
                      },
                    }
                  : {}),
              },
            };
          }
        } catch {
          /* Untrusted response content stays private. */
        }

        const error = new Error("Stage drain failed");
        error.status = drained.status;
        error.diagnostic = diagnostic;
        throw error;
      }
      await drained.body?.cancel();
    }
    let response = await send(`${api}/v1/submissions/${submission}`, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 401) {
      await response.body?.cancel();
      await refreshToken();
      response = await send(`${api}/v1/submissions/${submission}`, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    }
    if (response.status !== 200) {
      const error = new Error("Stage result unavailable");
      error.status = response.status;
      throw error;
    }
    const result = await json(response);
    if (result.verdict === "accepted") return { submission };
    if (result.verdict || Date.now() >= deadline) throw new Error("Stage submission not accepted");
    await delay(1000);
  }
}
