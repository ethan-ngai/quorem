import { test } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { startBrowserFixture } from "./browser-fixture.ts";

void test(
  "native fixture runs SQL practice and selected SQL match",
  { timeout: 180000 },
  async () => {
    const database = process.env.QUOREM_BROWSER_FIXTURE_DATABASE_URL,
      socket = process.env.QUOREM_TEST_DOCKER_SOCKET;
    if (!database || !socket) throw new Error("Fixture database and Docker socket required");
    const fixture = await startBrowserFixture(database, socket);
    try {
      const origin = "http://127.0.0.1:5187",
        source = "SELECT id FROM items WHERE id > 0 ORDER BY id;";
      async function json(path: string, token?: string, body?: unknown, method = "POST") {
        const response = await fetch(origin + path, {
          method,
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
            "idempotency-key": randomUUID(),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok)
          throw new Error(
            `${method} ${path.replace(/\/[a-f0-9-]{36}/g, "/:id")} returned ${response.status}`,
          );
        return response.json() as Promise<any>;
      }
      async function result(token: string, workspaceId: string, kind: "run" | "submit") {
        const submission = await json("/v1/submissions", token, { workspaceId, kind, source });
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
          const current = await json(`/v1/submissions/${submission.id}`, token, undefined, "GET");
          if (["completed", "failed", "cancelled"].includes(current.state)) {
            assert.equal(current.state, "completed");
            assert.equal(current.verdict, "accepted");
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error("SQL execution did not complete");
      }
      const { alice, bob } = fixture.bearers;
      const problem = await json("/v1/problems/sql-positive-items", alice, undefined, "GET");
      const workspace = await json("/v1/workspaces", alice, {
        problemVersionId: problem.id,
        language: "postgresql",
      });
      await result(alice, workspace.id, "run");
      await result(alice, workspace.id, "submit");
      const match = await json("/v1/matches", alice, { selectedProblemVersionId: problem.id });
      await json("/v1/matches/join", bob, { inviteToken: match.inviteUrl.split("/").at(-1) });
      await json(`/v1/matches/${match.id}/ready`, alice, { ready: true });
      const ready = await json(`/v1/matches/${match.id}/ready`, bob, { ready: true });
      assert.equal(ready.state, "active");
      const session = await json("/v1/session", bob, undefined, "GET");
      const snapshot = await json(`/v1/matches/${match.id}`, bob, undefined, "GET");
      const own = snapshot.participants.find(
        (participant: { userId: string }) => participant.userId === session.user.id,
      );
      assert.ok(own?.workspaceId);
      await result(bob, own.workspaceId, "submit");
      const final = await json(`/v1/matches/${match.id}`, bob, undefined, "GET");
      assert.equal(final.state, "completed");
      assert.equal(final.outcome.winnerUserId, session.user.id);
    } finally {
      await fixture.close();
    }
  },
);
