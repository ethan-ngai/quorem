/** @file repository.test.ts @description Durable evidence and authorized recommendation integration. @module problems */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { problemQueries } from "../queries/repository.ts";
import { parseCatalogFilter } from "../../../../modules/problems/queries.ts";
import { selectMatchCandidate } from "../../matches/selection/repository.ts";
import { normalizeSettings } from "../../../../modules/matches/lifecycle/model.ts";
import {
  learningEvents,
  recommendationContext,
  learningQuestions,
  activeModel,
} from "./repository.ts";
import { retainBatch } from "../../events/scheduling/retention.ts";
import { saveEmbedding } from "./embeddings.ts";
import { saveTraining, activateModel } from "./training.ts";
import { train } from "../../../../modules/problems/recommendations/training.ts";
import { prior } from "../../../../modules/problems/recommendations/model.ts";
const url = process.env.QUOREM_CATALOG_TEST_DATABASE_URL;
describe.skipIf(!url)("adaptive PostgreSQL selection", () => {
  it("retains eligible events, isolates history, invalidates vectors and fences model activation", async () => {
    const parsed = new URL(url!);
    expect(parsed.pathname).toBe("/quorem_hono_catalog_test");
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(parsed.hostname);
    const pool = createNodePool({
      connectionString: url!,
      max: 1,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const rollback = new Error("rollback fixture");
    try {
      await withNodeConnection(pool, { lifetimeMs: 15000 }, (scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
          const prefix = crypto.randomUUID();
          const alice = `${prefix}-alice`,
            bob = `${prefix}-bob`;
          await tx.execute(
            sql`INSERT INTO users(id,display_name) VALUES(${alice},'Alice'),(${bob},'Bob')`,
          );
          const versions: string[] = [];
          for (let i = 0; i < 3; i++) {
            const problem = crypto.randomUUID(),
              version = crypto.randomUUID();
            versions.push(version);
            await tx.execute(
              sql`INSERT INTO problems(id,slug,owner_id) VALUES(${problem}::uuid,${`${prefix}-${i}`},${i === 2 ? bob : null})`,
            );
            await tx.execute(sql`INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution)
            VALUES(${version}::uuid,${problem}::uuid,1,${`${prefix}-${i}`},'easy','public statement','{"className":"Solution","methodName":"solve","parameters":[],"returnType":"int"}','[]','{"wallTimeMs":2000,"memoryBytes":268435456,"outputBytes":65536,"maxProcesses":16,"maxCollectionElements":10000,"maxNestingDepth":100}','fixture')`);
            await tx.execute(
              sql`INSERT INTO problem_tags(version_id,tag,ordinal) VALUES(${version}::uuid,${prefix},0)`,
            );
            await tx.execute(
              sql`UPDATE problems SET current_version_id=${version}::uuid WHERE id=${problem}::uuid`,
            );
            await tx.execute(
              sql`UPDATE problem_versions SET sealed=true WHERE id=${version}::uuid`,
            );
          }
          const workspace = crypto.randomUUID();
          await tx.execute(
            sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES(${workspace}::uuid,${bob},${versions[0]}::uuid,'python')`,
          );
          const complete = async (
            verdict: string,
            age: number,
            kind = "submit",
            custom = false,
            targetWorkspace = workspace,
            level: number | null = null,
            matchId: string | null = null,
          ) => {
            const id = crypto.randomUUID();
            await tx.execute(sql`INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,admitted_at,custom_run,odyssey_level,match_id)
            VALUES(${id}::uuid,${bob},${targetWorkspace}::uuid,${kind},'source','hash','running','[]',date_trunc('day',clock_timestamp())-make_interval(days=>${age}),${custom},${level},${matchId}::uuid)`);
            await tx.execute(
              sql`UPDATE submissions SET state='completed',result=${JSON.stringify({ verdict })}::jsonb WHERE id=${id}::uuid`,
            );
            await tx.execute(sql`UPDATE submissions SET state='completed' WHERE id=${id}::uuid`);
            return id;
          };
          await complete("accepted", 3, "run");
          await complete("accepted", 3, "submit", true);
          await complete("syntax_error", 3);
          expect(await learningEvents(tx, [bob])).toEqual([]);
          await complete("wrong_answer", 2);
          await complete("accepted", 2);
          await complete("accepted", 2);
          await complete("accepted", 1);
          const retained = await complete("wrong_answer", 0);
          expect(await learningEvents(tx, [bob])).toHaveLength(5);
          await tx.execute(sql`UPDATE submissions SET result=NULL WHERE id=${retained}::uuid`);
          expect(await learningEvents(tx, [bob])).toHaveLength(5);
          expect(await learningEvents(tx, [alice])).toEqual([]);
          const queries = problemQueries(async (read) =>
            read({ transaction: (_options, action) => action(tx) }),
          );
          const filter = parseCatalogFilter(
            new URLSearchParams({ sort: "recommended", topic: prefix, limit: "1" }),
          );
          const first = JSON.parse(
            await queries.catalog({ userId: bob }, { ...filter, library: "global" }),
          );
          expect(first.items[0].id).toBe(versions[1]);
          expect(first.total).toBe(2);
          expect(first.nextCursor).toBeUndefined();
          const second = JSON.parse(
            await queries.catalog({ userId: bob }, { ...filter, library: "global", page: 2 }),
          );
          expect(second.items[0].id).toBe(versions[0]);
          const publicPage = JSON.parse(
            await queries.catalog(undefined, { ...filter, limit: 100 }),
          );
          expect(publicPage.items.map((item: { id: string }) => item.id)).not.toContain(
            versions[2],
          );
          const settings = normalizeSettings({
            difficulties: ["easy"],
            questionFilters: { topic: prefix },
          });
          expect((await selectMatchCandidate(tx, alice, settings, [alice, bob])).id).toBe(
            versions[1],
          );
          expect(
            (
              await selectMatchCandidate(
                tx,
                alice,
                { ...settings, selectedProblemVersionId: versions[0] },
                [alice, bob],
              )
            ).id,
          ).toBe(versions[0]);
          await expect(
            selectMatchCandidate(
              tx,
              alice,
              { ...settings, selectedProblemVersionId: versions[2] },
              [alice, bob],
            ),
          ).rejects.toMatchObject({ status: 400 });
          const stagedProblem = crypto.randomUUID(),
            stagedVersion = crypto.randomUUID(),
            stagedWorkspace = crypto.randomUUID();
          await tx.execute(
            sql`INSERT INTO problems(id,slug) VALUES(${stagedProblem}::uuid,${`${prefix}-odyssey`})`,
          );
          await tx.execute(sql`INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,constraints,limits,attribution,odyssey)
            VALUES(${stagedVersion}::uuid,${stagedProblem}::uuid,1,'Staged','easy','statement','[]','{}','fixture','{"levels":[{},{}]}')`);
          await tx.execute(
            sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES(${stagedWorkspace}::uuid,${bob},${stagedVersion}::uuid,'python')`,
          );
          await complete("accepted", 0, "submit", false, stagedWorkspace, 1);
          expect(
            (await learningEvents(tx, [bob])).filter((row) => row.id === stagedVersion),
          ).toHaveLength(0);
          await complete("accepted", 0, "submit", false, stagedWorkspace, 2);
          expect(
            (await learningEvents(tx, [bob])).find((row) => row.id === stagedVersion),
          ).toMatchObject({ accepted: true, context: "practice" });

          const match = crypto.randomUUID(),
            review = crypto.randomUUID();
          await tx.execute(sql`INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,problem_version_id,started_at,deadline,difficulties,outcome)
            VALUES(${match}::uuid,${alice},${prefix},now()+interval '1 hour',30,'completed',${versions[0]}::uuid,now()-interval '1 hour',now()-interval '30 minutes',ARRAY['easy'],'{}')`);
          await tx.execute(sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,review_match_id,review_source_owner_id)
            VALUES(${review}::uuid,${bob},${versions[1]}::uuid,'python','review',${match}::uuid,${alice})`);
          await complete("accepted", 0, "submit", false, review);
          expect((await learningEvents(tx, [bob])).some((row) => row.id === versions[1])).toBe(
            false,
          );

          const matchWorkspace = crypto.randomUUID();
          await tx.execute(
            sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id) VALUES(${matchWorkspace}::uuid,${bob},${versions[0]}::uuid,'python','match',${match}::uuid)`,
          );
          const matchResult = await complete(
            "accepted",
            0,
            "submit",
            false,
            matchWorkspace,
            null,
            match,
          );
          expect(
            (await learningEvents(tx, [bob])).find((e) => e.eventId === matchResult)?.context,
          ).toBe("match");
          const interview = crypto.randomUUID(),
            submission = crypto.randomUUID(),
            epoch = crypto.randomUUID();
          await tx.execute(sql`INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token)
            VALUES(${interview}::uuid,${alice},'Interview','{}','python','',${epoch}::uuid,${epoch}::uuid,${prefix},${prefix},${prefix},${prefix})`);
          await tx.execute(
            sql`INSERT INTO interview_question_snapshots(session_id,id,fixture) VALUES(${interview}::uuid,sha256(convert_to('{}','UTF8')),'{}')`,
          );
          await tx.execute(
            sql`INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases) VALUES(${submission}::uuid,${alice},${interview}::uuid,'submit','source','hash','running','[]')`,
          );
          await tx.execute(
            sql`INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,question_epoch,fixture_id) VALUES(${submission}::uuid,${interview}::uuid,0,${epoch}::uuid,${epoch}::uuid,sha256(convert_to('{}','UTF8')))`,
          );
          await tx.execute(
            sql`UPDATE submissions SET state='completed',result='{"verdict":"accepted"}' WHERE id=${submission}::uuid`,
          );
          expect(await learningEvents(tx, [alice])).toEqual([]);
          const privateWorkspace = crypto.randomUUID();
          await tx.execute(
            sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES(${privateWorkspace}::uuid,${bob},${versions[2]}::uuid,'python')`,
          );
          await complete("accepted", 0, "submit", false, privateWorkspace);
          expect((await learningEvents(tx, [bob])).some((e) => e.id === versions[2])).toBe(true);
          expect((await learningEvents(tx, null)).some((e) => e.id === versions[2])).toBe(false);
          expect((await learningEvents(tx, null)).some((e) => e.id === versions[0])).toBe(true);
          expect(
            (await recommendationContext(tx, [bob])).exposures.some((e) => e.id === versions[0]),
          ).toBe(true);
          await tx.execute(sql`DELETE FROM submissions WHERE id=${retained}::uuid`);
          expect((await learningEvents(tx, [bob])).some((e) => e.eventId === retained)).toBe(true);
          const before = (await learningQuestions(tx, [versions[0]]))[0];
          const vector = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
          expect(await saveEmbedding(tx, { ...before, text: "fixture" }, vector)).toBe(true);
          expect((await learningQuestions(tx, [versions[0]]))[0].embedding).toEqual(vector);
          // Simulate an intervening public metadata revision inside this rolled-back fixture.
          await tx.execute(
            sql`ALTER TABLE problem_versions DISABLE TRIGGER immutable_problem_version`,
          );
          await tx.execute(
            sql`UPDATE problem_versions SET statement_markdown='Changed' WHERE id=${versions[0]}::uuid`,
          );
          await tx.execute(
            sql`ALTER TABLE problem_versions ENABLE TRIGGER immutable_problem_version`,
          );
          expect((await learningQuestions(tx, [versions[0]]))[0].key).not.toBe(before.key);
          expect((await learningQuestions(tx, [versions[0]]))[0].embedding).toBeUndefined();
          expect(await saveEmbedding(tx, { ...before, text: "fixture" }, vector)).toBe(false);
          const result = train([], prior(), Date.now());
          const rejected = await saveTraining(tx, result, null);
          expect(rejected.activated).toBe(false);
          // Activation rejects unvalidated artifacts without mutating the active pointer.
          await expect(activateModel(tx, rejected.id)).rejects.toThrow("eligible");
          // Exercise database extraction -> fitting -> validated activation with a known signal.
          await tx.execute(
            sql`INSERT INTO users(id,display_name) SELECT ${prefix}||'-learner-'||i,'Learner' FROM generate_series(0,19) i`,
          );
          await tx.execute(sql`INSERT INTO question_learning_events(submission_id,owner_id,version_id,content_key,difficulty,tags,accepted,context,attempted_at,observed_at)
            SELECT gen_random_uuid(),${prefix}||'-learner-'||(i%20),v.id,recommendation_content_key(v.id),'easy',ARRAY['arrays'],i%3=0,'practice',
              clock_timestamp()-interval '100 days'+i*interval '2.4 hours',clock_timestamp()-interval '100 days'+i*interval '2.4 hours'
            FROM generate_series(0,999) i JOIN problem_versions v ON v.id=(ARRAY[${versions[0]}::uuid,${versions[1]}::uuid,${stagedVersion}::uuid])[i%3+1]`);
          const eligible = train(await learningEvents(tx, null), prior(), Date.now());
          expect(eligible.eligible).toBe(true);
          expect(eligible.metrics.logLoss).toBeLessThan(eligible.baseline.logLoss);
          const saved = await saveTraining(tx, eligible, null);
          expect(saved.activated).toBe(true);
          expect((await activeModel(tx)).id).toBe(saved.id);
          expect((await saveTraining(tx, eligible, null)).activated).toBe(false);
          await activateModel(tx, null);
          expect((await activeModel(tx)).id).toBeNull();
          await activateModel(tx, saved.id);
          expect((await activeModel(tx)).id).toBe(saved.id);
          await tx.execute(
            sql`UPDATE recommendation_models SET expires_at=now()-interval '16 days' WHERE id=${saved.id}::uuid`,
          );
          expect((await activeModel(tx)).model.trainedAt).toBe(0);
          await expect(activateModel(tx, saved.id)).rejects.toThrow("eligible");
          await tx.execute(
            sql`UPDATE question_learning_events SET observed_at=now()-interval '181 days' WHERE submission_id=${retained}::uuid`,
          );
          expect((await learningEvents(tx, [bob])).some((e) => e.eventId === retained)).toBe(false);
          await retainBatch(
            async (read) =>
              read({
                transaction: (_options, action) => action(tx),
                withDatabase: (action) => scope.withDatabase(action),
              }),
            128,
          );
          expect(
            (
              await tx.execute(
                sql`SELECT 1 FROM question_learning_events WHERE submission_id=${retained}::uuid`,
              )
            ).rowCount,
          ).toBe(0);
          expect(
            (await tx.execute(sql`SELECT 1 FROM recommendation_models WHERE id=${saved.id}::uuid`))
              .rowCount,
          ).toBe(0);
          // Rehearse first deployment over existing workspaces and retained submissions.
          await tx.execute(sql`DROP TRIGGER question_workspace_observed ON workspaces`);
          await tx.execute(sql`DROP TRIGGER question_result_observed ON submissions`);
          await tx.execute(sql`DROP FUNCTION observe_question_workspace()`);
          await tx.execute(sql`DROP FUNCTION observe_question_result()`);
          await tx.execute(sql`DROP FUNCTION recommendation_content_key(uuid)`);
          await tx.execute(
            sql`DROP TABLE question_exposure,question_learning_events,question_embeddings,recommendation_models`,
          );
          await tx.execute(
            sql.raw(
              await readFile(
                new URL("../../../../../migrations/080_question_learning.sql", import.meta.url),
                "utf8",
              ),
            ),
          );
          const migrated = await recommendationContext(tx, [bob]);
          expect(migrated.events).toEqual([]);
          expect(migrated.exposures.map((e) => e.id)).toContain(versions[0]);
          expect(migrated.exposures.map((e) => e.id)).not.toContain(versions[1]);
          throw rollback;
        }),
      ).catch((error) => {
        if (error !== rollback) throw error;
      });
    } finally {
      await pool.end();
    }
  });
});
