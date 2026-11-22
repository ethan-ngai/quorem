/** @file delivery.ts @description Deliver committed inbox invalidations over existing transports. @module notifications */
import { buildPushPayload, type VapidKeys } from "@block65/webcrypto-web-push";
import type { ConnectionScope } from "@quorem/database/core";
import { sql } from "drizzle-orm";
import type { Notice, NoticeStream } from "../../modules/events/dispatch/ports.ts";
import type { NotificationChange } from "../../modules/notifications/model.ts";
import { browserPushEndpoint } from "../../modules/notifications/subscription.ts";
import {
  notificationRepository,
  pushDeliveryRepository,
} from "../postgres/notifications/repository.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const streams = {
  interviews: "interview",
  matches: "match",
  parties: "party",
  teams: "team",
  submissions: "submission",
} as const;

export function vapidConfig(env: {
  VAPID_SUBJECT?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}): VapidKeys | undefined {
  const {
    VAPID_SUBJECT: subject,
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
  } = env;
  if (subject && publicKey && privateKey) return { subject, publicKey, privateKey };
}

export function notificationDelivery(
  run: Run,
  relay: (stream: NoticeStream, notice: Notice) => Promise<void>,
  vapid?: VapidKeys,
) {
  const delivery = pushDeliveryRepository(run);
  async function live(owner: string) {
    const topics = await run((scope) =>
      scope.transaction(
        { readOnly: true, statementTimeoutMs: 2000, lockTimeoutMs: 1000 },
        async (tx) =>
          (
            await tx.execute<{ topic: string }>(sql`SELECT DISTINCT topic FROM (
        SELECT topic FROM realtime_presence_leases WHERE subject = ${owner} AND expires_at > statement_timestamp()
        UNION ALL
        SELECT '/submissions/' || id::text FROM submissions WHERE owner_id = ${owner}
          AND (state IN ('queued', 'running') OR updated_at > statement_timestamp() - interval '45 seconds')
      ) active LIMIT 32`)
          ).rows,
      ),
    );
    await Promise.allSettled(
      topics.map(async ({ topic }) => {
        const [, prefix, aggregateId] = topic.split("/");
        const stream = streams[prefix as keyof typeof streams];
        if (!stream) return;
        return relay(stream, {
          id: crypto.randomUUID(),
          aggregateId,
          version: "0",
          type: "inbox.changed",
          recipient: owner,
          occurredAt: new Date().toISOString(),
        });
      }),
    );
  }
  async function push(owner: string, id: string) {
    if (!vapid) return;
    const targets = await delivery.targets(id);
    await Promise.allSettled(
      targets.map(async ({ endpoint, keys, kind }) => {
        if (!browserPushEndpoint(endpoint)) return;
        const payload = await buildPushPayload(
          { data: { id, kind }, options: { ttl: 300 } },
          { endpoint, keys, expirationTime: null },
          vapid,
        );
        const response = await fetch(endpoint, {
          ...payload,
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        await response.body?.cancel();
        if (response.status === 404 || response.status === 410)
          await notificationRepository(run).unsubscribe(owner, endpoint);
      }),
    );
  }
  return async ({ owner, id }: NotificationChange) => {
    await Promise.allSettled([live(owner), ...(id ? [push(owner, id)] : [])]);
  };
}
