/** @file target.ts @description Canonical browser socket route classifier. @module runtime */
import type { NoticeStream } from "../../../modules/events/dispatch/ports.ts";
export type SocketTarget = {
  stream: NoticeStream;
  mode: "direct" | "membership" | "invite" | "invalid";
  id?: string;
};
export function socketTarget(path: string): SocketTarget | undefined {
  if (path === "/v1/memberships/events") return { stream: "membership", mode: "membership" };
  const match = /^\/v1\/(interviews|matches|match-invites|submissions)\/([^/]+)\/events$/.exec(
    path,
  );
  if (!match) return;
  const stream = (
    {
      interviews: "interview",
      matches: "match",
      "match-invites": "match",
      submissions: "submission",
    } as const
  )[match[1] as "interviews" | "matches" | "match-invites" | "submissions"];
  let id: string;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    return { stream, mode: "invalid" };
  }
  if (match[1] === "match-invites") return { stream, mode: "invite" };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return { stream, mode: "invalid" };
  return { stream, mode: "direct", id: id.toLowerCase() };
}
