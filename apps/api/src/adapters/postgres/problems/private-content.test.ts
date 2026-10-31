import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { questionAuthoring } from "./authoring/repository.ts";
import { readPublishedFixture } from "./private-content.ts";
const url = process.env.QUOREM_AUTHORING_TEST_DATABASE_URL;
const runtime = (language: string) =>
  (
    ({
      python: { revision: "python-3.12-v1", harness: "quorem-harness-v2" },
      java: { revision: "java-21.0.9-v1", harness: "quorem-java-v1" },
      typescript: { revision: "typescript-5.9.3-node-22.21.1-v1", harness: "quorem-typescript-v1" },
      ocaml: { revision: "ocaml-4.13.1-v1", harness: "quorem-ocaml-v1" },
    }) as Record<string, { revision: string; harness: string }>
  )[language];
describe.skipIf(!url)("private publication reader", () => {
  it("limits snapshots to current global or owned versions and requested language", async () => {
    const parsed = new URL(url!);
    expect(parsed.port).toBe("55447");
    expect(parsed.pathname).toBe("/quorem_hono_authoring_test");
    const pool = createNodePool({
      connectionString: url!,
      max: 4,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const owner = `reader-${crypto.randomUUID()}`,
      other = `reader-${crypto.randomUUID()}`;
    try {
      await pool.query(
        "INSERT INTO users(id,display_name,role) VALUES($1,'Owner','admin'),($2,'Other','user')",
        [owner, other],
      );
      const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
        withNodeConnection(pool, { lifetimeMs: 15000 }, fn);
      const author = questionAuthoring(run, runtime),
        actor = { userId: owner, admin: true, globalAllowed: true };
      const fixture = JSON.parse(
        readFileSync(
          new URL("../../../../../../fixtures/problems/run-widths.json", import.meta.url),
          "utf8",
        ),
      );
      fixture.problem.slug = `reader-${crypto.randomUUID().slice(0, 8)}`;
      const multiRaw = JSON.stringify(fixture);
      fixture.problem.signature = {
        className: "Solution",
        methodName: "echo",
        parameters: [{ name: "x", type: "str" }],
        returnType: "str",
      };
      fixture.problem.constraints = [];
      fixture.problem.examples = [{ args: ["public\u0000value"], expected: "public\u0000value" }];
      fixture.hiddenCases = [{ args: ["private\u0000value"], expected: "private\u0000value" }];
      fixture.implementations = fixture.implementations.filter(
        (v: { language: string }) => v.language === "python",
      );
      fixture.solutions = [];
      const raw = JSON.stringify(fixture);
      const draft = JSON.parse(await author.create(actor, raw, undefined));
      const published = JSON.parse(await author.publish(actor, draft.id, "1", "private"));
      const read = (who: string, id: string, language: string) =>
        run((scope) =>
          scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 2000 }, (tx) =>
            readPublishedFixture(tx, who, id, language),
          ),
        );
      const value = await read(owner, published.publishedVersionId, "python");
      expect(value?.starterSource).toBeTruthy();
      const content = JSON.parse(value!.content);
      expect(content.hiddenCases[0].args[0]).toBe("private\u0000value");
      expect(content.implementations).toHaveLength(1);
      expect(await read(other, published.publishedVersionId, "python")).toBeUndefined();
      expect(await read(owner, published.publishedVersionId, "postgresql")).toBeUndefined();
      const globalDraft = JSON.parse(await author.create(actor, multiRaw, undefined));
      const global = JSON.parse(await author.publish(actor, globalDraft.id, "1", "global"));
      const publicSnapshot = await read(other, global.publishedVersionId, "python");
      expect(publicSnapshot).toBeDefined();
      expect(JSON.parse(publicSnapshot!.content).implementations).toHaveLength(4);
      const newerDraft = JSON.parse(await author.create(actor, multiRaw, undefined));
      await author.publish(actor, newerDraft.id, "1", "global");
      expect(await read(other, global.publishedVersionId, "python")).toBeUndefined();
    } finally {
      await pool.end();
    }
  });
});
