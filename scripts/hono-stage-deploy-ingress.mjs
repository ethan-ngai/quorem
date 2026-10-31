/** Compare authenticated controls with identical requests lacking Access credentials. */
import { randomUUID } from "node:crypto";
import { accessFetch } from "../packages/execution/src/transport/access.ts";
import { probeNamespace } from "../deploy/hono/services/probe.mjs";

export async function verifyPrivateIngress(
  env,
  expectedNamespace,
  send = fetch,
  probe = probeNamespace,
) {
  if (!/^[a-f0-9]{64}$/.test(expectedNamespace ?? "") || expectedNamespace === "0".repeat(64))
    throw new Error("A verified namespace is required");
  const origins = [
    env.QUOREM_CASE_ORIGIN,
    env.VERIFICATION_SERVICE_ORIGIN,
    env.HONO_STAGE_API_ORIGIN,
    env.HONO_DRAIN_ORIGIN,
  ];
  for (const origin of origins) {
    const u = new URL(origin);
    if (
      u.protocol !== "https:" ||
      u.origin !== origin ||
      !/(^|-)stag(e|ing)(-|$)/.test(u.hostname.split(".")[0])
    )
      throw new Error("Invalid staged ingress origin");
  }
  if (new Set(origins).size !== origins.length)
    throw new Error("Distinct staged ingress origins required");
  const signed = await probe(env, send);
  if (signed.namespace !== expectedNamespace) throw new Error("Namespace changed");
  const nonce = randomUUID();
  const cases = await send(`${origins[0]}/internal/case/namespace`, {
    headers: { authorization: `Bearer ${env.QUOREM_CASE_SECRET}`, "x-quorem-owner-nonce": nonce },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (![401, 403].includes(cases.status))
    throw new Error("Case ingress permits access without Access");
  await cases.body?.cancel();
  const checks = [
    {
      origin: origins[1],
      path: "/internal/results/verify",
      bearer: env.VERIFICATION_SERVICE_CREDENTIAL,
      id: env.VERIFICATION_ACCESS_CLIENT_ID,
      secret: env.VERIFICATION_ACCESS_CLIENT_SECRET,
      body: { challenge: randomUUID() },
      expected: 503,
    },
    {
      origin: origins[2],
      path: "/internal/verification/frozen",
      bearer: env.VERIFICATION_SOURCE_CREDENTIAL,
      id: env.CLOUDFLARE_ACCESS_CLIENT_ID,
      secret: env.CLOUDFLARE_ACCESS_CLIENT_SECRET,
      body: { challenge: randomUUID() },
      expected: 503,
    },
    {
      origin: origins[3],
      path: "/internal/drain",
      bearer: env.EXECUTION_DRAIN_SECRET,
      id: env.EXECUTION_DRAIN_ACCESS_CLIENT_ID,
      secret: env.EXECUTION_DRAIN_ACCESS_CLIENT_SECRET,
      body: undefined,
      expected: 200,
    },
  ];
  for (const check of checks) {
    if (
      !check.bearer ||
      !check.id ||
      !check.secret ||
      /\s/.test(check.bearer + check.id + check.secret)
    )
      throw new Error("Invalid ingress credentials");
    const request = {
      method: "POST",
      headers: { authorization: `Bearer ${check.bearer}`, "content-type": "application/json" },
      ...(check.body ? { body: JSON.stringify(check.body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    };
    const control = await accessFetch(
      check.origin,
      { id: check.id, secret: check.secret },
      send,
    )(`${check.origin}${check.path}`, request);
    if (control.status !== check.expected) throw new Error("Authenticated ingress control failed");
    await control.body?.cancel();
    const negative = await send(`${check.origin}${check.path}`, {
      ...request,
      signal: AbortSignal.timeout(30000),
    });
    if (![401, 403].includes(negative.status))
      throw new Error("Private ingress permits access without Access");
    await negative.body?.cancel();
  }
}
