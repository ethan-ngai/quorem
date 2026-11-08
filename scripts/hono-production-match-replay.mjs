/** @file hono-production-match-replay.mjs @description Replay one published suite in a disposable two-account match. @module deployment */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { createProductionBenchmarkActors } from "./hono-production-workload-actors.mjs";

const { WebSocket } = createRequire(new URL("../apps/api/package.json", import.meta.url))("ws");

function openMatchSocket(matchId, token, sockets) {
  const socket = new WebSocket(
    `wss://quorem.app/v1/matches/${matchId}/events`,
    ["quorem", `bearer.${token}`],
    { origin: "https://quorem.app", handshakeTimeout: 10000 },
  );
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Replay socket timed out")), 15000);
    socket.on("message", (raw) => {
      try {
        const { receipt } = JSON.parse(raw.toString());
        if (!/^[a-f0-9-]{36}$/i.test(receipt ?? "")) throw new Error("Invalid replay receipt");
        socket.send(JSON.stringify({ type: "receipt", id: receipt }));
        clearTimeout(timeout);
        resolve();
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
    socket.on("error", () => {
      clearTimeout(timeout);
      reject(new Error("Replay socket unavailable"));
    });
    socket.on("close", (code, raw) => {
      clearTimeout(timeout);
      const reason = raw.toString();
      console.log(
        JSON.stringify({ replaySocketClosed: { code, complete: reason === "Complete" } }),
      );
      reject(new Error("Replay socket closed"));
    });
  });
}

export async function replayProductionMatch(database, env, referenceMatchId, readProfile) {
  if (!/^[a-f0-9-]{36}$/i.test(referenceMatchId)) throw new Error("Invalid match identifier");
  const {
    rows: [reference],
  } = await database.query(
    `SELECT v.id, v.signature, v.difficulty, i.case_count, i.sample_count,
            (SELECT solution.source FROM problem_solutions solution
             JOIN problem_solution_approaches approach ON approach.version_id=solution.version_id
               AND approach.id=solution.approach_id
             WHERE solution.version_id=v.id AND solution.language='python'
             ORDER BY approach.is_canonical DESC, approach.ordinal LIMIT 1) AS reference_source
     FROM matches m JOIN problem_versions v ON v.id=m.problem_version_id
     JOIN submissions s ON s.match_id=m.id JOIN execution_jobs j ON j.submission_id=s.id
     JOIN runner_job_inputs i ON i.job_id=j.id
     WHERE m.id=$1::uuid AND s.kind='submit' AND j.language='python' AND s.odyssey_level IS NULL
     ORDER BY s.admitted_at LIMIT 1`,
    [referenceMatchId],
  );
  const { className, methodName } = reference?.signature ?? {};
  if (
    reference?.case_count !== 20 ||
    reference.sample_count !== 3 ||
    !reference.reference_source ||
    !/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(className ?? "") ||
    !/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(methodName ?? "")
  )
    throw new Error("Replay suite does not match the incident");
  const fixture = await createProductionBenchmarkActors({
    databaseURL: env.DATABASE_URL,
    authSecret: env.BETTER_AUTH_SECRET,
    count: 2,
  });
  const site = "https://quorem.app";
  const call = async (path, credentials, body) => {
    const method = body === undefined ? "GET" : "POST";
    const headers = {
      ...credentials,
      origin: site,
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", "idempotency-key": randomUUID() }),
    };
    const route = path.replace(/[a-f0-9-]{36}/gi, ":id");
    for (let retry = 0; ; retry++) {
      const response = await fetch(site + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) return response.status === 204 ? undefined : response.json();
      await response.body?.cancel();
      console.log(
        JSON.stringify({ replayHttpFailure: { method, route, status: response.status, retry } }),
      );
      if (response.status === 503 && retry < 2) {
        await sleep(250 * (retry + 1));
        continue;
      }
      const error = new Error("Replay request failed");
      error.status = response.status;
      throw error;
    }
  };
  const wait = async (read, done, timeout) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const value = await read();
      if (done(value)) return value;
      await sleep(1000);
    }
    throw new Error("Replay observation timed out");
  };
  let partyId, matchId;
  const actors = [];
  const sockets = [];
  try {
    for (const { cookie } of fixture.actors) {
      const { token } = await call("/api/auth/token", { cookie });
      if (typeof token !== "string" || !token || token.length > 16384 || /\s/.test(token))
        throw new Error("Invalid replay credential");
      const headers = { authorization: `Bearer ${token}` };
      const { user } = await call("/v1/session", headers);
      actors.push({ headers, userId: user.id, token });
    }
    const [host, peer] = actors;
    const problem = await call(`/v1/problem-versions/${reference.id}`, host.headers);
    const sample = problem.examples.find((example) => "expected" in example);
    const expected = sample && JSON.stringify(sample.expected);
    if (!expected || expected.length > 2048) throw new Error("Replay example unavailable");
    const source = `import json\nclass ${className}:\n    def ${methodName}(self, *args):\n        return json.loads(${JSON.stringify(expected)})\n`;
    const created = await call("/v1/parties", host.headers, {
      selectedProblemVersionId: reference.id,
      durationMinutes: 15,
      difficulties: [reference.difficulty],
      shareCodeAfterMatch: false,
      mode: "free-for-all",
      accessMode: "accounts_only",
    });
    partyId = created.party.id;
    await call("/v1/parties/join", peer.headers, { token: created.inviteUrl.split("/").at(-1) });
    for (const { headers } of actors)
      await call("/v1/presence/heartbeat", headers, { windowId: randomUUID() });
    for (const { headers } of actors)
      await call(`/v1/parties/${partyId}/ready`, headers, { ready: true });
    const party = await wait(
      () => call(`/v1/parties/${partyId}`, host.headers),
      (value) => !!value.currentMatchId,
      30000,
    );
    matchId = party.currentMatchId;
    const workspaces = await Promise.all(
      actors.map(async ({ headers, userId }) => {
        const snapshot = await wait(
          () => call(`/v1/matches/${matchId}`, headers),
          (value) =>
            value.state === "active" &&
            value.participants.some((person) => person.userId === userId && !!person.workspaceId),
          30000,
        );
        return snapshot.participants.find((person) => person.userId === userId).workspaceId;
      }),
    );
    await Promise.all(actors.map(({ token }) => openMatchSocket(matchId, token, sockets)));
    console.log(JSON.stringify({ replayMatchId: matchId, caseCount: 20, sampleCount: 3 }));
    for (let round = 0; round < 3; round++) {
      const submissions = await Promise.all(
        actors.map(({ headers }, index) =>
          call("/v1/submissions", headers, {
            workspaceId: workspaces[index],
            kind: "submit",
            source: index === 0 ? reference.reference_source : source,
          }),
        ),
      );
      console.log(
        JSON.stringify({ replayRound: round + 1, submissions: submissions.map(({ id }) => id) }),
      );
      let nextProfile = Date.now() + 12000;
      const seenFailures = new Set();
      const attempts = await wait(
        async () => {
          await Promise.allSettled(
            actors.map(({ headers }) => call(`/v1/matches/${matchId}`, headers)),
          );
          const { rows } = await database.query(
            `SELECT s.id, s.state, s.result->>'verdict' AS verdict, j.language, i.case_count, i.sample_count,
                  array_agg(a.attempt_id ORDER BY a.claimed_at)
                    FILTER (WHERE a.attempt_id IS NOT NULL) AS attempts,
                  round(1000 * extract(epoch FROM s.updated_at - s.admitted_at))::int AS elapsed_ms
           FROM submissions s JOIN execution_jobs j ON j.submission_id=s.id
           JOIN runner_job_inputs i ON i.job_id=j.id
           LEFT JOIN execution_attempt_inventory a ON a.job_id=j.id
           WHERE s.id=ANY($1::uuid[]) GROUP BY s.id, j.language, i.case_count, i.sample_count ORDER BY s.id`,
            [submissions.map(({ id }) => id)],
          );
          if (Date.now() >= nextProfile) {
            nextProfile = Date.now() + 5000;
            const profile = await readProfile().catch(() => null);
            const ids = new Set(rows.flatMap((row) => row.attempts ?? []));
            for (const { failures } of profile?.shards ?? []) {
              for (const failure of failures ?? []) {
                const signature = JSON.stringify(failure);
                if (ids.has(failure.attemptId) && !seenFailures.has(signature)) {
                  seenFailures.add(signature);
                  console.log(JSON.stringify({ replayAttemptFailure: failure }));
                }
              }
            }
          }
          return rows;
        },
        (rows) =>
          rows.length === 2 &&
          rows.every(({ state }) => ["completed", "failed", "cancelled"].includes(state)),
        120000,
      );
      console.log(JSON.stringify({ replayRound: round + 1, attempts }));
      if (attempts.some(({ verdict }) => verdict === "accepted")) {
        const outcome = await wait(
          async () =>
            (
              await database.query(
                `SELECT m.state, m.outcome->>'reason' AS reason,
                    round(1000 * extract(epoch FROM m.completed_at - min(s.updated_at)))::int AS settlement_ms
             FROM matches m JOIN submissions s ON s.match_id=m.id
             WHERE m.id=$1::uuid AND s.result->>'verdict'='accepted' GROUP BY m.id`,
                [matchId],
              )
            ).rows[0],
          (row) => row?.state === "completed",
          20000,
        );
        console.log(JSON.stringify({ replayOutcome: outcome }));
      }

      if (
        attempts.some(
          (row) =>
            row.state !== "completed" || row.attempts?.length !== 1 || row.verdict === "accepted",
        )
      )
        break;
      if (round < 2) await sleep(10000);
    }
  } finally {
    try {
      if (matchId) {
        for (const { headers } of actors)
          await call(`/v1/matches/${matchId}/forfeit`, headers, {}).catch(() => {});
      }
      if (partyId)
        await call(`/v1/parties/${partyId}/disband`, actors[0].headers, {}).catch(() => {});
    } finally {
      for (const socket of sockets) socket.terminate();
      await fixture.dispose();
    }
  }
}
