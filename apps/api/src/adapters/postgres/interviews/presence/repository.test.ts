import { expect, it } from "vitest";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import type { LocalPrincipal } from "../../../../modules/identity/model.ts";
import { interviewLifecycle } from "../lifecycle/repository.ts";
import { preparePublishedInterviewQuestion } from "../question/prepare.ts";
import { interviewSnapshotStream } from "../question/stream.ts";
import { interviewPresence } from "./repository.ts";
import { interviewMonitoring } from "../monitoring/repository.ts";
const url = process.env.QUOREM_INTERVIEW_PRESENCE_TEST_URL;
const actor = (userId: string): LocalPrincipal => ({
  kind: "local",
  userId,
  displayName: userId,
  admin: false,
  emailVerified: true,
  sessionId: "local",
  strongUntil: 0,
});
it.skipIf(!url)(
  "shares quota across replicas, fences expiry and keeps monitoring private",
  async () => {
    const db = new URL(url!);
    expect([db.hostname, db.port, db.pathname]).toEqual([
      "127.0.0.1",
      "55469",
      "/quorem_hono_interview_presence_test",
    ]);
    const pool = createNodePool({
        connectionString: url!,
        max: 12,
        connectionTimeoutMs: 2000,
        idleTimeoutMs: 5000,
        onIdleError: () => {},
      }),
      host = actor(`host-${crypto.randomUUID()}`),
      candidate = actor(`candidate-${crypto.randomUUID()}`);
    try {
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Host'),($2,'Candidate')", [
        host.userId,
        candidate.userId,
      ]);
      await pool.query(
        "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','test','test','test')",
        [crypto.randomUUID(), host.userId],
      );
      const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
        withNodeConnection(pool, { lifetimeMs: 15000 }, f);
      const lifecycle = interviewLifecycle(run, {
          question: preparePublishedInterviewQuestion,
          snapshot: interviewSnapshotStream(run),
        }),
        a = interviewPresence(run),
        b = interviewPresence(run),
        monitoring = interviewMonitoring(run);
      const created = JSON.parse(
        await new Response(
          await lifecycle.read(
            host,
            JSON.parse(
              await lifecycle.create(host, "create", {
                title: "Presence",
                question: {
                  problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
                  language: "python",
                },
              }),
            ).id,
          ),
        ).text(),
      );
      const id = created.id;
      await pool.query(
        "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewee')",
        [id, candidate.userId],
      );
      const input = {
        clientID: "one",
        epoch: created.document.epoch,
        version: 0,
        anchor: 0,
        head: 0,
      };
      const heartbeat = await a.acquire(candidate, id);
      const locked = await pool.connect();
      await locked.query("BEGIN");
      await locked.query("SELECT id FROM interviews WHERE id=$1 FOR NO KEY UPDATE", [id]);
      let roomReadFinished = false;
      const roomRead = lifecycle.read(host, id).then(() => {
        roomReadFinished = true;
      });
      try {
        expect((await a.update(candidate, id, input)).some((x) => x.clientID === "one")).toBe(true);
        expect(await b.renew(candidate, id, heartbeat)).toBe(true);
        expect(roomReadFinished).toBe(false);
      } finally {
        await locked.query("ROLLBACK");
        locked.release();
      }
      await roomRead;
      expect(roomReadFinished).toBe(true);
      await a.release(candidate, id, heartbeat);
      const windows = await Promise.allSettled(
        ["two", "three", "four", "five", "six"].map((clientID, i) =>
          (i % 2 ? a : b).update(candidate, id, { ...input, clientID }),
        ),
      );
      expect(windows.filter((v) => v.status === "fulfilled")).toHaveLength(3);
      await pool.query(
        "UPDATE interview_presence SET updated_at=clock_timestamp()-interval '21 seconds' WHERE session_id=$1 AND client_id='one'",
        [id],
      );
      await a.update(candidate, id, { ...input, clientID: "replacement" });
      const leases = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).acquire(candidate, id)),
      );
      const active = leases.flatMap((v) => (v.status === "fulfilled" ? [v.value] : []));
      expect(active).toHaveLength(4);
      expect(
        await Promise.all([a.renew(candidate, id, active[0]), b.renew(candidate, id, active[0])]),
      ).toEqual([true, true]);
      await pool.query(
        "UPDATE realtime_presence_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [active[0]],
      );
      expect(await b.renew(candidate, id, active[0])).toBe(false);
      const replacement = await b.acquire(candidate, id);
      await a.release(candidate, id, active[0]);
      expect(await b.renew(candidate, id, replacement)).toBe(true);
      await monitoring.report(candidate, id, "event", "paste");
      await monitoring.report(candidate, id, "event", "paste");
      await monitoring.report(candidate, id, "recent", "paste");
      expect(
        JSON.parse(await new Response(await lifecycle.read(host, id)).text()).ruleEvents,
      ).toHaveLength(1);
      expect(
        JSON.parse(await new Response(await lifecycle.read(candidate, id)).text()).ruleEvents,
      ).toBeUndefined();
      await monitoring.setPolicy(host, id, "policy", { focus: false, paste: true });
      await monitoring.report(candidate, id, "focus", "focus");
      expect(
        JSON.parse(await new Response(await lifecycle.read(host, id)).text()).ruleEvents,
      ).toHaveLength(1);
      await expect(monitoring.report(host, id, "host-event", "paste")).rejects.toMatchObject({
        status: 403,
      });
      await pool.query(
        "INSERT INTO interview_rule_events(id,session_id,owner_id,kind,occurred_at) SELECT gen_random_uuid(),$1,$2,'paste',clock_timestamp()-interval '10 seconds' FROM generate_series(1,105)",
        [id, candidate.userId],
      );
      await pool.query(
        "UPDATE interview_rule_events SET occurred_at=clock_timestamp()-interval '10 seconds' WHERE session_id=$1",
        [id],
      );
      await monitoring.report(candidate, id, "trim", "paste");
      expect(
        JSON.parse(await new Response(await lifecycle.read(host, id)).text()).ruleEvents,
      ).toHaveLength(100);
      await pool.query(
        "UPDATE interview_members SET role='interviewer' WHERE session_id=$1 AND user_id=$2",
        [id, candidate.userId],
      );
      expect(
        JSON.parse(await new Response(await lifecycle.read(candidate, id)).text()).ruleEvents,
      ).toHaveLength(100);
      await expect(monitoring.report(candidate, id, "promoted", "paste")).rejects.toMatchObject({
        status: 403,
      });
      await pool.query(
        "UPDATE interview_members SET role='interviewee' WHERE session_id=$1 AND user_id=$2",
        [id, candidate.userId],
      );
      expect(
        JSON.parse(await new Response(await lifecycle.read(candidate, id)).text()).ruleEvents,
      ).toBeUndefined();
      await pool.query(
        "UPDATE interview_members SET removed_at=clock_timestamp() WHERE session_id=$1 AND user_id=$2",
        [id, candidate.userId],
      );
      expect(await a.peers(host, id)).toEqual([]);
      await expect(a.renew(candidate, id, replacement)).rejects.toMatchObject({ status: 404 });
    } finally {
      await pool.end();
    }
  },
);
