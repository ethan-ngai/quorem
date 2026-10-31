import { describe, expect, it } from "vitest";
import { languageRuntime } from "@quorem/execution";
import { operatorQuestionAuthoring } from "../adapters/postgres/problems/authoring/repository.ts";
import { readPublishedFixture } from "../adapters/postgres/problems/private-content.ts";
import { resumeQuestionVersion } from "../adapters/postgres/problems/publication.ts";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { applyAccess, grantFingerprint } from "./access.ts";
import { seedCatalog } from "./seed.ts";
import { seedQuestion } from "./seed-question.ts";
import { provision } from "./provision.ts";
import { profileReads } from "./profile-reads.ts";
import { seedFingerprint } from "./seed-fingerprint.ts";
import { validateDirectory } from "./validate.ts";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const url = process.env.QUOREM_CLI_TEST_DATABASE_URL;
describe("operator CLI contracts", () => {
  it("keeps the historical Go access fingerprint", () => {
    expect(
      grantFingerprint({
        operationId: "cli-op",
        userId: "cli-user",
        actor: "operator",
        reason: "test",
        scope: "internal",
        source: "manual",
        reference: "fixture",
        revoke: false,
      }),
    ).toBe("ea2ca038ea4f7666f6cc7245b2ca7d0d0981288fbd844e7c47fe4e778d579ec8");
  });
  it("matches Go seed lock fingerprints, including raw JSON escapes", async () => {
    const raw = await readFile(resolve("../../fixtures/problems/mirror-letters.json"), "utf8");
    expect(seedFingerprint(raw, "cli-operator").fingerprint).toBe(
      "a3f3bd4486fc0a73d718ffb7ce1a00ac51ad6b2fd36edd96239ebc0e86457ffc",
    );
    const escaped = raw.replaceAll('"a-bC!"', '"\\u0061-bC!"');
    expect(seedFingerprint(escaped, "cli-operator").fingerprint).toBe(
      "69750a539703097f953b9ad6ce94a3658fa2e377b4792d4cb95dc75e363463c3",
    );
  });
  it("matches Go seed locks for lossless SQL numeric input", async () => {
    const p = JSON.parse(
      await readFile(resolve("../../fixtures/problems/run-widths.json"), "utf8"),
    );
    p.problem.slug = "cli-sql-oracle";
    p.problem.sql = {
      dialect: "postgresql",
      outputOrder: "ordered",
      tables: [{ name: "t", columns: [{ name: "n", type: "numeric" }] }],
      output: [{ name: "n", type: "numeric" }],
    };
    p.problem.constraints = [];
    p.problem.examples = [
      {
        args: [{ tables: [{ name: "t", rows: [[1]] }] }],
        expected: { rows: [[{ $numeric: "1" }]] },
      },
    ];
    p.hiddenCases = p.problem.examples;
    p.implementations = [
      {
        language: "postgresql",
        starterSource: "select 1",
        referenceSource: "select 1",
        runtimeRevision: "postgresql-17.6-v1",
        harnessRevision: "quorem-postgresql-v2",
      },
    ];
    p.solutions = [];
    const raw = JSON.stringify(p).replaceAll('"rows":[[1]]', '"rows":[[1e309]]');
    expect(seedFingerprint(raw, "cli-operator").fingerprint).toBe(
      "c32de76d77451d3d30dc5df9f4c7bccde461d0558028a9899c6192a7fda80ac4",
    );
  });
  it("validates candidate fixtures with canonical publication rules", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorem-cli-validate-"));
    try {
      await writeFile(
        join(dir, "valid.json"),
        await readFile(resolve("../../fixtures/odyssey/balance-ledger.json")),
      );
      await writeFile(join(dir, "bad.json"), '{"problem":{}}');
      const output: string[] = [];
      await validateDirectory(dir, (line) => output.push(line));
      const rows = output.map((line) => JSON.parse(line));
      expect(rows.map((row) => row.id)).toEqual(["bad", "valid"]);
      expect(rows[0].error).toBeTruthy();
      expect(rows[1].error).toBe("");
      expect(rows[1].sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it.skipIf(!url)(
    "seeds idempotently and applies audited access with rollback and conflict",
    async () => {
      const parsed = new URL(url!);
      expect(parsed.port).toBe("55460");
      expect(parsed.pathname).toBe("/quorem_hono_cli_test");
      const pool = createNodePool({
        connectionString: url!,
        max: 4,
        connectionTimeoutMs: 3000,
        idleTimeoutMs: 5000,
        onIdleError: () => {},
      });
      const user = `cli-${crypto.randomUUID()}`,
        admin = `admin-${crypto.randomUUID()}`,
        op = crypto.randomUUID();
      try {
        await pool.query(
          "INSERT INTO users(id,display_name,role) VALUES($1,'CLI','user'),($2,'Admin','admin')",
          [user, admin],
        );
        const oldUrl = process.env.DATABASE_URL,
          oldOrigin = process.env.AUTH_ORIGIN;
        process.env.DATABASE_URL = url!;
        process.env.AUTH_ORIGIN = "https://invalid-issuer.test";
        try {
          await expect(provision(["--seed"])).rejects.toThrow("Verified operator binding required");
        } finally {
          if (oldUrl === undefined) delete process.env.DATABASE_URL;
          else process.env.DATABASE_URL = oldUrl;
          if (oldOrigin === undefined) delete process.env.AUTH_ORIGIN;
          else process.env.AUTH_ORIGIN = oldOrigin;
        }
        await seedCatalog(pool, true);
        const before = (await pool.query("SELECT count(*)::int AS n FROM problem_versions")).rows[0]
          .n;
        await seedCatalog(pool, true);
        expect(
          (await pool.query("SELECT count(*)::int AS n FROM problem_versions")).rows[0].n,
        ).toBe(before);
        const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
          withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
        const base = {
          user,
          scope: "questions.custom",
          actor: "operator",
          reason: "test",
          opId: op,
          source: "manual",
          ref: "fixture",
          resource: "",
          value: 0,
          dry: true,
        };
        await run((scope) => applyAccess(scope, "grant", base));
        expect(
          (
            await pool.query("SELECT count(*)::int AS n FROM access_audit WHERE operation_id=$1", [
              op,
            ])
          ).rows[0].n,
        ).toBe(0);
        await run((scope) => applyAccess(scope, "grant", { ...base, dry: false }));
        await run((scope) => applyAccess(scope, "grant", { ...base, dry: false }));
        await expect(
          run((scope) => applyAccess(scope, "grant", { ...base, dry: false, reason: "changed" })),
        ).rejects.toThrow("Operation ID already used");
        const quota = {
          ...base,
          opId: crypto.randomUUID(),
          resource: "guest_concurrency",
          value: 3,
          dry: false,
        };
        await run((scope) => applyAccess(scope, "quota", quota));
        expect(
          (
            await pool.query(
              "SELECT value FROM quota_overrides WHERE user_id=$1 AND resource='guest_concurrency'",
              [user],
            )
          ).rows[0].value,
        ).toBe(3);
        await expect(
          run((scope) =>
            applyAccess(scope, "quota", { ...quota, opId: crypto.randomUUID(), value: 9 }),
          ),
        ).rejects.toThrow("Invalid quota");
        await expect(
          run((scope) =>
            applyAccess(scope, "grant", {
              ...base,
              opId: crypto.randomUUID(),
              scope: "admin",
              source: "subscription",
            }),
          ),
        ).rejects.toThrow("Invalid administrator");
        await run((scope) =>
          applyAccess(scope, "revoke", { ...base, opId: crypto.randomUUID(), dry: false }),
        );
        expect(
          (
            await pool.query(
              "SELECT revoked_at IS NOT NULL AS revoked FROM entitlement_grants WHERE user_id=$1 AND feature='questions.custom'",
              [user],
            )
          ).rows[0].revoked,
        ).toBe(true);
        const fixture = JSON.parse(
          await readFile(resolve("../../fixtures/problems/run-widths.json"), "utf8"),
        );
        const versionId = crypto.randomUUID(),
          problemId = crypto.randomUUID(),
          slug = `resume-${crypto.randomUUID().slice(0, 8)}`;
        fixture.problem.id = versionId;
        fixture.problem.slug = slug;
        fixture.problem.version = "1";
        fixture.solutions = [];
        await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [problemId, slug]);
        await pool.query(
          "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)",
          [
            versionId,
            problemId,
            fixture.problem.title,
            fixture.problem.difficulty,
            fixture.problem.statementMarkdown,
            JSON.stringify(fixture.problem.signature),
            JSON.stringify(fixture.problem.constraints),
            JSON.stringify(fixture.problem.limits),
            fixture.attribution,
          ],
        );
        await run((scope) =>
          scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 2000 }, (tx) =>
            resumeQuestionVersion(tx, JSON.stringify(fixture), versionId, languageRuntime),
          ),
        );
        expect(
          (
            await pool.query(
              "SELECT sealed,(SELECT count(*)::int FROM problem_languages WHERE version_id=$1) AS languages FROM problem_versions WHERE id=$1",
              [versionId],
            )
          ).rows[0],
        ).toMatchObject({ sealed: true, languages: 4 });
        await expect(
          run((scope) =>
            scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 2000 }, (tx) =>
              resumeQuestionVersion(tx, "{}", versionId, languageRuntime),
            ),
          ),
        ).rejects.toThrow();
        const candidate = JSON.parse(
          await readFile(resolve("../../fixtures/problems/run-widths.json"), "utf8"),
        );
        candidate.problem.slug = `rollback-${crypto.randomUUID().slice(0, 8)}`;
        const rawCandidate = JSON.stringify(candidate),
          tampered = structuredClone(candidate);
        tampered.problem.examples[0].expected = [123];
        const operatorAuthor = operatorQuestionAuthoring(
          run,
          languageRuntime,
          JSON.stringify(tampered),
        );
        const opActor = { userId: admin, admin: true, globalAllowed: true };
        const draft = JSON.parse(await operatorAuthor.create(opActor, rawCandidate, undefined));
        await expect(operatorAuthor.publish(opActor, draft.id, "1", "global")).rejects.toThrow(
          "Seed cases differ from publication",
        );
        expect(
          (
            await pool.query("SELECT count(*)::int AS n FROM problems WHERE slug=$1", [
              candidate.problem.slug,
            ])
          ).rows[0].n,
        ).toBe(0);
        expect(JSON.parse(await operatorAuthor.get(opActor, draft.id)).revision).toBe("1");
        const report = (await profileReads(url!)) as {
          read_only: boolean;
          catalog_rows: number;
          calls: unknown[];
          sql: unknown[];
        };
        expect(report.read_only).toBe(true);
        expect(report.catalog_rows).toBeGreaterThan(0);
        expect(report.calls).toHaveLength(3);
        expect(report.sql.length).toBeGreaterThanOrEqual(3);
        const dir = await mkdtemp(join(tmpdir(), "quorem-cli-seed-"));
        try {
          const fixture = JSON.parse(
            await readFile(resolve("../../fixtures/odyssey/balance-ledger.json"), "utf8"),
          );
          fixture.problem.slug = `fixture-${crypto.randomUUID().slice(0, 8)}`;
          const path = join(dir, "question.json");
          await writeFile(path, JSON.stringify(fixture));
          const [first, concurrent] = await Promise.all([
            seedQuestion(pool, admin, "private", path),
            seedQuestion(pool, admin, "private", path),
          ]);
          expect(concurrent).toBe(first);
          expect(await seedQuestion(pool, admin, "private", path)).toBe(first);
          const read = (who: string, id: string, language: string) =>
            run((scope) =>
              scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 2000 }, (tx) =>
                readPublishedFixture(tx, who, id, language),
              ),
            );
          const owned = await read(admin, first, "python");
          expect(owned?.starterSource).toBeTruthy();
          expect(JSON.parse(owned!.content).odysseyHiddenCases.length).toBeGreaterThan(0);
          expect(await read(user, first, "python")).toBeUndefined();
          expect(await read(admin, first, "postgresql")).toBeUndefined();
          const global = await read(user, "e91ec728-4597-5dfb-9d19-7c4ba17138b7", "python");
          expect(global?.language).toBe("python");
          expect(JSON.parse(global!.content).implementations).toHaveLength(4);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      } finally {
        await pool.end();
      }
    },
  );
});

it.skipIf(!url || process.env.QUOREM_CLI_GO_INTEROP !== "true").each([
  ["ts", "escaped"],
  ["go", "escaped"],
  ["ts", "sql"],
  ["go", "sql"],
  ["go", "sql-overflow"],
])(
  "serializes concurrent Go and TS seeders with %s first (%s)",
  async (first, mode) => {
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const dir = await mkdtemp(join(tmpdir(), "quorem-cli-interop-"));
    const root = resolve("../..");
    const childProcesses: import("node:child_process").ChildProcess[] = [];
    const client = await pool.connect();
    let lock = "";
    try {
      const operator = (
        await client.query<{ user_id: string }>(
          `SELECT b.user_id FROM access_audit seed JOIN identity_bindings b ON b.user_id=seed.user_id AND b.subject=seed.scope JOIN quorem_auth."user" a ON a.id=b.subject JOIN users u ON u.id=b.user_id WHERE seed.operation_id='bootstrap:operator' AND b.issuer=$1 AND a."emailVerified" AND u.role='admin' AND NOT u.disabled`,
          [process.env.AUTH_ORIGIN],
        )
      ).rows[0];
      expect(operator).toBeDefined();
      const fixture = JSON.parse(
        await readFile(
          resolve(
            mode.startsWith("sql")
              ? "../../fixtures/problems/run-widths.json"
              : "../../fixtures/problems/mirror-letters.json",
          ),
          "utf8",
        ),
      );
      fixture.problem.slug = `interop-${crypto.randomUUID().slice(0, 8)}`;
      if (mode.startsWith("sql")) {
        fixture.problem.sql = {
          dialect: "postgresql",
          outputOrder: "ordered",
          tables: [{ name: "t", columns: [{ name: "n", type: "numeric" }] }],
          output: [{ name: "n", type: "numeric" }],
        };
        fixture.problem.constraints = [];
        fixture.problem.examples = [
          {
            args: [{ tables: [{ name: "t", rows: [[1]] }] }],
            expected: { rows: [[{ $numeric: "1" }]] },
          },
        ];
        fixture.hiddenCases = fixture.problem.examples;
        fixture.implementations = [
          {
            language: "postgresql",
            starterSource: "select 1",
            referenceSource: "select 1",
            runtimeRevision: "postgresql-17.6-v1",
            harnessRevision: "quorem-postgresql-v2",
          },
        ];
        fixture.solutions = [];
      }
      const raw = mode.startsWith("sql")
          ? JSON.stringify(fixture).replaceAll(
              '"rows":[[1]]',
              mode === "sql-overflow" ? '"rows":[[1e309]]' : '"rows":[[1e6]]',
            )
          : JSON.stringify(fixture).replaceAll('"a-bC!"', '"\\u0061-bC!"'),
        path = join(dir, "question.json");
      await writeFile(path, raw);
      lock = `seed:question:${operator!.user_id}:private:${seedFingerprint(raw, operator!.user_id).fingerprint}`;
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,740179))", [lock]);
      const { spawn } = await import("node:child_process");
      const env = { ...process.env, DATABASE_URL: url! };
      const startTs = () =>
        spawn(
          process.execPath,
          [
            "--experimental-strip-types",
            "apps/api/src/cli/provision.ts",
            "--seed",
            "--private-question",
            path,
          ],
          { cwd: root, env },
        );
      const startGo = () =>
        spawn("go", ["run", "./apps/api/cmd/provision", "--seed", "--private-question", path], {
          cwd: root,
          env,
        });
      const firstChild = first === "ts" ? startTs() : startGo();
      childProcesses.push(firstChild);
      firstChild.stdout?.resume();
      firstChild.stderr?.resume();
      for (let i = 0; i < 200; i++) {
        const n = Number(
          (
            await client.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'",
            )
          ).rows[0].count,
        );
        if (n >= 1) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const secondChild = first === "ts" ? startGo() : startTs();
      const processes = [firstChild, secondChild];
      childProcesses.push(secondChild);
      const exits = processes.map(
        (child) => new Promise<number | null>((resolve) => child.once("exit", resolve)),
      );
      for (const child of processes) {
        child.stdout?.resume();
        child.stderr?.resume();
      }
      let waiting = 0;
      for (let i = 0; i < 200; i++) {
        waiting = Number(
          (
            await client.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'",
            )
          ).rows[0].count,
        );
        if (waiting >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,740179))", [lock]);
      lock = "";
      expect(await Promise.all(exits)).toEqual(mode === "sql-overflow" ? [1, 0] : [0, 0]);
      const retry = spawn(
        "go",
        ["run", "./apps/api/cmd/provision", "--seed", "--private-question", path],
        { cwd: root, env },
      );
      retry.stdout?.resume();
      retry.stderr?.resume();
      expect(await new Promise<number | null>((resolve) => retry.once("exit", resolve))).toBe(0);
      const count = (
        await client.query(
          "SELECT count(*)::int AS n FROM problems p JOIN problem_versions v ON v.problem_id=p.id WHERE p.slug LIKE $1",
          [`%${fixture.problem.slug}`],
        )
      ).rows[0].n;
      expect(count).toBe(1);
      const drafts = (
        await client.query(
          `SELECT count(*)::int AS n,count(*) FILTER (WHERE d.published_version_id IS NOT NULL)::int AS published FROM access_audit a JOIN question_drafts d ON d.id::text=a.scope WHERE a.action='questions.seed' AND d.content->'problem'->>'slug' LIKE $1`,
          [`%${fixture.problem.slug}`],
        )
      ).rows[0];
      expect(drafts).toMatchObject({ n: 1, published: 1 });
    } finally {
      if (lock)
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1,740179))", [lock]);
      for (const child of childProcesses) if (child.exitCode === null) child.kill("SIGTERM");
      client.release();
      await pool.end();
      await rm(dir, { recursive: true, force: true });
    }
  },
  15000,
);
