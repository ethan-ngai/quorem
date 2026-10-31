import { expect, it } from "vitest";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { verifiedIdentityReader } from "../../../adapters/postgres/identity/repository.ts";
import { verifiedInviteReader } from "../../../adapters/postgres/matches/invitations/repository.ts";
import { reauthorizeGrant, type GrantReaders } from "../../../modules/identity/grant.ts";
const url = process.env.QUOREM_DO_SOCKET_TEST_URL;
it.skipIf(!url)(
  "reauthorizes persisted grants against live bindings and invitation rotation",
  async () => {
    const parsed = new URL(url!);
    expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
      "127.0.0.1",
      "55473",
      "/quorem_hono_do_sockets_test",
    ]);
    const pool = createNodePool({
      connectionString: url!,
      max: 3,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const user = `grant-${crypto.randomUUID()}`,
      issuer = `issuer-${crypto.randomUUID()}`,
      id = crypto.randomUUID(),
      oldHash = crypto.randomUUID(),
      newHash = crypto.randomUUID();
    const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
      withNodeConnection(pool, { lifetimeMs: 5000 }, f);
    try {
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,$1)", [user]);
      await pool.query("INSERT INTO identity_bindings(issuer,subject,user_id) VALUES($1,$2,$3)", [
        issuer,
        "subject",
        user,
      ]);
      await pool.query(
        "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',30,'waiting',ARRAY['easy'])",
        [id, user, oldHash],
      );
      const readers: GrantReaders = {
        sessions: { check: async () => ({}) },
        managed: (grant) => run((scope) => verifiedIdentityReader(scope)(grant)),
        guest: async () => null,
        invite: verifiedInviteReader(run),
      };
      const expiresAt = Math.floor(Date.now() / 1000) + 60;
      const managed = {
        kind: "managed" as const,
        issuer,
        subject: "subject",
        sessionId: "session",
        expiresAt,
        strongUntil: 0,
      };
      const invite = { kind: "invite" as const, resourceId: id, hash: oldHash, expiresAt };
      expect((await reauthorizeGrant(managed, readers))?.userId).toBe(user);
      expect(await reauthorizeGrant(invite, readers)).toBeUndefined();
      await pool.query("UPDATE matches SET invite_hash=$2 WHERE id=$1", [id, newHash]);
      await expect(reauthorizeGrant(invite, readers)).rejects.toMatchObject({
        kind: "unauthorized",
      });
      await pool.query("UPDATE users SET disabled=true WHERE id=$1", [user]);
      await expect(reauthorizeGrant(managed, readers)).rejects.toMatchObject({
        kind: "unauthorized",
      });
      await expect(reauthorizeGrant({ ...invite, hash: newHash }, readers)).rejects.toMatchObject({
        kind: "unauthorized",
      });
    } finally {
      await pool.end();
    }
  },
);

it.skipIf(!url)(
  "fences match socket leases by membership, topic, expiry and host authority",
  async () => {
    const { matchSocketLeases } =
      await import("../../../adapters/postgres/matches/socket/leases.ts");
    const { acquireSocketLease } =
      await import("../../../adapters/postgres/events/socket/leases.ts");
    const pool = createNodePool({
      connectionString: url!,
      max: 8,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const host = `match-${crypto.randomUUID()}`,
      id = crypto.randomUUID();
    const actor = {
      kind: "local" as const,
      userId: host,
      displayName: host,
      admin: false,
      emailVerified: true,
      sessionId: "local",
      strongUntil: 0,
    };
    const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
      withNodeConnection(pool, { lifetimeMs: 5000 }, f);
    try {
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,$1)", [host]);
      await pool.query(
        "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',30,'waiting',ARRAY['easy'])",
        [id, host, crypto.randomUUID()],
      );
      await pool.query("INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,1)", [
        id,
        host,
      ]);
      const leases = matchSocketLeases(run);
      const acquired = await Promise.allSettled(
        Array.from({ length: 5 }, () => leases.acquire(actor, id)),
      );
      const ids = acquired.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      expect(ids).toHaveLength(4);
      expect(acquired.filter((r) => r.status === "rejected")).toHaveLength(1);
      await expect(
        run((scope) =>
          scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
            acquireSocketLease(tx, `/interviews/${id}`, host, async () => {}),
          ),
        ),
      ).resolves.toBeTypeOf("string");
      await pool.query(
        "UPDATE realtime_presence_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [ids[0]],
      );
      expect(await leases.renew(actor, id, ids[0])).toBe(false);
      await pool.query("UPDATE users SET disabled=true WHERE id=$1", [host]);
      await expect(leases.renew(actor, id, ids[1])).rejects.toMatchObject({ status: 404 });
      await leases.release(host, id, ids[1]);
    } finally {
      await pool.end();
    }
  },
);

it.skipIf(!url)(
  "does not acquire an interview lease through a concurrent membership removal",
  async () => {
    const { interviewPresence } =
      await import("../../../adapters/postgres/interviews/presence/repository.ts");
    const pool = createNodePool({
      connectionString: url!,
      max: 4,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const host = `race-${crypto.randomUUID()}`,
      id = crypto.randomUUID();
    const actor = {
      kind: "local" as const,
      userId: host,
      displayName: host,
      admin: false,
      emailVerified: true,
      sessionId: "local",
      strongUntil: 0,
    };
    const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
      withNodeConnection(pool, { lifetimeMs: 5000 }, f);
    try {
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,$1)", [host]);
      await pool.query(
        "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','test','test','test')",
        [crypto.randomUUID(), host],
      );
      await pool.query(
        "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES($1,$2,'Race','{}','python','',$3,$4,$5,'token',$6,'token2')",
        [
          id,
          host,
          crypto.randomUUID(),
          crypto.randomUUID(),
          crypto.randomUUID(),
          crypto.randomUUID(),
        ],
      );
      await pool.query(
        "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewer')",
        [id, host],
      );
      const lock = await pool.connect();
      try {
        await lock.query("BEGIN");
        await lock.query(
          "UPDATE interview_members SET removed_at=clock_timestamp() WHERE session_id=$1 AND user_id=$2",
          [id, host],
        );
        let done = false;
        const attempt = interviewPresence(run)
          .acquire(actor, id)
          .finally(() => {
            done = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(done).toBe(false);
        await lock.query("COMMIT");
        await expect(attempt).rejects.toMatchObject({ status: 404 });
        expect(
          (
            await pool.query(
              "SELECT id FROM realtime_presence_leases WHERE topic=$1 AND subject=$2",
              [`/interviews/${id}`, host],
            )
          ).rows,
        ).toHaveLength(0);
      } finally {
        lock.release();
      }
    } finally {
      await pool.end();
    }
  },
);
