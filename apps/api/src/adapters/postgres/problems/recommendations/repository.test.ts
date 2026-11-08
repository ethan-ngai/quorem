/** @file repository.test.ts @description Durable evidence and authorized recommendation integration. @module problems */
import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { problemQueries } from "../queries/repository.ts";
import { parseCatalogFilter } from "../../../../modules/problems/queries.ts";
import { selectMatchCandidate } from "../../matches/selection/repository.ts";
import { normalizeSettings } from "../../../../modules/matches/lifecycle/model.ts";
import { learningEvents, recommendationContext, activeModel } from "./repository.ts";
import { retainBatch } from "../../events/scheduling/retention.ts";
import { recommendationMeasurement } from "./measurement.ts";
import { saveTraining, activateModel } from "./training.ts";
import { train } from "../../../../modules/problems/recommendations/training.ts";
import { prior } from "../../../../modules/problems/recommendations/model.ts";
const url = process.env.QUOREM_CATALOG_TEST_DATABASE_URL;
describe.skipIf(!url)("adaptive PostgreSQL selection", () => {
  it("retains eligible events, isolates history, fences model activation", async () => {
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
          const assistedSubmission = crypto.randomUUID();
          await tx.execute(
            sql`UPDATE question_exposure SET assisted_at=clock_timestamp()-interval '1 minute' WHERE owner_id=${bob} AND version_id=${versions[0]}::uuid`,
          );
          await tx.execute(sql`INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases)
            VALUES(${assistedSubmission}::uuid,${bob},${workspace}::uuid,'submit','','hash','running','[]')`);
          await tx.execute(
            sql`UPDATE question_exposure SET assisted_at=clock_timestamp()+interval '1 minute' WHERE owner_id=${bob} AND version_id=${versions[0]}::uuid`,
          );
          await tx.execute(
            sql`UPDATE submissions SET state='completed',result='{"verdict":"accepted"}' WHERE id=${assistedSubmission}::uuid`,
          );
          expect(
            (
              await tx.execute<{ assisted: boolean }>(
                sql`SELECT assisted FROM question_learning_events WHERE submission_id=${assistedSubmission}::uuid`,
              )
            ).rows[0]?.assisted,
          ).toBe(true);
          const complete = async (
            verdict: string,
            age: number,
            kind = "submit",
            custom = false,
            targetWorkspace = workspace,
            level: number | null = null,
            matchId: string | null = null,
            recent = false,
          ) => {
            const id = crypto.randomUUID();
            await tx.execute(sql`INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,admitted_at,custom_run,odyssey_level,match_id)
            VALUES(${id}::uuid,${bob},${targetWorkspace}::uuid,${kind},'source','hash','running','[]',CASE WHEN ${recent} THEN clock_timestamp() ELSE date_trunc('day',clock_timestamp())-make_interval(days=>${age}) END,${custom},${level},${matchId}::uuid)`);
            await tx.execute(
              sql`UPDATE submissions SET state='completed',result=${JSON.stringify({ verdict })}::jsonb WHERE id=${id}::uuid`,
            );
            await tx.execute(sql`UPDATE submissions SET state='completed' WHERE id=${id}::uuid`);
            await tx.execute(
              sql`UPDATE question_learning_events SET observed_at=date_trunc('day',statement_timestamp())-interval '1 day' WHERE submission_id=${id}::uuid`,
            );
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
          expect(await learningEvents(tx, [bob])).toMatchObject([{ attempts: 5, accepted: true }]);
          await tx.execute(sql`UPDATE submissions SET result=NULL WHERE id=${retained}::uuid`);
          expect(await learningEvents(tx, [bob])).toMatchObject([{ attempts: 5, accepted: true }]);
          expect(await learningEvents(tx, [alice])).toEqual([]);
          const queries = problemQueries(async (read) =>
            read({ transaction: (_options, action) => action(tx) }),
          );
          const filter = parseCatalogFilter(
            new URLSearchParams({ sort: "recommended", topic: prefix, limit: "2" }),
          );
          const first = JSON.parse(
            await queries.catalog({ userId: bob }, { ...filter, library: "global" }),
          );
          expect(first.items[0].id).toBe(versions[1]);
          expect(first.total).toBe(2);
          expect(first.nextCursor).toBeUndefined();
          const impression = first.recommendationImpressions[versions[1]];
          await queries.recommendationFeedback(alice, [impression], "dismiss");
          await queries.recommendationFeedback(bob, [impression], "view");
          const suggestedWorkspace = crypto.randomUUID();
          await tx.execute(sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language)
            VALUES(${suggestedWorkspace}::uuid,${bob},${versions[1]}::uuid,'python')`);
          expect(
            (
              await tx.execute(
                sql`SELECT 1 FROM recommendation_impressions WHERE id=${impression}::uuid AND started_at IS NOT NULL`,
              )
            ).rowCount,
          ).toBe(1);
          expect(first.items[1].id).toBe(versions[0]);
          const publicPage = JSON.parse(await queries.catalog(undefined, { ...filter, limit: 20 }));
          expect(publicPage.items.map((item: { id: string }) => item.id)).not.toContain(
            versions[2],
          );
          const settings = normalizeSettings({
            difficulties: ["easy"],
            questionSelection: "recommended",
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
          let nextDraw = 0;
          const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
            (array as Uint32Array)[0] = nextDraw;
            return array;
          });
          try {
            const randomSettings = normalizeSettings({ ...settings, questionSelection: "random" });
            const draw = () => selectMatchCandidate(tx, alice, randomSettings, [alice, bob]);
            const firstRandom = (await draw()).id;
            expect((await draw()).id).toBe(firstRandom);
            nextDraw = 1;
            expect(new Set([firstRandom, (await draw()).id])).toEqual(
              new Set(versions.slice(0, 2)),
            );
          } finally {
            random.mockRestore();
          }
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
          await complete("accepted", 0, "submit", false, matchWorkspace, null, match);
          expect(
            (await learningEvents(tx, [bob])).find(
              (e) => e.id === versions[0] && e.context === "match",
            )?.context,
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
          expect(
            (
              await tx.execute(
                sql`SELECT 1 FROM question_learning_events WHERE submission_id=${retained}::uuid`,
              )
            ).rowCount,
          ).toBe(1);
          const result = train([], prior(), Date.now());
          const rejected = await saveTraining(tx, result, null);
          expect(rejected.activated).toBe(false);
          // Activation rejects unvalidated artifacts without mutating the active pointer.
          await expect(activateModel(tx, rejected.id)).rejects.toThrow("eligible");
          // Exercise database extraction -> fitting -> validated activation with a known signal.
          await tx.execute(
            sql`INSERT INTO users(id,display_name) SELECT ${prefix}||'-learner-'||i,'Learner' FROM generate_series(0,19) i`,
          );
          await tx.execute(sql`INSERT INTO question_learning_events(submission_id,owner_id,version_id,difficulty,tags,accepted,context,attempted_at,observed_at)
            SELECT gen_random_uuid(),${prefix}||'-learner-'||(i%20),v.id,'easy',ARRAY['arrays'],i%3=0,'practice',
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
          expect(
            (await learningEvents(tx, [bob])).find(
              (e) => e.id === versions[0] && e.context === "practice",
            )?.attempts,
          ).toBe(4);
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
          await complete("accepted", 0, "submit", false, suggestedWorkspace, null, null, true);
          expect(
            (
              await tx.execute(
                sql`SELECT 1 FROM recommendation_impressions WHERE id=${impression}::uuid AND solved_at IS NOT NULL`,
              )
            ).rowCount,
          ).toBe(1);
          await tx.execute(
            sql`UPDATE recommendation_impressions SET solved_at=statement_timestamp()-interval '3 days' WHERE id=${impression}::uuid`,
          );
          await complete("wrong_answer", 0, "submit", false, suggestedWorkspace, null, null, true);
          expect(
            (
              await tx.execute(
                sql`SELECT 1 FROM recommendation_impressions WHERE id=${impression}::uuid AND followup_solved=false`,
              )
            ).rowCount,
          ).toBe(1);
          await queries.recommendationFeedback(bob, [impression], "dismiss");
          const dismissed = JSON.parse(await queries.catalog({ userId: bob }, filter));
          expect(dismissed.items.map((item: { id: string }) => item.id)).not.toContain(versions[1]);
          await tx.execute(sql`
            UPDATE recommendation_impressions SET solved_at=statement_timestamp()-interval '16 days'
            WHERE id=${impression}::uuid
          `);
          await tx.execute(sql`
            INSERT INTO question_learning_events(submission_id,owner_id,version_id,difficulty,tags,accepted,context,attempted_at,observed_at)
            VALUES(gen_random_uuid(),${bob},${versions[0]}::uuid,'easy',ARRAY[${prefix}],true,'practice',
              statement_timestamp()-interval '12 days',statement_timestamp()-interval '12 days')
          `);
          expect((await recommendationMeasurement(tx)).practice).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ transfer_attempts: 1, transfer_solves: 1 }),
            ]),
          );
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
