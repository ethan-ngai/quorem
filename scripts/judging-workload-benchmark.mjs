/** Observe authenticated submission-to-terminal latency through SSE and result snapshots. */
import { randomUUID } from "node:crypto";
import { readSubmissionEvents } from "../packages/contracts/src/submission-events.ts";

class Completed extends Error {}
export async function benchmarkJudgingWorkload(
  { origin, actors, cases, source, rounds = 1, targetMs = 5000, timeoutMs = 90000 },
  send = fetch,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const base = new URL(origin);
  if (
    base.protocol !== "https:" &&
    !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
  )
    throw new Error("Invalid benchmark origin");
  if (
    !Array.isArray(actors) ||
    !actors.length ||
    actors.length > 8 ||
    new Set(actors.map((actor) => actor.id)).size !== actors.length ||
    !Array.isArray(cases) ||
    !cases.length ||
    cases.length > 20 ||
    !Number.isInteger(rounds) ||
    rounds < 1 ||
    rounds > 5
  )
    throw new Error("Invalid benchmark workload");
  const samples = [];
  for (let round = 0; round < rounds; round++) {
    const batchStart = performance.now();
    const outcomes = await Promise.allSettled(
      actors.map(async (actor, index) => {
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
        const headers = {
          ...actor.headers,
          origin: base.origin,
          "content-type": "application/json",
        };
        const call = async (path, init, expected) => {
          const response = await send(new URL(path, base), {
            ...init,
            headers: { ...headers, ...init.headers },
            redirect: "error",
            signal,
          });
          if (response.status !== expected) {
            await response.body?.cancel();
            const error = new Error("Unexpected workload response");
            error.status = response.status;
            throw error;
          }
          return response;
        };
        const start = performance.now();
        try {
          const response = await call(
            "/v1/submissions",
            {
              method: "POST",
              headers: { "idempotency-key": randomUUID() },
              body: JSON.stringify({
                kind: "run",
                workspaceId: actor.workspaceId,
                source: actor.source ?? source,
                customCases: cases,
              }),
            },
            202,
          );
          const { id } = await response.json(),
            admitted = performance.now();
          if (typeof id !== "string" || !id) throw new Error("Invalid benchmark submission");
          const stream = await call(
            `/v1/submissions/${encodeURIComponent(id)}/events`,
            { headers: { accept: "text/event-stream" } },
            200,
          );
          if (
            !stream.body ||
            !stream.headers.get("content-type")?.startsWith("text/event-stream")
          ) {
            await stream.body?.cancel();
            throw new Error("Benchmark SSE unavailable");
          }
          let sample;
          try {
            await readSubmissionEvents(stream.body, async () => {
              const result = await (
                await call(`/v1/submissions/${encodeURIComponent(id)}`, {}, 200)
              ).json();
              if (!result.verdict) return;
              if (result.verdict !== "accepted" || result.publicCases?.length !== cases.length)
                throw new Error("Unexpected benchmark verdict");
              sample = {
                actor: index,
                round,
                caseCount: cases.length,
                admissionMs: Math.round(admitted - start),
                totalMs: Math.round(performance.now() - start),
              };
              throw new Completed();
            });
          } catch (error) {
            if (!(error instanceof Completed)) throw error;
          }
          if (!sample) throw new Error("Benchmark SSE closed before completion");
          return sample;
        } finally {
          controller.abort();
        }
      }),
    );
    const failed = outcomes.find((value) => value.status === "rejected");
    if (failed) throw failed.reason;
    samples.push(...outcomes.map((value) => value.value));
    if (round + 1 < rounds) await pause(Math.max(0, 6500 - (performance.now() - batchStart)));
  }
  const durations = samples.map((sample) => sample.totalMs).sort((a, b) => a - b);
  return {
    benchmark: "concurrent-native-sse",
    users: actors.length,
    caseCount: cases.length,
    rounds,
    targetMs,
    samples,
    p50Ms: durations[Math.floor(durations.length / 2)],
    maxMs: durations.at(-1),
    meetsTarget: durations.every((value) => value < targetMs),
  };
}
