import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { createApp } from "../../../../app.ts";
import { admissionRoutes } from "../../../../modules/judging/admission/routes.ts";
import { submissionRoutes } from "../../../../modules/judging/results/routes.ts";
import type { LocalPrincipal } from "../../../../modules/identity/model.ts";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { postgresWorkspaceAdmission } from "./repository.ts";
import { submissionSnapshots } from "../results/repository.ts";

const url = process.env.QUOREM_ADMISSION_TEST_DATABASE_URL;
const judge = process.env.QUOREM_ADMISSION_GO_JUDGE === "true";
describe.skipIf(!url || !judge)("admission, Go judge and result routes", () => {
  const parsed = new URL(url ?? "postgres://127.0.0.1:55458/quorem_hono_admission_test");
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.searchParams.has("host") ||
    parsed.pathname !== "/quorem_hono_admission_test" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
  )
    throw new Error("Disposable admission database required");
  const pool = createNodePool({
    connectionString: url!,
    max: 8,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
    withNodeConnection(pool, { lifetimeMs: 12000 }, fn);
  const receipts = prearmReceipts(run, "execution"),
    commit = postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true }),
    snapshots = submissionSnapshots(run);
  const suffix = crypto.randomUUID(),
    owner = `e2e-${suffix}`,
    other = `other-${suffix}`,
    problem = crypto.randomUUID(),
    versions = [crypto.randomUUID(), crypto.randomUUID()],
    workspaces = [crypto.randomUUID(), crypto.randomUUID()];
  const principal = (userId: string): LocalPrincipal => ({
    kind: "local",
    userId,
    displayName: userId,
    admin: false,
    emailVerified: true,
    sessionId: "fixture",
    strongUntil: 0,
  });
  const identify = async (request: Request) =>
    principal(request.headers.get("x-fixture-owner") === "other" ? other : owner);
  const app = createApp({
    allowedOrigins: ["https://fixture.test"],
    requestId: () => "fixture-request",
  });
  app.route(
    "/",
    admissionRoutes({
      identify,
      guestExecution: true,
      receipts,
      coordinator: { prearm: async () => {}, wake: async () => {} },
      publisher: { send: async () => {} },
      shard: 43,
      commit,
    }),
  );
  app.route("/", submissionRoutes({ identify, snapshots }));
  const call = (path: string, init: RequestInit = {}) =>
    app.request(`https://fixture.test${path}`, init);
  const post = (path: string, key: string, body: unknown, who?: string) =>
    call(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
        ...(who ? { "x-fixture-owner": who } : {}),
      },
      body: JSON.stringify(body),
    });
  const submit = async (index: number, kind: "run" | "submit", source: string, key: string) => {
    await pool.query(
      "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
      [owner],
    );
    const response = await post("/v1/submissions", key, {
      workspaceId: workspaces[index],
      kind,
      source,
    });
    expect(response.status).toBe(202);
    return (await response.json()).id as string;
  };
  const drain = () =>
    fetch("http://127.0.0.1:58758/internal/drain", {
      method: "POST",
      headers: { authorization: `Bearer ${"fixture-token-".repeat(3)}` },
    });
  const inspect = async (id: string, who?: string) =>
    call(`/v1/submissions/${id}`, { headers: who ? { "x-fixture-owner": who } : {} });
  const limit = JSON.stringify({
    wallTimeMs: 15000,
    memoryBytes: 268435456,
    outputBytes: 65536,
    maxProcesses: 16,
    maxCollectionElements: 10000,
    maxNestingDepth: 100,
  });
  beforeAll(async () => {
    await migrate(
      pool,
      "product",
      fileURLToPath(new URL("../../../../../migrations/", import.meta.url)),
    );
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Owner'),($2,'Other')", [
      owner,
      other,
    ]);
    await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [problem, problem]);
    for (let i = 0; i < 2; i++) {
      const type = i ? "str" : "int",
        signature = {
          className: "Solution",
          methodName: "f",
          parameters: [{ name: "x", type }],
          returnType: type,
        };
      const privateFixture = i
        ? JSON.stringify({
            problem: {
              id: versions[i],
              signature,
              constraints: [],
              limits: JSON.parse(limit),
              examples: [{ args: ["public"], expected: "public" }],
            },
            hiddenCases: [{ args: ["PRIVATE\u0000VALUE"], expected: "PRIVATE\u0000VALUE" }],
            odysseyHiddenCases: [],
          })
        : null;
      await pool.query(
        "INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution,lossless_fixture) VALUES($1,$2,$3,'Fixture','easy','',$4::jsonb,'[]'::jsonb,$5::jsonb,'',$6)",
        [
          versions[i],
          i + 1,
          problem,
          JSON.stringify(signature),
          limit,
          privateFixture ? Buffer.from(privateFixture) : null,
        ],
      );
      await pool.query(
        "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','python-3.12-v1','quorem-harness-v2','')",
        [versions[i]],
      );
      await pool.query(
        "INSERT INTO problem_examples(version_id,ordinal,args,expected) VALUES($1,0,$2::jsonb,$3::jsonb)",
        [versions[i], i ? '["public"]' : "[1]", i ? '"public"' : "2"],
      );
      await pool.query(
        "INSERT INTO problem_test_cases(version_id,ordinal,args,expected) VALUES($1,0,$2::jsonb,$3::jsonb)",
        [versions[i], i ? '["PRIVATEVALUE"]' : "[3]", i ? '"PRIVATEVALUE"' : "4"],
      );
      await pool.query(
        "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
        [workspaces[i], owner, versions[i]],
      );
    }
  });
  afterAll(async () => {
    await pool.query(
      "DELETE FROM execution_dispatch_intents WHERE job_id IN (SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.owner_id=$1)",
      [owner],
    );
    await pool.query("DELETE FROM cancellation_idempotency WHERE owner_id=$1", [owner]);
    await pool.query("DELETE FROM execution_idempotency WHERE owner_id=$1", [owner]);
    await pool.query(
      "DELETE FROM execution_attempt_usage WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id=$1)",
      [owner],
    );
    await pool.query(
      "DELETE FROM execution_jobs WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id=$1)",
      [owner],
    );
    await pool.query("DELETE FROM submissions WHERE owner_id=$1", [owner]);
    await pool.query("DELETE FROM workspaces WHERE owner_id=$1", [owner]);
    await pool.query("DELETE FROM problem_examples WHERE version_id=ANY($1::uuid[])", [versions]);
    await pool.query("DELETE FROM problem_test_cases WHERE version_id=ANY($1::uuid[])", [versions]);
    await pool.query("DELETE FROM problem_languages WHERE version_id=ANY($1::uuid[])", [versions]);
    await pool.query("DELETE FROM problem_versions WHERE id=ANY($1::uuid[])", [versions]);
    await pool.query("DELETE FROM problems WHERE id=$1", [problem]);
    await pool.query("DELETE FROM users WHERE id=ANY($1)", [[owner, other]]);
    await pool.end();
  });
  it("executes a real admitted submission and projects the actual judge result", async () => {
    const id = await submit(
      0,
      "submit",
      "class Solution:\n    def f(self,x):\n        return x+1\n",
      "accepted",
    );
    expect((await inspect(id, "other")).status).toBe(404);
    const done = await drain();
    expect(done.ok).toBe(true);
    const response = await inspect(id),
      body = await response.json();
    expect(response.status).toBe(200);
    expect(body.state).toBe("completed");
    expect(body.verdict).toBe("accepted");
    expect(body.hiddenCases).toEqual([{ index: 0, status: "accepted" }]);
    expect(JSON.stringify(body)).not.toMatch(/attemptId|sandboxScope|jobId/);
  }, 30000);
  it("cancels a real queued job and replays the same cancellation safely", async () => {
    const id = await submit(
      0,
      "run",
      "class Solution:\n    def f(self,x):\n        return x+1\n",
      "queued",
    );
    expect((await post(`/v1/submissions/${id}/cancel`, "deny", {}, "other")).status).toBe(404);
    const first = await post(`/v1/submissions/${id}/cancel`, "cancel-queued", {}),
      body = await first.text();
    expect(first.status).toBe(200);
    expect(JSON.parse(body).state).toBe("cancelled");
    const retry = await post(`/v1/submissions/${id}/cancel`, "cancel-queued", {});
    expect(await retry.text()).toBe(body);
    expect(
      (await pool.query("SELECT finished FROM execution_jobs WHERE submission_id=$1", [id])).rows[0]
        .finished,
    ).toBe(true);
  });
  it("requests cancellation while the Go judge is actually running and retains the slot until settlement", async () => {
    const id = await submit(
      0,
      "run",
      "import time\nclass Solution:\n    def f(self,x):\n        time.sleep(8)\n        return x+1\n",
      "running",
    );
    const draining = drain();
    let state = "";
    for (let i = 0; i < 200; i++) {
      state = (await pool.query("SELECT state FROM submissions WHERE id=$1", [id])).rows[0].state;
      if (state === "running") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(state).toBe("running");
    const attempt = (
      await pool.query(
        "SELECT attempt_id::text AS attempt FROM execution_jobs WHERE submission_id=$1",
        [id],
      )
    ).rows[0].attempt;
    let started = false;
    for (let i = 0; i < 200; i++) {
      try {
        execFileSync("docker", ["inspect", `quorem-${attempt}-0`], { stdio: "ignore" });
        started = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    expect(started).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const locker = await pool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM execution_jobs WHERE submission_id=$1 FOR UPDATE", [id]);
      const first = await post(`/v1/submissions/${id}/cancel`, "cancel-running", {}),
        body = await first.text();
      expect(first.status).toBe(200);
      expect(JSON.parse(body).state).toBe("running");
      expect(await (await post(`/v1/submissions/${id}/cancel`, "cancel-running", {})).text()).toBe(
        body,
      );
      const blocked = await post("/v1/submissions", "while-running", {
        workspaceId: workspaces[0],
        kind: "run",
        source: "x",
      });
      expect(blocked.status).toBe(409);
      expect((await blocked.json()).error.code).toBe("user_busy");
      await locker.query("COMMIT");
    } finally {
      locker.release();
    }
    expect((await draining).ok).toBe(true);
    const settled = await (await inspect(id)).json();
    expect(settled.state).toBe("cancelled");
  }, 30000);
  it("hides a real private NUL case after lossless Go judging", async () => {
    const id = await submit(
      1,
      "submit",
      "class Solution:\n    def f(self,x):\n        return x\n",
      "private-nul",
    );
    expect((await drain()).ok).toBe(true);
    const response = await inspect(id),
      text = await response.text(),
      body = JSON.parse(text);
    expect(body.state).toBe("completed");
    expect(body.verdict).toBe("accepted");
    expect(body.hiddenCases).toEqual([{ index: 0, status: "accepted" }]);
    expect(text).not.toContain("PRIVATE");
    expect(text).not.toContain("\\u0000");
  }, 30000);
});
