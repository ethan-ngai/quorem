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
