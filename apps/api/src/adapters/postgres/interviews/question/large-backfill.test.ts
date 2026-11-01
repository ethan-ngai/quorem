import { expect, it } from "vitest";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { backfillActiveRunnerInput } from "../runner-inputs/legacy-backfill.ts";
import { interviewSnapshotStream } from "./stream.ts";
const url = process.env.QUOREM_INTERVIEW_INPUTS_TEST_URL;
it.skipIf(!url || process.env.QUOREM_LARGE_BACKFILL_TEST !== "1")(
  "normalizes an active >128 MiB legacy fixture one case at a time",
  async () => {
    const parsed = new URL(url!);
    expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
      "127.0.0.1",
      "55571",
      "/quorem_hono_interview_inputs_test",
    ]);
    const pool = createNodePool({
      connectionString: url!,
      max: 3,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
      withNodeConnection(pool, { lifetimeMs: 300000 }, fn);
    const host = `large-operator-${crypto.randomUUID()}`,
      candidate = `large-reader-${crypto.randomUUID()}`,
      id = crypto.randomUUID(),
      epoch = crypto.randomUUID(),
      size = 65 * 1024 * 1024;
    const actor = {
      kind: "local" as const,
      userId: candidate,
      displayName: candidate,
      admin: false,
      emailVerified: true,
      sessionId: "fixture",
      strongUntil: 0,
    };
    try {
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,$1),($2,$2)", [
        host,
        candidate,
      ]);
      await pool.query(
        "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','test','test','test')",
        [crypto.randomUUID(), host],
      );
      const source = (
        await pool.query(
          "SELECT i.id::text AS id FROM interviews i JOIN problem_versions v ON v.id::text=i.question->'problem'->>'id' WHERE octet_length(v.lossless_fixture)>134217728 ORDER BY i.created_at DESC LIMIT 1",
        )
      ).rows[0];
      if (!source) throw new Error("Run the large workerd fixture first");
      await pool.query(
        `INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token,lossless_question)
      SELECT $1::uuid,$2,'Legacy large',jsonb_set(jsonb_set(i.question,'{problem,examples}',jsonb_build_array(jsonb_build_object('args',jsonb_build_array(repeat('x',$4)),'expected',9007199254740993)) ),'{hiddenCases}',jsonb_build_array(jsonb_build_object('args',jsonb_build_array('PRIVATE_SECRET'||repeat('y',$4)),'expected',1))),'python','pass',$5::uuid,$6::uuid,$7,'x',$8,'y',
      convert_to('{"problem":'||left(((i.question->'problem')-'examples')::text,-1)||',"examples":[{"args":["'||repeat('x',$4)||chr(92)||'u0000"],"expected":9007199254740993,"explanation":"legacy public"}]},"hiddenCases":[{"args":["PRIVATE_SECRET'||repeat('y',$4)||'"],"expected":1}],"odysseyHiddenCases":[],"harnessRevision":"quorem-harness-v2"}','UTF8')
      FROM interviews i WHERE i.id=$3::uuid`,
        [
          id,
          host,
          source.id,
          size,
          crypto.randomUUID(),
          epoch,
          crypto.randomUUID(),
          crypto.randomUUID(),
        ],
      );
      await pool.query(
        "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewer'),($1,$3,'interviewee')",
        [id, host, candidate],
      );
      expect(
        (
          await pool.query(
            "SELECT octet_length(lossless_question)::int AS n FROM interviews WHERE id=$1",
            [id],
          )
        ).rows[0].n,
      ).toBeGreaterThan(128 * 1024 * 1024);
      expect(
        await run((scope) =>
          scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, (tx) =>
            backfillActiveRunnerInput(tx, id, epoch),
          ),
        ),
      ).toBe(true);
      const state = (
        await pool.query(
          "SELECT lossless_question IS NULL AS compact FROM interviews WHERE id=$1",
          [id],
        )
      ).rows[0];
      expect(state.compact).toBe(true);
      const reader = (await interviewSnapshotStream(run)(actor, id)).getReader(),
        decoder = new TextDecoder();
      let bytes = 0,
        tail = "",
        sawNul = false,
        sawNumber = false,
        leaked = false;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        expect(part.value.length).toBeLessThanOrEqual(65536);
        bytes += part.value.length;
        const text = tail + decoder.decode(part.value, { stream: true });
        sawNul ||= text.includes("\\u0000");
        sawNumber ||= text.includes("9007199254740993");
        leaked ||= text.includes("PRIVATE_SECRET");
        tail = text.slice(-128);
      }
      expect(bytes).toBeGreaterThan(64 * 1024 * 1024);
      expect([sawNul, sawNumber, leaked]).toEqual([true, true, false]);
    } finally {
      await pool.end();
    }
  },
  300000,
);
