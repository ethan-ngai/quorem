/** Capture an existing production session and verify it through the native Worker. */
import { hostedAcceptance, json } from "./hono-stage-deploy-acceptance.mjs";
import {
  acceptedSource,
  version,
} from "../apps/api/src/runtime/composition/fixtures/staged-actor.ts";

const site = "https://quorem.app";
const runner = "https://runner-hono.quorem.app";
const request = (send, url, init = {}) =>
  send(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30000) });
function trustedOrigin(value) {
  if (value !== site && value !== runner) throw new Error("Invalid production origin");
  return value;
}
function cookieValue(headers) {
  const values = headers.getSetCookie?.();
  if (!Array.isArray(values)) throw new Error("Session cookie unavailable");
  const matches = values
    .map((v) => v.split(";", 1)[0])
    .filter((v) => /^(?:__Secure-)?better-auth\.session_token=/.test(v));
  if (
    matches.length !== 1 ||
    matches[0].length > 16384 ||
    /[\s\r\n,]/.test(matches[0]) ||
    matches[0].endsWith("=")
  )
    throw new Error("Invalid session cookie");
  return matches[0];
}
/** Returns the session cookie only to the caller; never print it. */
export async function captureProductionSession(env, send = fetch) {
  if (!env.AUTH_BOOTSTRAP_USERNAME || !env.AUTH_BOOTSTRAP_PASSWORD)
    throw new Error("Production credentials required");
  const response = await request(send, `${site}/api/auth/sign-in/username`, {
    method: "POST",
    headers: { origin: site, "content-type": "application/json" },
    body: JSON.stringify({
      username: env.AUTH_BOOTSTRAP_USERNAME,
      password: env.AUTH_BOOTSTRAP_PASSWORD,
    }),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error("Production sign-in failed");
  }
  const cookie = cookieValue(response.headers);
  await response.body?.cancel();
  return cookie;
}

/** Verify the original session and queue-backed judge after cutover. */
export async function verifyProduction(env, sessionCookie, send = fetch, delay) {
  if (
    typeof sessionCookie !== "string" ||
    !/^(?:__Secure-)?better-auth\.session_token=[^\s;,]+$/.test(sessionCookie) ||
    sessionCookie.length > 16384
  )
    throw new Error("Invalid production session");
  const config = await request(send, `${site}/api/auth/quorem-config`);
  if (config.status !== 200) throw new Error("Production auth config unavailable");
  const auth = await json(config);
  if (
    auth.method !== "password" ||
    auth.passkey !== true ||
    auth.registration !== true ||
    !Array.isArray(auth.providers) ||
    !auth.providers.includes("google") ||
    !auth.providers.includes("github")
  )
    throw new Error("Production auth config changed");
  const catalog = await request(send, `${site}/v1/problems`);
  if (catalog.status !== 200 || !Array.isArray((await json(catalog)).items))
    throw new Error("Production catalog unavailable");
  for (const [base, path] of [
    [site, "/internal/runner/claim"],
    [site, "/internal/verification/frozen"],
    [runner, "/internal/drain"],
  ]) {
    for (const authorization of [undefined, "Bearer invalid-production-probe"]) {
      const response = await request(send, `${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: "{}",
      });
      await response.body?.cancel();
      if (![401, 403].includes(response.status))
        throw new Error("Private endpoint did not deny credentials");
    }
  }
  return hostedAcceptance(
    {
      HONO_STAGE_API_ORIGIN: site,
      HONO_STAGE_BROWSER_ORIGIN: site,
      HONO_DRAIN_ORIGIN: runner,
      ALLOWED_ORIGINS: site,
      HONO_STAGE_PROBLEM_VERSION_ID: version,
      HONO_STAGE_SESSION_COOKIE: sessionCookie,
      HONO_STAGE_ACCEPT_SOURCE: acceptedSource,
      HONO_STAGE_ACCEPTANCE_MODE: "queue",
      EXECUTION_DRAIN_SECRET: env.EXECUTION_DRAIN_SECRET,
    },
    send,
    delay,
    trustedOrigin,
    (result) => {
      if (
        result.score?.total !== 20 ||
        result.score?.passed !== 20 ||
        !Array.isArray(result.publicCases) ||
        result.publicCases.length !== 3 ||
        !Array.isArray(result.hiddenCases) ||
        result.hiddenCases.length !== 20
      )
        throw new Error("Production case coverage mismatch");
    },
  );
}
