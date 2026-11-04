/** @file target.ts @description Canonical browser socket route classifier. @module runtime */
import type { NoticeStream } from "../../../modules/events/dispatch/ports.ts";
export type SocketTarget =
  | { stream: NoticeStream; mode: "direct"; id: string }
  | { stream: NoticeStream; mode: "invalid" };
export function socketTarget(path: string): SocketTarget | undefined {
  const match = /^\/v1\/(interviews|matches|submissions)\/([^/]+)\/events$/.exec(path);
  if (!match) return;
  const stream = (
    {
      interviews: "interview",
      matches: "match",
      submissions: "submission",
    } as const
  )[match[1] as "interviews" | "matches" | "submissions"];
  let id: string;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    return { stream, mode: "invalid" };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return { stream, mode: "invalid" };
  return { stream, mode: "direct", id: id.toLowerCase() };
}
