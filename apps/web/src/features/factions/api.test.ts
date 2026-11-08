/** @file api.test.ts @description Typed faction transport validation. @module factions */
import { beforeEach, expect, test, vi } from "vitest";
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../api/client", () => ({ api: () => ({ GET: get, POST: post }) }));
import { factionLobby, organizeFactions, teamRequest } from "./api";
beforeEach(() => {
  get.mockReset();
  post.mockReset();
});
test("validates lobby responses and uses typed organization route", async () => {
  get.mockResolvedValue({ response: { ok: true }, data: { teamCount: 2, assignments: [] } });
  expect(await factionLobby("party")).toEqual({ teamCount: 2, assignments: [] });
  post.mockResolvedValue({ response: { ok: true }, data: { teamCount: 2, assignments: [] } });
  await organizeFactions("party", { action: "lock", locked: true });
  expect(post).toHaveBeenCalledWith(
    "/v1/parties/{id}/teams",
    expect.objectContaining({ body: { action: "lock", locked: true } }),
  );
  get.mockResolvedValue({ response: { ok: true }, data: { teamCount: "bad", assignments: [] } });
  await expect(factionLobby("party")).rejects.toThrow();
});
test("rejects malformed team response", async () => {
  get.mockResolvedValue({ response: { ok: true }, data: { team: 1 } });
  await expect(teamRequest("match")).rejects.toThrow();
});
