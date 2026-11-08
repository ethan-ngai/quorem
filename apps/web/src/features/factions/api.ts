/** @file api.ts @description Authenticated team requests with stable command identities. @module factions */
import { z } from "zod";
import { api } from "../../api/client";
import { randomUUID } from "../../randomUUID";

export class TeamError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const object = z.record(z.string(), z.unknown());
const position = z.object({ epoch: z.string(), version: z.number().int().nonnegative() });
const updates = position.extend({
  updates: z.array(z.object({ clientID: z.string(), changes: z.array(z.unknown()) })),
});
const peer = position.extend({
  clientID: z.string(),
  userId: z.string(),
  name: z.string(),
  color: z.number().nullish(),
  anchor: z.number(),
  head: z.number(),
});
const documentPosition = {
  documentEpoch: z.string(),
  documentVersion: z.number().int().nonnegative(),
};
const reveal = z.object({
  kind: z.literal("reveal"),
  target: z.enum(["topics", "complexity", "case"]),
  caseIndex: z.number().int().optional(),
  submissionId: z.string().optional(),
});
const actionInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("submit") }),
  reveal,
  z.object({ kind: z.literal("concede") }),
  z.object({ kind: z.literal("reset"), ...documentPosition }),
  z.object({ kind: z.literal("language"), language: z.string(), ...documentPosition }),
]);
const presenceInput = position.extend({
  clientID: z.string(),
  anchor: z.number().int(),
  head: z.number().int(),
});
const vote = z.object({
  id: z.string(),
  proposerId: z.string(),
  electorate: z.array(z.string()),
  ballots: z.record(z.string(), z.boolean()),
  quote: object,
  state: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  resolvedAt: z.number().optional(),
});
const snapshot = z.object({
  team: z.number(),
  workspaceId: z.string(),
  language: z.string(),
  serverNow: z.number(),
  document: position.extend({ source: z.string() }),
  members: z.array(z.object({ userId: z.string(), name: z.string() })),
  votes: z.array(vote),
  peers: z.array(peer),
  latestSubmissionId: z.string().optional(),
});
export async function teamRequest<T>(
  id: string,
  action?: string,
  body?: unknown,
  key = randomUUID(),
): Promise<T> {
  const client = api(),
    params = { path: { id }, header: { "Idempotency-Key": key } };
  const input = body ?? {};
  let result;
  switch (action) {
    case undefined:
      result = await client.GET("/v1/matches/{id}/team", { params: { path: { id } } });
      break;
    case "pull":
      result = await client.POST("/v1/matches/{id}/team/pull", {
        params,
        body: position.parse(input),
      });
      break;
    case "push":
      result = await client.POST("/v1/matches/{id}/team/push", {
        params,
        body: updates.parse(input),
      });
      break;
    case "presence":
      result = await client.POST("/v1/matches/{id}/team/presence", {
        params,
        body: presenceInput.parse(input),
      });
      break;
    case "propose":
      result = await client.POST("/v1/matches/{id}/team/propose", {
        params,
        body: z.object({ action: actionInput }).parse(input),
      });
      break;
    case "vote":
      result = await client.POST("/v1/matches/{id}/team/vote", {
        params,
        body: z.object({ id: z.string(), approve: z.boolean() }).parse(input),
      });
      break;
    case "cancel":
      result = await client.POST("/v1/matches/{id}/team/cancel", {
        params,
        body: z.object({ id: z.string() }).parse(input),
      });
      break;
    default:
      throw new TeamError("invalid_input", "Unknown faction action");
  }
  if (result.error || !result.response.ok) {
    const detail = result.error?.error;
    throw new TeamError(detail?.code ?? "unavailable", detail?.message ?? "Faction action failed");
  }
  const schema = !action
    ? snapshot
    : action === "pull" || action === "push"
      ? updates
      : action === "presence"
        ? z.array(peer)
        : vote;
  return schema.parse(result.data) as T;
}

const lobby = z.object({
  teamCount: z.number().int(),
  assignments: z.array(z.object({ userId: z.string(), team: z.number().int().nullable() })),
  names: z.array(z.string()).optional(),
});
const organize = z.discriminatedUnion("action", [
  z.object({ action: z.literal("balance") }),
  z.object({ action: z.literal("create") }),
  z.object({ action: z.literal("delete"), team: z.number().int() }),
  z.object({ action: z.literal("rename"), team: z.number().int(), name: z.string() }),
  z.object({ action: z.literal("assign"), userId: z.string(), team: z.number().int() }),
  z.object({ action: z.literal("lock"), locked: z.boolean() }),
]);
export async function factionLobby(id: string) {
  const result = await api().GET("/v1/parties/{id}/teams", { params: { path: { id } } });
  if (!result.response.ok)
    throw new TeamError(
      result.error?.error?.code ?? "unavailable",
      result.error?.error?.message ?? "Factions unavailable",
    );
  return lobby.parse(result.data);
}
export async function organizeFactions(id: string, body: unknown) {
  const result = await api().POST("/v1/parties/{id}/teams", {
    params: { path: { id }, header: { "Idempotency-Key": randomUUID() } },
    body: organize.parse(body),
  });
  if (!result.response.ok)
    throw new TeamError(
      result.error?.error?.code ?? "unavailable",
      result.error?.error?.message ?? "Factions unavailable",
    );
  return lobby.parse(result.data);
}
