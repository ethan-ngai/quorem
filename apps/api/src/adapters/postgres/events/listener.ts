/** @file listener.ts @description Node-only PostgreSQL notification acceleration. @module events */
import { Client } from "pg";

const channels = [
  "quorem_interview_outbox",
  "quorem_match_outbox",
  "quorem_submission_outbox",
  "quorem_membership_outbox",
] as const;
/** Reconnection and periodic repair belong to the caller; notifications are only hints. */
export async function listenForNotices(
  connectionString: string,
  onWake: () => void,
  onFailure: () => void,
): Promise<() => Promise<void>> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  client.on("error", onFailure);
  client.on("end", onFailure);
  client.on("notification", onWake);
  try {
    await client.connect();
    for (const channel of channels) await client.query(`LISTEN ${channel}`);
  } catch {
    await client.end().catch(() => {});
    throw new Error("PostgreSQL listener unavailable");
  }
  return async () => {
    client.removeListener("end", onFailure);
    try {
      await client.end();
    } finally {
      client.removeListener("error", onFailure);
    }
  };
}
