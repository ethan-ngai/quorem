/** @file target.ts @description Canonical browser socket route classifier. @module runtime */
type SocketStream = "interview" | "match";
export type SocketTarget =
  | { stream: SocketStream; mode: "direct"; id: string }
  | { stream: SocketStream; mode: "invalid" };
export function socketTarget(path: string): SocketTarget | undefined {
  const match = /^\/v1\/(interviews|matches)\/([^/]+)\/events$/.exec(path);
  if (!match) return;
  const stream = (
    {
      interviews: "interview",
      matches: "match",
    } as const
  )[match[1] as "interviews" | "matches"];
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
