import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserDraftWriter,
  browserDraftScope,
  importBrowserDrafts,
  readBrowserDraft,
  writeBrowserDraft,
  writeRecovery,
  readBrowserHistory,
  readLatestRecovery,
  scopeKey,
  type RecoverySnapshot,
} from "./recovery";

describe("browser drafts", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const snapshots: RecoverySnapshot[] = [];
    let nextId = 1;
    const database = {
      close() {},
      transaction() {
        const transaction: { oncomplete?: () => void; objectStore: () => unknown } = {
          objectStore: () => ({
            add(snapshot: RecoverySnapshot) {
              snapshots.push({ ...snapshot, id: nextId++ });
              queueMicrotask(() => transaction.oncomplete?.());
            },
            index: () => ({
              getAll(scope: string) {
                const request: { result: RecoverySnapshot[]; onsuccess?: () => void } = {
                  result: snapshots.filter((snapshot) => snapshot.scope === scope),
                };
                queueMicrotask(() => request.onsuccess?.());
                return request;
              },
            }),
          }),
        };
        return transaction;
      },
    };
    vi.stubGlobal("indexedDB", {
      open() {
        const request: { result: typeof database; onsuccess?: () => void } = { result: database };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("resumes an empty practice draft across recreated server workspace IDs", () => {
    const oldScope = browserDraftScope({ id: "old-server-id", kind: "solo" });
    const newScope = browserDraftScope({ id: "new-server-id", kind: "solo" });
    writeBrowserDraft("alice", oldScope, "version", "");
    expect(readBrowserDraft("alice", newScope, "version")).toBe("");
  });

  it("keeps all four language drafts and histories distinct across recreated solo workspaces", async () => {
    const languages = ["python", "java", "typescript", "ocaml"] as const;
    const scopes = languages.map((language) =>
      browserDraftScope({ id: "same-workspace", kind: "solo", language }),
    );
    expect(scopes).toEqual(["solo", "solo:java", "solo:typescript", "solo:ocaml"]);
    expect(new Set(scopes.map((scope) => scopeKey("alice", scope, "same-version"))).size).toBe(4);
    for (const language of languages) {
      const scope = browserDraftScope({ id: "old-workspace", kind: "solo", language });
      writeBrowserDraft("alice", scope, "same-version", `${language} draft`);
      await writeRecovery("alice", scope, "same-version", `${language} first`);
      await writeRecovery("alice", scope, "same-version", `${language} latest`);
    }
    for (const language of languages) {
      const scope = browserDraftScope({ id: "new-workspace", kind: "solo", language });
      expect(readBrowserDraft("alice", scope, "same-version")).toBe(`${language} draft`);
      expect(
        (await readBrowserHistory("alice", scope, "same-version")).map(({ source }) => source),
      ).toEqual([`${language} latest`, `${language} first`]);
      expect((await readLatestRecovery("alice", scope, "same-version")).source).toBe(
        `${language} latest`,
      );
    }
    expect(readBrowserDraft("alice", "solo", "same-version")).toBe("python draft");
    expect(readBrowserDraft("bob", "solo:java", "same-version")).toBeUndefined();
    expect(await readBrowserHistory("alice", "solo:java", "different-version")).toEqual([]);
    expect(browserDraftScope({ id: "match-python", kind: "match", language: "python" })).toBe(
      "match-python",
    );
    expect(browserDraftScope({ id: "match-java", kind: "match", language: "java" })).toBe(
      "match-java",
    );
  });

  it("preserves legacy Python drafts and history without inferring another language", async () => {
    writeBrowserDraft("alice", "solo", "version", "legacy Python buffer");
    await writeRecovery("alice", "solo", "version", "legacy Python history");
    const python = browserDraftScope({ id: "new-python", kind: "solo", language: "python" });
    const java = browserDraftScope({ id: "new-java", kind: "solo", language: "java" });
    expect(readBrowserDraft("alice", python, "version")).toBe("legacy Python buffer");
    expect((await readBrowserHistory("alice", python, "version"))[0].source).toBe(
      "legacy Python history",
    );
    expect(readBrowserDraft("alice", java, "version")).toBeUndefined();
    expect(await readBrowserHistory("alice", java, "version")).toEqual([]);
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

describe("browser draft write scheduling", () => {
  let frameCallback: FrameRequestCallback | undefined;
  let write: ReturnType<typeof vi.fn>;
  const draft = { identity: "alice" as const, workspaceId: "solo", version: "v1", source: "one" };
  beforeEach(() => {
    vi.useFakeTimers();
    frameCallback = undefined;
    write = vi.fn();
    vi.stubGlobal("localStorage", { setItem: write });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frameCallback = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("coalesces edits without serialization or storage before cursor paint", () => {
    const writer = createBrowserDraftWriter(vi.fn());
    writer.schedule(draft);
    writer.schedule({ ...draft, source: "two" });
    expect(write).not.toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    frameCallback?.(0);
    expect(write).not.toHaveBeenCalled();
    writer.schedule({ ...draft, source: "latest" });
    vi.runAllTimers();
    expect(write).toHaveBeenCalledExactlyOnceWith(
      "quorem.browser-draft.v1:alice:solo:v1:python",
      JSON.stringify({ source: "latest" }),
    );
  });

  it("flushes pending latest edits immediately for navigation or page closure", () => {
    const writer = createBrowserDraftWriter(vi.fn());
    writer.schedule(draft);
    writer.schedule({ ...draft, source: "" });
    writer.flush();
    expect(write).toHaveBeenCalledExactlyOnceWith(
      "quorem.browser-draft.v1:alice:solo:v1:python",
      JSON.stringify({ source: "" }),
    );
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    writer.flush();
    vi.runAllTimers();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("cancels the post-paint task when a lifecycle boundary flushes first", () => {
    const writer = createBrowserDraftWriter(vi.fn());
    writer.schedule(draft);
    frameCallback?.(0);
    writer.flush();
    vi.runAllTimers();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("reports storage errors while retaining the newest snapshot for retry", () => {
    const error = new Error("quota exceeded");
    write.mockImplementationOnce(() => {
      throw error;
    });
    const onError = vi.fn();
    const writer = createBrowserDraftWriter(onError);
    writer.schedule(draft);
    frameCallback?.(0);
    vi.runAllTimers();
    expect(onError).toHaveBeenCalledExactlyOnceWith(error, draft);
    writer.schedule({ ...draft, source: "newer" });
    writer.flush();
    expect(write).toHaveBeenLastCalledWith(
      "quorem.browser-draft.v1:alice:solo:v1:python",
      JSON.stringify({ source: "newer" }),
    );
  });
});
