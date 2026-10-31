/** Compare authenticated controls against missing and incorrect bearer credentials. */
import { randomUUID } from "node:crypto";
import { probeNamespace } from "../deploy/hono/services/probe.mjs";
import { profileProbePNG } from "./hono-stage-deploy-profile.mjs";

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
  if (env.PROFILE_MEDIA_ENABLED === "true") {
    const image = new URL(env.PROFILE_IMAGE_SERVICE_URL);
    if (
      image.protocol !== "https:" ||
      image.origin !== env.PROFILE_IMAGE_SERVICE_URL ||
      !/(^|-)stag(e|ing)(-|$)/.test(image.hostname.split(".")[0])
    )
      throw new Error("Invalid staged image origin");
    origins.push(image.origin);
  }
  if (new Set(origins).size !== origins.length)
    throw new Error("Distinct staged ingress origins required");
  const signed = await probe(env, send);
  if (signed.namespace !== expectedNamespace) throw new Error("Namespace changed");
  async function denyWithoutBearer(url, request) {
    // Positive controls distinguish concealed private paths from routes that do not exist.
    for (const authorization of [undefined, `Bearer ${randomUUID()}`]) {
      const headers = new Headers(request.headers);
      if (authorization) headers.set("authorization", authorization);
      else headers.delete("authorization");
      const response = await send(url, { ...request, headers, signal: AbortSignal.timeout(30000) });
      if (![401, 403, 404].includes(response.status))
        throw new Error("Private ingress accepts invalid credentials");
      await response.body?.cancel();
    }
  }
  const cases = {
    headers: {
      authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
      "x-quorem-owner-nonce": randomUUID(),
    },
    redirect: "error",
  };
  if (
    typeof env.QUOREM_CASE_SECRET !== "string" ||
    env.QUOREM_CASE_SECRET.length < 32 ||
    /\s/.test(env.QUOREM_CASE_SECRET)
  )
    throw new Error("Invalid case credentials");
  await denyWithoutBearer(`${origins[0]}/internal/case/namespace`, cases);
  const checks = [
    {
      origin: origins[1],
      path: "/internal/results/verify",
      bearer: env.VERIFICATION_SERVICE_CREDENTIAL,
      body: { challenge: randomUUID() },
      expected: 503,
    },
    {
      origin: origins[2],
      path: "/internal/verification/frozen",
      bearer: env.VERIFICATION_SOURCE_CREDENTIAL,
      body: { challenge: randomUUID() },
      expected: 503,
    },
    {
      origin: origins[3],
      path: "/internal/drain",
      bearer: env.EXECUTION_DRAIN_SECRET,
      expected: 200,
    },
  ];
  if (env.PROFILE_MEDIA_ENABLED === "true")
    checks.push({
      origin: origins[4],
      path: "/",
      bearer: env.PROFILE_IMAGE_SERVICE_TOKEN,
      image: true,
      expected: 200,
    });
  for (const check of checks) {
    if (typeof check.bearer !== "string" || check.bearer.length < 32 || /\s/.test(check.bearer))
      throw new Error("Invalid ingress credentials");
    const request = {
      method: "POST",
      headers: {
        authorization: `Bearer ${check.bearer}`,
        "content-type": check.image ? "image/png" : "application/json",
        ...(check.image ? { "x-image-format": "png" } : {}),
      },
      ...(check.image
        ? { body: profileProbePNG }
        : check.body
          ? { body: JSON.stringify(check.body) }
          : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    };
    const url = `${check.origin}${check.path}`;
    const control = await send(url, request);
    if (
      control.status !== check.expected ||
      (check.image && control.headers.get("x-image-execution") !== "terminated")
    )
      throw new Error("Authenticated ingress control failed");
    await control.body?.cancel();
    await denyWithoutBearer(url, request);
  }
}
