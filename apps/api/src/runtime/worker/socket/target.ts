/** @file target.ts @description Canonical browser socket route classifier. @module runtime */
type SocketStream = "interview" | "match" | "party" | "team";
export type SocketTarget =
  | { stream: SocketStream; mode: "direct"; id: string; team?: number }
  | { stream: SocketStream; mode: "invalid" };
export const roomScope = (id: string, team?: number) => (team === undefined ? id : `${id}:${team}`);

export function socketTarget(path: string): SocketTarget | undefined {
  const match = /^\/v1\/(interviews|matches|parties)\/([^/]+)(?:\/team\/([^/]+))?\/events$/.exec(
    path,
  );
  if (!match) return;
  const stream =
    match[3] === undefined
      ? (
          {
            interviews: "interview",
            matches: "match",
            parties: "party",
          } as const
        )[match[1] as "interviews" | "matches" | "parties"]
      : "team";
  if (stream === "team" && (match[1] !== "matches" || !/^[1-4]$/.test(match[3])))
    return { stream, mode: "invalid" };
  let id: string;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    return { stream, mode: "invalid" };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return { stream, mode: "invalid" };
  return {
    stream,
    mode: "direct",
    id: id.toLowerCase(),
    ...(stream === "team" ? { team: Number(match[3]) } : {}),
  };
}
