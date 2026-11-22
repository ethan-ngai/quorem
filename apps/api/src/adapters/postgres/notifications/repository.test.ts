/** @file repository.test.ts @description Disposable PostgreSQL inbox and targeted join checks. @module notifications */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { notificationRepository, pushDeliveryRepository } from "./repository.ts";
import { partyRepository } from "../parties/repository.ts";
import { prearmReceipts } from "../events/scheduling/prearm.ts";
import { retainBatch } from "../events/scheduling/retention.ts";
import { normalizePartySettings } from "../../../modules/parties/model.ts";

const url = process.env.QUOREM_SOCIAL_TEST_DATABASE_URL;
describe.skipIf(!url)("notification lifecycle", () => {
  let pool: ReturnType<typeof createNodePool>;
  const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
    withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
  const inbox = notificationRepository(run);
  const prefix = crypto.randomUUID();
  const ids = ["a", "b", "c"].map(() => crypto.randomUUID());
  const owner = (index: number) => `${prefix}:${index}`;
  const user = (index: number) => ({
    kind: "local" as const,
    userId: owner(index),
    displayName: `Player ${index}`,
    admin: false,
    emailVerified: true,
    sessionId: owner(index),
    strongUntil: 0,
  });
  const party = partyRepository(
    run,
    new Uint8Array(32),
    {
      prearm: async () => {},
      wake: async () => {},
    },
    1,
    prearmReceipts(run),
  );
  let partyId: string;

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
      max: 4,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    await migrate(pool, "product", resolve("migrations"));
    for (const [index, id] of ids.entries())
      await pool.query(
        "INSERT INTO users(id,participant_id,display_name,profile_image) VALUES ($1,$2,$3,$4)",
        [owner(index), id, user(index).displayName, "/api/auth/sample-avatar"],
      );
    const created = await party.create(
      user(0),
      "create",
      normalizePartySettings({ difficulty: "easy" }),
    );
    partyId = (created as { party: { id: string } }).party.id;
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("isolates unread counts, marks items on open, and joins atomically", async () => {
    await expect(inbox.invite(owner(0), partyId, ids[1])).rejects.toMatchObject({ status: 404 });
    const race = await Promise.all([
      inbox.friend(owner(0), ids[1], "request"),
      inbox.friend(owner(0), ids[1], "request"),
    ]);
    expect(race.filter(Boolean)).toHaveLength(1);
    await expect(inbox.unread(owner(1))).resolves.toBe(1);
    await expect(inbox.unread(owner(2))).resolves.toBe(0);
    const opened = await inbox.inbox(owner(1), true);
    expect(opened.unread).toBe(0);
    expect(opened.items[0].sender.image).toBe("/api/auth/sample-avatar");
    expect((await inbox.inbox(owner(1), true)).items[0].read).toBe(true);
    await inbox.friend(owner(1), ids[0], "accept");
    await expect(inbox.inbox(owner(1), true)).resolves.toEqual({ items: [], unread: 0 });

    const invite = await inbox.invite(owner(0), partyId, ids[1]);
    const id = invite!.id!;
    expect((await inbox.inbox(owner(1), false)).items[0]).toMatchObject({ id, mode: "showdown" });
    await expect(party.acceptDirectInvite(user(2), "accept", id)).rejects.toMatchObject({
      status: 404,
    });
    await party.mutate(
      user(0),
      partyId,
      "lock",
      "settings",
      normalizePartySettings({ difficulty: "easy", admissionLocked: true }),
    );
    await expect(party.acceptDirectInvite(user(1), "accept", id)).rejects.toMatchObject({
      status: 409,
    });
    await expect(inbox.unread(owner(1))).resolves.toBe(1);
    await party.mutate(
      user(0),
      partyId,
      "unlock",
      "settings",
      normalizePartySettings({ difficulty: "easy", admissionLocked: false }),
    );
    const joined = await party.acceptDirectInvite(user(1), "accept", id);
    expect(joined).toMatchObject({ id: partyId });
    await expect(party.acceptDirectInvite(user(1), "accept", id)).resolves.toMatchObject({
      id: partyId,
    });
    await expect(inbox.unread(owner(1))).resolves.toBe(0);
  });

  it("honors push preferences and deletes dismissed, blocked and old notifications", async () => {
    const pending = await inbox.friend(owner(2), ids[0], "request");
    const id = pending!.id!;
    const endpoint = "https://fcm.googleapis.com/fcm/send/fixture";
    await inbox.subscribe(owner(0), { endpoint, keys: { auth: "auth", p256dh: "p256dh" } });
    await expect(pushDeliveryRepository(run).targets(id)).resolves.toHaveLength(0);
    await inbox.setPreferences(owner(0), { friend_request: true, match_invite: false });
    await expect(pushDeliveryRepository(run).targets(id)).resolves.toHaveLength(1);
    await inbox.dismiss(owner(1), id);
    await expect(inbox.unread(owner(0))).resolves.toBe(1);
    await inbox.friend(owner(0), ids[2], "block");
    await expect(inbox.unread(owner(0))).resolves.toBe(0);
    await expect(inbox.friend(owner(2), ids[0], "request")).rejects.toMatchObject({ status: 404 });
    await inbox.friend(owner(0), ids[2], "unblock");
    const again = await inbox.friend(owner(2), ids[0], "request");
    await pool.query(
      "UPDATE inbox_notifications SET created_at = now() - interval '14 days' WHERE id = $1",
      [again!.id],
    );
    await expect(inbox.unread(owner(0))).resolves.toBe(0);
    await retainBatch(run);
    expect(
      (await pool.query("SELECT id FROM inbox_notifications WHERE id = $1", [again!.id])).rowCount,
    ).toBe(0);
  });
});
