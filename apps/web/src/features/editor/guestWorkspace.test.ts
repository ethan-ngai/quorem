import { describe, expect, it } from "vitest";
import type { ProblemVersion } from "@quorem/contracts";
import fixture from "../../../../../fixtures/problems/run-widths.json";
import { guestWorkspace } from "./guestWorkspace";
import { browserDraftScope, readBrowserDraft, writeBrowserDraft } from "./recovery";
import type { DevelopmentIdentity } from "@quorem/contracts";
import { vi, afterEach } from "vitest";
afterEach(() => vi.unstubAllGlobals());
describe("guest editing", () => {
  it("creates isolated browser documents in every supported language without a server workspace", () => {
    const problem = fixture.problem as ProblemVersion;
    const scopes = new Set<string>();
    for (const language of ["python", "java", "typescript", "ocaml"] as const) {
      const workspace = guestWorkspace(problem, language);
      expect(workspace).toMatchObject({
        id: `guest:${problem.id}:${language}`,
        problemVersionId: problem.id,
        language,
        kind: "solo",
      });
      scopes.add(browserDraftScope(workspace));
    }
    expect(scopes.size).toBe(4);
  });
  it("keeps guest browser code separate from authenticated accounts", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      setItem: (key: string, value: string) => store.set(key, value),
      getItem: (key: string) => store.get(key) ?? null,
    });
    const problem = fixture.problem as ProblemVersion;
    const scope = browserDraftScope(guestWorkspace(problem, "java"));
    writeBrowserDraft("anonymous" as DevelopmentIdentity, scope, problem.id, "guest code");
    expect(readBrowserDraft("anonymous" as DevelopmentIdentity, scope, problem.id)).toBe(
      "guest code",
    );
    expect(readBrowserDraft("alice", scope, problem.id)).toBeUndefined();
  });
});
