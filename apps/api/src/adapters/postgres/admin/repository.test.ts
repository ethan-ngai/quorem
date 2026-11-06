/** @file repository.test.ts @description Real aggregate semantics, bounds and live authorization. @module admin */
import { describe, expect, it } from "vitest";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { assertRunnerFixture } from "../judging/worker/test-db.ts";
import { adminOverview } from "./repository.ts";

const url = process.env.QUOREM_TEST_DATABASE_URL;
describe.skipIf(!url)("administrator overview on disposable PostgreSQL", () => {
  it("counts retained activity, limits detail, excludes private content and rechecks authority", async () => {
    assertRunnerFixture(url!, ["/quorem_hono_admin_test"]);
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
      withNodeConnection(pool, { lifetimeMs: 15000 }, fn);
    try {
      await pool.query(
        "INSERT INTO users(id,display_name,role) VALUES ('admin','Operator','admin')",
      );
      const reader = adminOverview(run);
      const empty = await reader.overview("admin");
      expect(empty).toMatchObject({
        users: { accounts: 1, administrators: 1, active7d: 0, disabled: 0 },
        content: { publications: 0, drafts: 0, workspaces: 0 },
        submissions: { retained7d: 0, pending: 0 },
        activeUsers: [],
        recentDrafts: [],
      });
      for (let i = 0; i < 10; i++) {
        await pool.query("INSERT INTO users(id,display_name,disabled) VALUES($1,$2,$3)", [
          `member-${i}`,
          `Member ${i}`,
          i === 9,
        ]);
      }
      await pool.query("INSERT INTO users(id,display_name,kind) VALUES ('guest','Guest','guest')");
      for (const owner of [
        "admin",
        "guest",
        ...Array.from({ length: 10 }, (_, i) => `member-${i}`),
      ]) {
        const workspace = crypto.randomUUID();
        await pool.query("INSERT INTO workspaces(id,owner_id,language) VALUES($1,$2,'python')", [
          workspace,
          owner,
        ]);
        const insert = (kind: string, state: string, days: number) =>
          pool.query(
            "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,admitted_at) VALUES($1,$2,$3,$4,'PRIVATE SOURCE','hash',$5,'[]',now()-$6*interval '1 day')",
            [crypto.randomUUID(), owner, workspace, kind, state, days],
          );
        if (owner === "admin") {
          await insert("run", "completed", 0);
          await insert("submit", "completed", 8);
          await insert("run", "queued", 0);
        } else await insert("submit", "completed", 0);
      }
      for (let i = 0; i < 7; i++) {
        await pool.query(
          "INSERT INTO question_drafts(content,created_by,updated_by,updated_at) VALUES($1,'admin','admin',now()-$2*interval '1 hour')",
          [JSON.stringify({ problem: { title: `Shared ${i}` } }), i],
        );
      }
      await pool.query(
        "INSERT INTO question_drafts(content,created_by,updated_by,owner_id) VALUES($1,'admin','admin','admin')",
        [JSON.stringify({ problem: { title: "PRIVATE TITLE" } })],
      );
      const overview = await reader.overview("admin");
      expect(overview.users).toEqual({
        accounts: 11,
        administrators: 1,
        disabled: 1,
        active7d: 10,
      });
      expect(overview.content).toEqual({ publications: 0, drafts: 7, workspaces: 12 });
      expect(overview.submissions).toEqual({ retained7d: 11, pending: 1 });
      expect(overview.activeUsers).toHaveLength(8);
      expect(
        overview.activeUsers.every(
          (user) => user.id.startsWith("member-") && user.submissions === 1,
        ),
      ).toBe(true);
      expect(overview.recentDrafts.map((draft) => draft.title)).toEqual([
        "Shared 0",
        "Shared 1",
        "Shared 2",
        "Shared 3",
        "Shared 4",
      ]);
      expect(JSON.stringify(overview)).not.toContain("PRIVATE");
      expect(
        new Date(overview.generatedAt).valueOf() - new Date(overview.windowStart).valueOf(),
      ).toBe(7 * 86400000);
      await pool.query("UPDATE users SET role='user' WHERE id='admin'");
      await expect(reader.overview("admin")).rejects.toMatchObject({ status: 403 });
      await pool.query("UPDATE users SET role='admin',disabled=true WHERE id='admin'");
      await expect(reader.overview("admin")).rejects.toMatchObject({ status: 403 });
    } finally {
      await pool.end();
    }
  });
});
