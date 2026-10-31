/** @file node-notifications.ts @description Reconnect PostgreSQL notification acceleration. @module runtime */
import { listenForNotices } from "../../adapters/postgres/events/listener.ts";
/** PostgreSQL outbox rows remain authoritative while the listener reconnects. */
export async function startNodeNotifications(url: string, wake: () => void, report: () => void) {
  let stopped = false,
    retry: ReturnType<typeof setTimeout> | undefined;
  let close: (() => Promise<void>) | undefined;
  let connecting = false;
  const schedule = () => {
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      void connect().catch(schedule);
    }, 1000);
    retry.unref();
  };
  const failed = () => {
    report();
    const prior = close;
    close = undefined;
    if (prior) void prior().catch(report);
    schedule();
  };
  const connect = async () => {
    if (stopped || connecting) return;
    connecting = true;
    try {
      const next = await listenForNotices(url, wake, failed);
      if (stopped) await next();
      else close = next;
    } finally {
      connecting = false;
    }
  };
  await connect();
  return async () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    await close?.();
  };
}
