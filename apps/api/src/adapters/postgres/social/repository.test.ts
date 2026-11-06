/** @file repository.test.ts @description Real PostgreSQL rivalry eligibility and profile privacy. @module social */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { socialRepository } from "./repository.ts";
const url = process.env.QUOREM_SOCIAL_TEST_DATABASE_URL;
describe.skipIf(!url)("social PostgreSQL", () => {
  let pool: ReturnType<typeof createNodePool>;
  let social: ReturnType<typeof socialRepository>;
  const ids: Record<string, string> = {};
  const prefix = `social-${crypto.randomUUID()}`;
  const owner = (name: string) => `${prefix}-${name}`;
  const matches: string[] = [];
  const issuer = "https://social-auth.example.test";
  const handle = `player${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      parsed.hostname !== "127.0.0.1" ||
      parsed.pathname !== "/quorem_social_test" ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("Disposable social database required");
    pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    await migrate(
      pool,
      "product",
      fileURLToPath(new URL("../../../../migrations/", import.meta.url)),
    );
    await migrate(
      pool,
      "auth",
      fileURLToPath(new URL("../../../../../auth/migrations/", import.meta.url)),
    );
    social = socialRepository((fn) => withNodeConnection(pool, { lifetimeMs: 10000 }, fn), issuer);
    for (const name of ["viewer", "nemesis", "rival", "guest", "disabled", "newcomer"]) {
      ids[name] = crypto.randomUUID();
      await pool.query(
        "INSERT INTO users(id,participant_id,display_name,kind,disabled) VALUES($1,$2,$3,$4,$5)",
        [owner(name), ids[name], name, name === "guest" ? "guest" : "account", name === "disabled"],
      );
    }
    await pool.query(
      `INSERT INTO quorem_auth."user"(id,name,email,username,"createdAt","updatedAt") VALUES($1,'', $2,$3,now(),now())`,
      [owner("auth"), `${prefix}@example.test`, handle],
    );
    await pool.query("INSERT INTO identity_bindings(issuer,subject,user_id) VALUES($1,$2,$3)", [
      issuer,
      owner("auth"),
      owner("nemesis"),
    ]);
    await pool.query("INSERT INTO identity_bindings(issuer,subject,user_id) VALUES($1,$2,$3)", [
      "https://unrelated.example.test",
      owner("auth"),
      owner("newcomer"),
    ]);
    const add = async (
      opponent: string,
      result: string,
      days = 1,
      mode = "showdown",
      started = true,
    ) => {
      const id = crypto.randomUUID();
      matches.push(id);
      const outcome =
        result === "win"
          ? { kind: "win", winnerUserId: ids.viewer }
          : result === "loss"
            ? { kind: "win", winnerUserId: ids[opponent] }
            : result === "invalid"
              ? { kind: "win", winnerUserId: crypto.randomUUID() }
              : { kind: result };
      await pool.query(
        "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties,mode,started_at,completed_at,outcome) VALUES($1::uuid,$2,$1::text,now(),30,$3,ARRAY['easy'],$4,CASE WHEN $5 THEN now()-interval '1 day' ELSE NULL END,now()-$6*interval '1 day',$7)",
        [
          id,
          owner("viewer"),
          result === "cancelled" ? "cancelled" : "completed",
          mode,
          started,
          days,
          outcome,
        ],
      );
      for (const [index, name] of ["viewer", opponent].entries())
        await pool.query(
          "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,$3)",
          [id, owner(name), index + 1],
        );
    };
    for (const r of ["loss", "loss", "draw", "win"]) await add("nemesis", r);
    for (const r of ["win", "win", "loss"]) await add("rival", r);
    await add("newcomer", "loss");
    for (const name of ["guest", "disabled"]) for (let i = 0; i < 3; i++) await add(name, "loss");
    for (const r of ["cancelled", "no_contest", "invalid"]) await add("nemesis", r);
    await add("nemesis", "loss", 91);
    await add("nemesis", "loss", 1, "free-for-all");
    await add("nemesis", "loss", 1, "showdown", false);
  }, 20000);
  afterAll(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM match_participants WHERE match_id=ANY($1::uuid[])", [matches]);
    await pool.query("DELETE FROM matches WHERE id=ANY($1::uuid[])", [matches]);
    await pool.query("DELETE FROM identity_bindings WHERE user_id LIKE $1", [`${prefix}-%`]);
    await pool.query('DELETE FROM quorem_auth."user" WHERE id LIKE $1', [`${prefix}-%`]);
    await pool.query("DELETE FROM users WHERE id LIKE $1", [`${prefix}-%`]);
    await pool.end();
  });
  it("selects repeated eligible opponents, ordered by losses, without private IDs", async () => {
    const overview = await social.overview(owner("viewer"));
    expect(overview.rivals.map((r) => r.player.id)).toEqual([ids.nemesis, ids.rival]);
    expect(overview.rivals[0].record).toEqual({ played: 4, wins: 1, draws: 1, losses: 2 });
    expect(JSON.stringify(overview)).not.toContain(prefix);
    expect(JSON.stringify(overview)).not.toContain(matches[0]);
  });
  it("keeps head-to-head in viewer perspective and returns zero for strangers/self", async () => {
    const profile = await social.profile(owner("viewer"), ids.nemesis);
    expect(profile.record).toEqual({ played: 4, wins: 2, draws: 1, losses: 1 });
    expect(profile.headToHead).toEqual({ played: 4, wins: 1, draws: 1, losses: 2 });
    expect((await social.profile(owner("newcomer"), ids.nemesis)).headToHead.played).toBe(0);
    expect((await social.profile(owner("viewer"), ids.viewer)).isSelf).toBe(true);
    expect((await social.profile(owner("viewer"), ids.viewer)).headToHead.played).toBe(0);
  });
  it("filters discovery before counting/paging and treats wildcard text literally", async () => {
    const page = await social.players(owner("viewer"), "NeMeSiS", 0);
    expect(page.items.map((p) => p.id)).toEqual([ids.nemesis]);
    expect(page.total).toBe(1);
    expect((await social.players(owner("viewer"), "NeMeSiS", 20)).items).toEqual([]);
    expect((await social.players(owner("viewer"), "%", 0)).total).toBe(0);
    expect((await social.players(owner("viewer"), "disabled", 0)).total).toBe(0);
    expect((await social.players(owner("viewer"), "guest", 0)).total).toBe(0);
  });
  it("rechecks persisted caller and target eligibility", async () => {
    for (const name of ["guest", "disabled", "missing"]) {
      await expect(social.overview(owner(name))).rejects.toMatchObject({ status: 403 });
    }
    for (const id of [ids.guest, ids.disabled, crypto.randomUUID()])
      await expect(social.profile(owner("viewer"), id)).rejects.toMatchObject({ status: 404 });
  });
  it("reads and searches canonical globally unique handles only from the configured issuer", async () => {
    expect((await social.profile(owner("viewer"), ids.nemesis)).player.username).toBe(handle);
    expect((await social.profile(owner("viewer"), ids.newcomer)).player.username).toBeNull();
    expect(
      (await social.players(owner("viewer"), `@${handle.toUpperCase()}`, 0)).items.map((p) => p.id),
    ).toEqual([ids.nemesis]);
    await expect(
      pool.query(
        `INSERT INTO quorem_auth."user"(id,name,email,username,"createdAt","updatedAt") VALUES($1,'Duplicate',$2,$3,now(),now())`,
        [owner("duplicate"), `${prefix}duplicate@example.test`, handle],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await pool.query('UPDATE quorem_auth."user" SET username=$1 WHERE id=$2', [
      handle + "new",
      owner("auth"),
    ]);
    expect((await social.profile(owner("viewer"), ids.nemesis)).player.username).toBe(
      handle + "new",
    );
  });
});
