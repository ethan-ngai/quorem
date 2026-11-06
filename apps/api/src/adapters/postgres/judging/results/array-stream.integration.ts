/** @file array-stream.integration.ts @description Buffered private-array authorization and snapshot conformance. @module judging */
import assert from "node:assert/strict";
import type { Pool } from "pg";
import type { LocalPrincipal } from "../../../../modules/identity/model.ts";
import type { SubmissionSnapshots } from "../../../../modules/judging/results/model.ts";

/** Exercise multiple ordinals sharing a single authorized byte page. */
export async function verifyBufferedResultArrays(
  pool: Pool,
  actual: SubmissionSnapshots,
  alice: LocalPrincipal,
  session: string,
  submission: string,
): Promise<void> {
  // Two values in one source page expose stale-buffer authorization/version regressions.
  const examples = JSON.stringify([
    { args: [], expected: 2 },
    { args: [], expected: 3 },
  ]);
  const buffered = crypto.randomUUID();
  const bufferedFixture = (
    await pool.query(
      "INSERT INTO interview_question_snapshots(session_id,id,fixture) SELECT $1,sha256(convert_to(fixture::text,'UTF8')),fixture FROM (SELECT jsonb_set(q.fixture,'{problem,examples}',$2::jsonb) AS fixture FROM interview_question_snapshots q JOIN interview_execution e ON e.session_id=q.session_id AND e.fixture_id=q.id WHERE e.submission_id=$3) changed RETURNING id",
      [session, examples, submission],
    )
  ).rows[0].id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases) VALUES($1,'results-alice',$2,'submit','','buffered','running','[]')",
      [buffered, session],
    );
    await client.query(
      "INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,question_epoch,fixture_id,level,private_results) SELECT $1,session_id,document_version,document_epoch,question_epoch,$2,level,'[]'::jsonb FROM interview_execution WHERE submission_id=$3",
      [buffered, bufferedFixture, submission],
    );
    await client.query(
      "INSERT INTO interview_snapshot_public_examples(session_id,fixture_id,level,examples) VALUES($1,$2,0,convert_to($3,'UTF8'))",
      [session, bufferedFixture, examples],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  await pool.query(
    "INSERT INTO submission_result_headers(submission_id,header_data) VALUES($1,convert_to($2,'UTF8'))",
    [
      buffered,
      JSON.stringify({
        publicCasesPresent: false,
        publicCaseCount: 0,
        channel: "sample",
        hiddenCasesPresent: true,
        hiddenCaseCount: 2,
      }),
    ],
  );
  await pool.query(
    "INSERT INTO submission_result_header_fields(submission_id,field,field_data) VALUES($1,'hiddenCases',convert_to($2,'UTF8'))",
    [
      buffered,
      JSON.stringify([
        { index: 0, status: "first" },
        { index: 1, status: "second" },
      ]),
    ],
  );
  await pool.query("UPDATE submissions SET state='completed',result='{}' WHERE id=$1", [buffered]);
  for (const mutation of ["membership", "examples", "retention"]) {
    const reader = (await actual.interview(alice, session, buffered)).getReader();
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      assert.equal(part.done, false);
      if (decoder.decode(part.value).includes('"status":"first"')) break;
    }
    if (mutation === "membership")
      await pool.query(
        "UPDATE interview_members SET removed_at=clock_timestamp() WHERE session_id=$1 AND user_id='results-alice'",
        [session],
      );
    else if (mutation === "examples")
      await pool.query(
        "UPDATE interview_snapshot_public_examples SET examples=examples WHERE session_id=$1 AND fixture_id=$2",
        [session, bufferedFixture],
      );
    else await pool.query("UPDATE submissions SET result=NULL WHERE id=$1", [buffered]);
    let suffix = "";
    try {
      await assert.rejects(async () => {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          suffix += decoder.decode(part.value);
        }
      });
      assert.doesNotMatch(suffix, /"status":"second"/);
      assert.doesNotMatch(suffix, /example:1/);
    } finally {
      await pool.query(
        "UPDATE interview_members SET removed_at=NULL WHERE session_id=$1 AND user_id='results-alice'",
        [session],
      );
    }
  }
}
