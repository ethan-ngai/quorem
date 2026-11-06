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
  const samples = [],
    errors = [];
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
            error.stage =
              path === "/v1/submissions"
                ? "admission"
                : path.endsWith("/events")
                  ? "events"
                  : "snapshot";
            throw error;
          }
          return response;
        };
        const start = performance.now();
        let stage = "admission";
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
          stage = "events";
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
          const eventsOpened = performance.now();
          let sample,
            snapshotCount = 0,
            snapshotMs = 0;
          try {
            await readSubmissionEvents(stream.body, async () => {
              stage = "snapshot";
              const snapshotStart = performance.now();
              const result = await (
                await call(`/v1/submissions/${encodeURIComponent(id)}`, {}, 200)
              ).json();
              const terminalSnapshotMs = Math.round(performance.now() - snapshotStart);
              snapshotCount++;
              snapshotMs += terminalSnapshotMs;
              if (["failed", "cancelled"].includes(result.state)) {
                stage = "execution";
                throw new Error("Benchmark execution failed");
              }
              if (!result.verdict) return;
              if (result.verdict !== "accepted" || result.publicCases?.length !== cases.length)
                throw new Error("Unexpected benchmark verdict");
              sample = {
                actor: index,
                round,
                caseCount: cases.length,
                admissionMs: Math.round(admitted - start),
                eventsMs: Math.round(eventsOpened - admitted),
                snapshotCount,
                snapshotMs,
                terminalSnapshotMs,
                resultAgeMs: Number.isFinite(Date.parse(result.updatedAt))
                  ? Math.max(0, Date.now() - Date.parse(result.updatedAt))
                  : undefined,
                totalMs: Math.round(performance.now() - start),
              };
              throw new Completed();
            });
          } catch (error) {
            if (!(error instanceof Completed)) throw error;
          }
          if (!sample) throw new Error("Benchmark SSE closed before completion");
          return sample;
        } catch (error) {
          error.workload = {
            actor: index,
            round,
            stage: error.stage ?? stage,
            status: Number.isInteger(error.status) ? error.status : undefined,
            elapsedMs: Math.round(performance.now() - start),
          };
          throw error;
        } finally {
          controller.abort();
        }
      }),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") samples.push(outcome.value);
      else errors.push(outcome.reason?.workload ?? { round, stage: "unknown" });
    }
    if (errors.length) break;
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
    errors,
    p50Ms: durations[Math.floor(durations.length / 2)] ?? null,
    maxMs: durations.at(-1) ?? null,
    meetsTarget:
      errors.length === 0 &&
      samples.length === actors.length * rounds &&
      durations.every((value) => value < targetMs),
  };
}
