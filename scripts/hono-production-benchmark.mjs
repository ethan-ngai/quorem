/** Time real queue-backed Python Runs, each with one freshly started sandbox. */
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  acceptedSource,
  version,
} from "../apps/api/src/runtime/composition/fixtures/staged-actor.ts";
import { json } from "./hono-stage-deploy-acceptance.mjs";
import { createProductionBenchmarkActors } from "./hono-production-workload-actors.mjs";

export async function benchmarkProductionPython(
  env,
  send = fetch,
  delay = sleep,
  createActors = createProductionBenchmarkActors,
) {
  const fixture = await createActors({
    databaseURL: env.DATABASE_URL,
    authSecret: env.BETTER_AUTH_SECRET,
    count: 1,
  });
  try {
    const site = "https://quorem.app";
    const colos = new Set();
    const call = async (path, status, headers, body) => {
      const result = await send(site + path, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      const colo = result.headers.get("cf-ray")?.split("-").at(-1);
      if (colo && /^[A-Z]{3}$/.test(colo)) colos.add(colo);
      if (result.status !== status) {
        await result.body?.cancel();
        const error = new Error("Unexpected benchmark response");
        error.status = result.status;
        throw error;
      }
      return json(result);
    };
    const session = fixture.actors[0].cookie;
    const common = { origin: site, "content-type": "application/json" };
    const { token } = await call("/api/auth/token", 200, { ...common, cookie: session });
    if (typeof token !== "string" || !token || token.length > 16384 || /\s/.test(token))
      throw new Error("Invalid benchmark token");
    const headers = { ...common, authorization: `Bearer ${token}` };
    const { id: workspaceId } = await call("/v1/workspaces", 201, headers, {
      problemVersionId: version,
      language: "python",
    });
    const samples = [];
    for (let index = 0; index < 5; index++) {
      const start = performance.now();
      const { id } = await call(
        "/v1/submissions",
        202,
        { ...headers, "idempotency-key": randomUUID() },
        {
          kind: "run",
          workspaceId,
          source: acceptedSource,
          customCases: [{ args: [[1, 1, 2]], expected: [2, 1] }],
        },
      );
      const admitted = performance.now();
      for (;;) {
        const result = await call(`/v1/submissions/${id}`, 200, headers);
        if (result.verdict) {
          if (result.verdict !== "accepted" || result.publicCases?.length !== 1)
            throw new Error("Unexpected Python benchmark result");
          samples.push({
            totalMs: Math.round(performance.now() - start),
            admissionMs: Math.round(admitted - start),
          });
          break;
        }
        if (performance.now() - start >= 90000) throw new Error("Python benchmark timed out");
        await delay(250);
      }
      if (index < 4) await delay(Math.max(0, 6500 - (performance.now() - start)));
    }
    const sorted = samples.map((sample) => sample.totalMs).sort((a, b) => a - b);
    return {
      benchmark: "python-single-case",
      samples,
      p50Ms: sorted[2],
      maxMs: sorted[4],
      colos: [...colos],
    };
  } finally {
    await fixture.dispose();
  }
}
