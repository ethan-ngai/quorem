/** @file repository.ts @description Durable, account-scoped inbox and relationship writes. @module notifications */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import type {
  ContactState,
  InboxItem,
  SocialContact,
  NotificationKind,
  BrowserPushSubscription,
} from "@quorem/contracts/notifications";
import { ApplicationError } from "../../../application/error.ts";
import type { Notifications } from "../../../modules/notifications/model.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1500 };
const recent = sql`n.created_at > statement_timestamp() - interval '14 days'`;
const valid = sql`${recent} AND NOT u.disabled AND (
  n.kind = 'friend_request' OR (p.disbanded_at IS NULL AND p.host_owner_id = n.sender_id)
)`;
const fromInbox = sql`FROM inbox_notifications n JOIN users u ON u.id = n.sender_id
  LEFT JOIN parties p ON p.id = n.party_id`;
const missing = () => new ApplicationError("not_found", "Invitation or player unavailable", 404);
const conflict = (message: string) => new ApplicationError("invalid_transition", message, 409);

function pair(owner: string, target: string) {
  return owner < target ? [owner, target] : [target, owner];
}

async function lockPair(tx: Transaction, owner: string, target: string) {
  const [first, second] = pair(owner, target);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${first}), hashtext(${second}))`);
  return sql`first_owner_id = ${first} AND second_owner_id = ${second}`;
}

async function blocked(tx: Transaction, owner: string, target: string) {
  return (
    (
      await tx.execute(sql`SELECT 1 FROM social_blocks
    WHERE (owner_id, blocked_owner_id) IN ((${owner}, ${target}), (${target}, ${owner}))`)
    ).rows.length > 0
  );
}

async function targetOwner(tx: Transaction, player: string, owner: string) {
  const result = await tx.execute<{ id: string }>(sql`SELECT id FROM users
    WHERE participant_id = ${player}::uuid AND kind = 'account' AND NOT disabled AND id <> ${owner}`);
  if (!result.rows[0]) throw missing();
  return result.rows[0].id;
}

async function checkRate(tx: Transaction, sender: string, kind: NotificationKind) {
  const result = await tx.execute(sql`
    INSERT INTO social_notification_limits AS limits (owner_id, kind, window_start, count)
    VALUES (${sender}, ${kind}, statement_timestamp(), 1)
    ON CONFLICT (owner_id, kind) DO UPDATE SET
      count = CASE WHEN limits.window_start < statement_timestamp() - interval '1 minute'
        THEN 1 ELSE limits.count + 1 END,
      window_start = CASE WHEN limits.window_start < statement_timestamp() - interval '1 minute'
        THEN statement_timestamp() ELSE limits.window_start END
    WHERE limits.count < 12 OR limits.window_start < statement_timestamp() - interval '1 minute'
    RETURNING count`);
  if (!result.rows.length)
    throw new ApplicationError("rate_limited", "Too many requests. Try again shortly.", 429);
}

async function insert(
  tx: Transaction,
  owner: string,
  sender: string,
  kind: NotificationKind,
  party: string | null,
) {
  const result = await tx.execute<{
    id: string;
  }>(sql`INSERT INTO inbox_notifications(owner_id, sender_id, kind, party_id)
    VALUES (${owner}, ${sender}, ${kind}, ${party}::uuid) ON CONFLICT DO NOTHING RETURNING id`);
  return result.rows[0] && { owner, id: result.rows[0].id };
}

export async function directInvitationParty(tx: Transaction, owner: string, id: string) {
  const result = await tx.execute<{ party: string; sender: string }>(sql`
    SELECT party_id AS party, sender_id AS sender FROM inbox_notifications n
    WHERE owner_id = ${owner} AND id = ${id}::uuid AND kind = 'match_invite' AND ${recent}`);
  const invite = result.rows[0];
  if (!invite) throw missing();
  const relation = await lockPair(tx, owner, invite.sender);
  const accepted = await tx.execute(
    sql`SELECT 1 FROM friendships WHERE ${relation} AND accepted_at IS NOT NULL`,
  );
  if (!accepted.rows.length || (await blocked(tx, owner, invite.sender))) throw missing();
  const pending = await tx.execute(
    sql`SELECT 1 FROM inbox_notifications WHERE id = ${id}::uuid FOR UPDATE`,
  );
  if (!pending.rows.length) throw missing();
  return invite;
}

export async function removeJoinedInboxInvites(tx: Transaction, owner: string, party: string) {
  await tx.execute(
    sql`DELETE FROM inbox_notifications WHERE owner_id = ${owner} AND party_id = ${party}::uuid`,
  );
}

export function notificationRepository(run: Run): Notifications {
  const transact = <T>(fn: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction(options, fn));
  const unread = async (tx: Transaction, owner: string) =>
    (
      await tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count ${fromInbox}
      WHERE n.owner_id = ${owner} AND n.read_at IS NULL AND ${valid}`)
    ).rows[0].count;
  return {
    inbox: (owner, markRead) =>
      transact(async (tx) => {
        const items = (
          await tx.execute<{ item: InboxItem }>(sql`
        SELECT jsonb_strip_nulls(jsonb_build_object('id', n.id, 'kind', n.kind, 'createdAt', n.created_at,
          'mode', CASE WHEN n.kind = 'match_invite' THEN COALESCE(p.settings->>'mode', 'showdown') END,
          'read', n.read_at IS NOT NULL, 'sender', jsonb_build_object('id', u.participant_id, 'displayName', u.display_name,
            'image', NULLIF(u.profile_image, ''), 'color', NULLIF(u.profile_color, 0)))) AS item
        ${fromInbox} WHERE n.owner_id = ${owner} AND ${valid}
        ORDER BY n.created_at DESC, n.id DESC`)
        ).rows.map(({ item }) => item);
        if (markRead && items.some((item) => !item.read)) {
          await tx.execute(sql`UPDATE inbox_notifications SET read_at = statement_timestamp()
          WHERE owner_id = ${owner} AND read_at IS NULL AND id IN
          (${sql.join(
            items.filter((item) => !item.read).map((item) => sql`${item.id}::uuid`),
            sql`, `,
          )})`);
        }
        return { items, unread: await unread(tx, owner) };
      }),
    unread: (owner) => transact((tx) => unread(tx, owner)),
    dismiss: (owner, id) =>
      transact(async (tx) => {
        await tx.execute(
          sql`DELETE FROM inbox_notifications WHERE owner_id = ${owner} AND id = ${id}::uuid`,
        );
      }),
    contacts: (owner) =>
      transact(
        async (tx) =>
          (
            await tx.execute<SocialContact>(sql`
      SELECT u.participant_id AS id, u.display_name AS "displayName" FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.first_owner_id = ${owner} THEN f.second_owner_id ELSE f.first_owner_id END
      WHERE ${owner} IN (f.first_owner_id, f.second_owner_id) AND f.accepted_at IS NOT NULL
      AND NOT u.disabled ORDER BY lower(u.display_name), u.participant_id`)
          ).rows,
      ),
    contact: (owner, player) =>
      transact(async (tx): Promise<ContactState> => {
        const target = await targetOwner(tx, player, owner);
        const [first, second] = pair(owner, target);
        if (
          (
            await tx.execute(
              sql`SELECT 1 FROM social_blocks WHERE owner_id = ${owner} AND blocked_owner_id = ${target}`,
            )
          ).rows.length
        )
          return "blocked";
        const row = (
          await tx.execute<{
            requester_id: string;
            accepted_at: Date | null;
          }>(sql`SELECT requester_id, accepted_at
        FROM friendships WHERE first_owner_id = ${first} AND second_owner_id = ${second}`)
        ).rows[0];
        return !row
          ? "none"
          : row.accepted_at
            ? "friend"
            : row.requester_id === owner
              ? "outgoing"
              : "incoming";
      }),
    friend: (owner, player, action) =>
      transact(async (tx) => {
        const target = await targetOwner(tx, player, owner);
        const relation = await lockPair(tx, owner, target);
        if (action === "unblock") {
          await tx.execute(
            sql`DELETE FROM social_blocks WHERE owner_id = ${owner} AND blocked_owner_id = ${target}`,
          );
          return;
        }
        const row = (
          await tx.execute<{ requester_id: string; accepted_at: Date | null }>(sql`
        SELECT requester_id, accepted_at FROM friendships WHERE ${relation}`)
        ).rows[0];
        if (action === "request") {
          if (await blocked(tx, owner, target)) throw missing();
          if (row) return;
          await checkRate(tx, owner, "friend_request");
          const [first, second] = pair(owner, target);
          await tx.execute(sql`INSERT INTO friendships(first_owner_id, second_owner_id, requester_id)
          VALUES (${first}, ${second}, ${owner})`);
          return insert(tx, target, owner, "friend_request", null);
        }
        if (action === "accept") {
          if (row?.accepted_at) return;
          if (row?.requester_id !== target || (await blocked(tx, owner, target))) throw missing();
          await tx.execute(
            sql`UPDATE friendships SET accepted_at = statement_timestamp() WHERE ${relation}`,
          );
        } else {
          if (action === "decline" && (row?.accepted_at || row?.requester_id !== target)) return;
          if (action === "block")
            await tx.execute(sql`INSERT INTO social_blocks(owner_id, blocked_owner_id)
          VALUES (${owner}, ${target}) ON CONFLICT DO NOTHING`);
          await tx.execute(sql`DELETE FROM friendships WHERE ${relation}`);
        }
        await tx.execute(sql`DELETE FROM inbox_notifications
        WHERE (owner_id, sender_id) IN ((${owner}, ${target}), (${target}, ${owner}))
          AND (${action !== "accept"} OR kind = 'friend_request')`);
        return { owner: target };
      }),
    invite: (owner, party, player) =>
      transact(async (tx) => {
        const target = await targetOwner(tx, player, owner);
        const relation = await lockPair(tx, owner, target);
        const friends = await tx.execute(
          sql`SELECT 1 FROM friendships WHERE ${relation} AND accepted_at IS NOT NULL`,
        );
        if (!friends.rows.length || (await blocked(tx, owner, target))) throw missing();
        const lobby = await tx.execute(sql`SELECT 1 FROM parties
        WHERE id = ${party}::uuid AND host_owner_id = ${owner} AND disbanded_at IS NULL
          AND COALESCE((settings->>'admissionLocked')::boolean, false) = false FOR UPDATE`);
        if (!lobby.rows.length) throw conflict("Open your lobby to invite friends.");
        await tx.execute(sql`DELETE FROM inbox_notifications n
        WHERE owner_id = ${target} AND party_id = ${party}::uuid AND (sender_id <> ${owner} OR NOT (${recent}))`);
        const change = await insert(tx, target, owner, "match_invite", party);
        if (change) await checkRate(tx, owner, "match_invite");
        return change;
      }),
    preferences: (owner) =>
      transact(
        async (tx) =>
          (
            await tx.execute<{ friend_request: boolean; match_invite: boolean }>(sql`
      SELECT push_friend_requests AS friend_request, push_match_invites AS match_invite
      FROM notification_preferences WHERE owner_id = ${owner}`)
          ).rows[0] ?? { friend_request: false, match_invite: false },
      ),
    setPreferences: (owner, value) =>
      transact(async (tx) => {
        await tx.execute(sql`INSERT INTO notification_preferences VALUES (${owner}, ${value.friend_request}, ${value.match_invite})
        ON CONFLICT (owner_id) DO UPDATE SET push_friend_requests = excluded.push_friend_requests,
          push_match_invites = excluded.push_match_invites`);
      }),
    subscribe: (owner, value) =>
      transact(async (tx) => {
        await tx.execute(sql`INSERT INTO push_subscriptions(endpoint, owner_id, p256dh, auth)
        VALUES (${value.endpoint}, ${owner}, ${value.keys.p256dh}, ${value.keys.auth})
        ON CONFLICT (endpoint) DO UPDATE SET owner_id = excluded.owner_id, p256dh = excluded.p256dh, auth = excluded.auth
        WHERE push_subscriptions.owner_id = excluded.owner_id OR
          (push_subscriptions.p256dh = excluded.p256dh AND push_subscriptions.auth = excluded.auth)`);
      }),
    unsubscribe: (owner, endpoint) =>
      transact(async (tx) => {
        await tx.execute(
          sql`DELETE FROM push_subscriptions WHERE owner_id = ${owner} AND endpoint = ${endpoint}`,
        );
      }),
  };
}

export function pushDeliveryRepository(run: Run) {
  return {
    targets: (id: string) =>
      run((scope) =>
        scope.transaction(
          options,
          async (tx) =>
            (
              await tx.execute<{
                endpoint: string;
                keys: BrowserPushSubscription["keys"];
                kind: NotificationKind;
              }>(sql`
        SELECT s.endpoint, jsonb_build_object('p256dh',s.p256dh,'auth',s.auth) AS keys, n.kind
        ${fromInbox} JOIN users recipient ON recipient.id = n.owner_id AND NOT recipient.disabled
        JOIN push_subscriptions s ON s.owner_id = n.owner_id
        JOIN notification_preferences pref ON pref.owner_id = n.owner_id
        WHERE n.id = ${id}::uuid AND ${valid} AND (CASE n.kind WHEN 'friend_request' THEN pref.push_friend_requests ELSE pref.push_match_invites END)
        ORDER BY s.created_at DESC LIMIT 16`)
            ).rows,
        ),
      ),
  };
}
