import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserDraftWriter,
  browserDraftScope,
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

  it("keeps language autosaves distinct across recreated solo workspaces", () => {
    const languages = ["python", "java", "typescript", "ocaml"] as const;
    const scopes = languages.map((language) =>
      browserDraftScope({ id: "same-workspace", kind: "solo", language }),
    );
    expect(scopes).toEqual(["solo", "solo:java", "solo:typescript", "solo:ocaml"]);
    for (const language of languages) {
      const scope = browserDraftScope({ id: "old-workspace", kind: "solo", language });
      writeBrowserDraft("alice", scope, "same-version", `${language} draft`);
    }
    for (const language of languages) {
      const scope = browserDraftScope({ id: "new-workspace", kind: "solo", language });
      expect(readBrowserDraft("alice", scope, "same-version")).toBe(`${language} draft`);
    }
    expect(readBrowserDraft("alice", "solo", "same-version")).toBe("python draft");
    expect(readBrowserDraft("bob", "solo:java", "same-version")).toBeUndefined();
    expect(browserDraftScope({ id: "match-python", kind: "match", language: "python" })).toBe(
      "match-python",
    );
    expect(browserDraftScope({ id: "match-java", kind: "match", language: "java" })).toBe(
      "match-java",
    );
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
