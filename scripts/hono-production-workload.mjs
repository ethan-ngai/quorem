/** Measures eight temporary production actors; never prints credentials. */
import { createProductionBenchmarkActors } from "./hono-production-workload-actors.mjs";
import { benchmarkJudgingWorkload } from "./judging-workload-benchmark.mjs";
import {
  acceptedSource,
  version,
} from "../apps/api/src/runtime/composition/fixtures/staged-actor.ts";

export async function benchmarkProductionWorkload(env, send = fetch) {
  const fixture = await createProductionBenchmarkActors({
    databaseURL: env.DATABASE_URL,
    authSecret: env.BETTER_AUTH_SECRET,
  });
  try {
    const actors = [];
    for (const account of fixture.actors) {
      const cookie = account.cookie;
      const tokenResponse = await send("https://quorem.app/api/auth/token", {
        headers: { cookie, origin: "https://quorem.app" },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!tokenResponse.ok) {
        await tokenResponse.body?.cancel();
        throw new Error("Benchmark actor authentication failed");
      }
      const { token } = await tokenResponse.json();
      if (typeof token !== "string" || !token || token.length > 16384 || /\s/.test(token))
        throw new Error("Invalid benchmark actor token");
      const headers = {
        authorization: `Bearer ${token}`,
        origin: "https://quorem.app",
        "content-type": "application/json",
      };
      const response = await send("https://quorem.app/v1/workspaces", {
        method: "POST",
        headers,
        body: JSON.stringify({ problemVersionId: version, language: "python" }),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (response.status !== 201) {
        await response.body?.cancel();
        throw new Error("Benchmark actor workspace unavailable");
      }
      const { id } = await response.json();
      actors.push({ id: account.id, workspaceId: id, headers });
    }
    const count = Number(env.JUDGING_BENCHMARK_CASES ?? 20);
    if (![1, 5, 20].includes(count)) throw new Error("Invalid benchmark case count");
    return await benchmarkJudgingWorkload(
      {
        origin: "https://quorem.app",
        actors,
        cases: Array.from({ length: count }, (_, index) => ({
          args: [[...Array.from({ length: (index % 4) + 1 }, () => index + 1), index + 2]],
          expected: [(index % 4) + 1, 1],
        })),
        source: acceptedSource,
        rounds: 2,
      },
      send,
    );
  } finally {
    await fixture.dispose();
  }
}
if (import.meta.main) {
  try {
    const result = await benchmarkProductionWorkload(process.env);
    console.log(JSON.stringify(result));
    if (!result.meetsTarget) process.exitCode = 1;
  } catch (error) {
    console.error(
      JSON.stringify({
        error: "judging-workload-failed",
        reason: error?.message,
        status: error?.status,
      }),
    );
    process.exitCode = 1;
  }
}
