/** @file executionGuard.test.ts @description Route transition and keyboard admission boundaries. @module editor */
import { describe, expect, it } from "vitest";
import { canExecuteDocument } from "./executionGuard";

const solo = {
  identity: "alice" as const,
  contextKey: "alice:solo:version",
  problem: { id: "version", slug: "run-widths" },
  workspace: { id: "solo", kind: "solo" as const, problemVersionId: "version" },
  slug: "run-widths",
  loaded: true,
};
const match = {
  ...solo,
  slug: "",
  contextKey: "alice:own-match:version",
  workspace: {
    id: "own-match",
    kind: "match" as const,
    problemVersionId: "version",
    matchId: "first-match",
  },
  match: { id: "first-match", state: "active" as const, problemVersionId: "version" },
  matchWorkspaceId: "own-match",
};

describe("exact document execution guard", () => {
  it("blocks retained solo source during a problem or identity transition", () => {
    expect(canExecuteDocument(solo)).toBe(true);
    expect(canExecuteDocument({ ...solo, slug: "segment-sums" })).toBe(false);
    expect(canExecuteDocument({ ...solo, loaded: false })).toBe(false);
    expect(canExecuteDocument({ ...solo, identity: "bob" })).toBe(false);
  });
  it("blocks retained match workspaces even for the same owner and same problem", () => {
    expect(canExecuteDocument(match)).toBe(true);
    expect(canExecuteDocument({ ...match, match: { ...match.match, id: "second-match" } })).toBe(
      false,
    );
    expect(canExecuteDocument({ ...match, matchWorkspaceId: "other-workspace" })).toBe(false);
    expect(
      canExecuteDocument({
        ...match,
        match: { ...match.match, problemVersionId: "different-version" },
      }),
    ).toBe(false);
  });
  it("blocks new execution after finalizing begins", () => {
    expect(canExecuteDocument({ ...match, match: { ...match.match, state: "finalizing" } })).toBe(
      false,
    );
  });
});
