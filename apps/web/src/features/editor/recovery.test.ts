import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserDraftScope,
  importBrowserDrafts,
  readBrowserDraft,
  writeBrowserDraft,
} from "./recovery";

describe("browser drafts", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("resumes an empty practice draft across recreated server workspace IDs", () => {
    const oldScope = browserDraftScope({ id: "old-server-id", kind: "solo" });
    const newScope = browserDraftScope({ id: "new-server-id", kind: "solo" });
    writeBrowserDraft("alice", oldScope, "version", "");
    expect(readBrowserDraft("alice", newScope, "version")).toBe("");
  });

  it("isolates identities, immutable versions, and match workspaces", () => {
    writeBrowserDraft("alice", "match-one", "version", "private");
    expect(readBrowserDraft("bob", "match-one", "version")).toBeUndefined();
    expect(readBrowserDraft("alice", "match-two", "version")).toBeUndefined();
    expect(readBrowserDraft("alice", "match-one", "new-version")).toBeUndefined();
  });

  it("lets windows keep independent buffers while the latest write resumes on reload", () => {
    writeBrowserDraft("alice", "solo", "version", "initial");
    const firstWindow = readBrowserDraft("alice", "solo", "version");
    writeBrowserDraft("alice", "solo", "version", "second window edits");
    expect(firstWindow).toBe("initial");
    expect(readBrowserDraft("alice", "solo", "version")).toBe("second window edits");
  });

  it("falls back safely when latest storage is malformed or unavailable", () => {
    localStorage.setItem("quorem.browser-draft.v1:alice:solo:version:python", "broken");
    expect(readBrowserDraft("alice", "solo", "version")).toBeUndefined();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage disabled");
      },
    });
    expect(readBrowserDraft("alice", "solo", "version")).toBeUndefined();
  });
  it("does not overwrite local drafts when importing a legacy export", async () => {
    writeBrowserDraft("alice", "solo", "version", "newer local code");
    const exportFile = JSON.stringify({
      workspaces: [
        {
          identity: "alice",
          kind: "solo",
          workspaceId: "legacy",
          problemVersionId: "version",
          source: "older server code",
        },
        {
          identity: "bob",
          kind: "solo",
          workspaceId: "foreign",
          problemVersionId: "foreign",
          source: "private bob",
        },
      ],
    });
    expect(await importBrowserDrafts(exportFile, "alice")).toBe(0);
    expect(readBrowserDraft("alice", "solo", "version")).toBe("newer local code");
    expect(readBrowserDraft("alice", "solo", "foreign")).toBeUndefined();
  });
});
