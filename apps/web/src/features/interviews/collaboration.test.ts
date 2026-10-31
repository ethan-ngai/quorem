/** @file collaboration.test.ts @description Durable retry, concurrent rebasing and backlog recovery. @module interviews */
import { unlockedMethodEdit } from "../odyssey/methodStubs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditorState,
  ChangeSet,
  Transaction,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import { getSyncedVersion } from "@codemirror/collab";
import { createCollaboration } from "./collaboration";
import { InterviewError, interviewRequest } from "./api";

vi.mock("./api", () => ({
  InterviewError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
  interviewRequest: vi.fn(),
}));
const socketEvents = vi.hoisted(() => ({
  changed: undefined as undefined | ((kind?: string) => void),
}));
vi.mock("./socket", () => ({
  createInterviewSocket: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    onChange: (callback: (kind?: string) => void) => {
      socketEvents.changed = callback;
    },
    onStatus: vi.fn(),
    request: (type: string, body: Record<string, unknown>) =>
      type === "push"
        ? interviewRequest("updates", "POST", body.push, body.key as string)
        : interviewRequest("updates", "GET"),
  }),
}));
vi.mock("../odyssey/methodStubs", () => ({ unlockedMethodEdit: vi.fn() }));
vi.mock("./presence", () => ({ presenceExtension: () => [] }));
vi.mock("@codemirror/view", () => ({ ViewPlugin: { fromClass: (plugin: unknown) => plugin } }));
beforeEach(() => {
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function client(source = "", onSnapshot?: Parameters<typeof createCollaboration>[3]) {
  vi.useFakeTimers();
  const statuses: string[] = [];
  const controller = createCollaboration(
    "room",
    { source, version: 0, epoch: "one" },
    (value) => statuses.push(value),
    onSnapshot,
  );
  const extensions = controller.extension as unknown as [
    Extension,
    new (view: unknown) => { destroy: () => void },
  ];
  let state = EditorState.create({ doc: source, extensions: extensions[0] });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  };
  const plugin = new extensions[1](view);
  return {
    ...controller,
    statuses,
    edit(text: string, userEvent?: string) {
      state = state.update({
        changes: { from: state.doc.length, insert: text },
        ...(userEvent ? { annotations: Transaction.userEvent.of(userEvent) } : {}),
      }).state;
    },
    get state() {
      return state;
    },
    destroy: () => plugin.destroy(),
  };
}

describe("shared document synchronization", () => {
  it("rejects NUL insertions without disturbing valid document edits", () => {
    const local = client("start");
    local.edit(" normal 😀");
    const before = local.state.doc.toString();
    local.edit("\0bad", "input.paste");
    expect(local.state.doc.toString()).toBe(before);
    local.edit("\0bad", "input.type.compose");
    expect(local.state.doc.toString()).toBe(before);
    local.edit(" valid\\0");
    expect(local.state.doc.toString()).toBe(`${before} valid\\0`);
    local.destroy();
  });

  it("rebases a concurrent remote insertion before retrying local changes", async () => {
    const local = client();
    local.edit("A");
    const remote = ChangeSet.of({ from: 0, insert: "B" }, 0);
    let authority = remote.apply(EditorState.create().doc);
    let stale = true;
    vi.mocked(interviewRequest).mockImplementation(async (_path, method, body) => {
      if (method === "POST") {
        if (stale) {
          stale = false;
          throw new InterviewError("stale_version", 409);
        }
        const request = body as { updates: { clientID: string; changes: unknown }[] };
        for (const update of request.updates)
          authority = ChangeSet.fromJSON(update.changes).apply(authority);
        return { epoch: "one", version: 2, updates: request.updates };
      }
      return {
        epoch: "one",
        version: 1,
        updates: [{ clientID: "remote", changes: remote.toJSON() }],
      };
    });
    expect(await local.flush()).toBe(true);
    expect(local.state.doc.toString()).toBe(authority.toString());
    expect(local.state.doc.toString()).toContain("A");
    expect(local.state.doc.toString()).toContain("B");
    expect(getSyncedVersion(local.state)).toBe(2);
    local.destroy();
  });
  it("reuses the retry key after an update response is lost", async () => {
    const local = client();
    local.edit("saved");
    let response: unknown;
    vi.mocked(interviewRequest).mockImplementation(async (_path, _method, body) => {
      if (!response) {
        response = { epoch: "one", version: 1, updates: (body as { updates: unknown[] }).updates };
        throw new Error("network");
      }
      return response;
    });
    expect(await local.flush()).toBe(false);
    expect(local.state.doc.toString()).toBe("saved");
    expect(await local.flush()).toBe(true);
    const calls = vi.mocked(interviewRequest).mock.calls;
    expect(calls[0]![3]).toBe(calls[1]![3]);
    expect(calls[0]![2]).toEqual(calls[1]![2]);
    expect(getSyncedVersion(local.state)).toBe(1);
    local.destroy();
  });
  it("drains more than 32 offline edits in bounded batches", async () => {
    const local = client();
    for (let index = 0; index < 70; index++) local.edit("x");
    let version = 0;
    vi.mocked(interviewRequest).mockImplementation(async (_path, _method, body) => {
      const request = body as { updates: unknown[] };
      expect(request.updates.length).toBeLessThanOrEqual(32);
      version += request.updates.length;
      return { epoch: "one", version, updates: request.updates };
    });
    expect(await local.flush()).toBe(true);
    expect(local.state.doc.toString()).toBe("x".repeat(70));
    expect(getSyncedVersion(local.state)).toBe(70);
    expect(interviewRequest).toHaveBeenCalledTimes(3);
    local.destroy();
  });
  it("stops on epoch replacement and retains local source", async () => {
    const local = client();
    local.edit("keep me");
    vi.mocked(interviewRequest).mockRejectedValue(new InterviewError("document_changed", 409));
    expect(await local.flush()).toBe(false);
    expect(local.statuses.at(-1)).toBe("replaced");
    expect(local.state.doc.toString()).toBe("keep me");
    expect(interviewRequest).toHaveBeenCalledTimes(1);
    local.destroy();
  });
  it("drains a remote backlog beyond one server batch", async () => {
    const local = client();
    let version = 0;
    vi.mocked(interviewRequest).mockImplementation(async () => {
      const count = version === 0 ? 256 : 1;
      const updates = Array.from({ length: count }, (_, index) => ({
        clientID: "remote",
        changes: ChangeSet.of({ from: version + index, insert: "x" }, version + index).toJSON(),
      }));
      version += count;
      return { epoch: "one", version, updates };
    });
    expect(await local.flush()).toBe(true);
    expect(getSyncedVersion(local.state)).toBe(257);
    expect(local.state.doc.toString()).toBe("x".repeat(257));
    local.destroy();
  });
  it("does not retry a closed-room conflict in a hot loop", async () => {
    const local = client();
    local.edit("pending");
    vi.mocked(interviewRequest).mockRejectedValue(new InterviewError("invalid_transition", 409));
    expect(await local.flush()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(interviewRequest).toHaveBeenCalledTimes(1);
    expect(local.state.doc.toString()).toBe("pending");
    local.destroy();
  });
});

it("pulls another peer's stub insertion after a version conflict without duplicating methods", async () => {
  const original = "class Solution:\n    def save(self):\n        pass\n";
  const stub = "\n    def get(self):\n        raise NotImplementedError\n";
  const local = client(original);
  vi.mocked(unlockedMethodEdit).mockImplementation(async (source) =>
    source.includes("def get")
      ? undefined
      : { from: source.length, to: source.length, insert: stub },
  );
  let reads = 0;
  let writes = 0;
  vi.mocked(interviewRequest).mockImplementation(async (_path, method) => {
    if (method === "POST") {
      writes++;
      throw new InterviewError("stale_version", 409);
    }
    reads++;
    return reads === 1
      ? { epoch: "one", version: 0, updates: [] }
      : reads === 2
        ? {
            epoch: "one",
            version: 1,
            updates: [
              {
                clientID: "odyssey-stubs",
                changes: ChangeSet.of(
                  { from: original.length, insert: stub },
                  original.length,
                ).toJSON(),
              },
            ],
          }
        : { epoch: "one", version: 1, updates: [] };
  });
  local.setOdyssey({ level: 2, completed: false, totalLevels: 2, levels: [] }, "python");
  expect(await local.flush()).toBe(true);
  expect(local.state.doc.toString()).toBe(original + stub);
  expect(await local.flush()).toBe(true);
  expect(writes).toBe(1);
  local.destroy();
});

it("publishes advanced progress even when the previous submission cannot be read", async () => {
  const onSnapshot = vi.fn();
  const local = client("", onSnapshot);
  const snapshot = {
    version: 3,
    latestSubmissionId: "previous-result",
    question: { progress: { level: 2 } },
  };
  vi.mocked(interviewRequest).mockImplementation(async (path) => {
    if (path === "/v1/interviews/room") return snapshot;
    if (path === "/v1/interviews/room/submissions/previous-result")
      throw new Error("temporary result outage");
    return { epoch: "one", version: 0, updates: [] };
  });
  socketEvents.changed?.("interview.session");
  await vi.advanceTimersByTimeAsync(0);
  expect(onSnapshot).toHaveBeenCalledWith(snapshot);
  await vi.advanceTimersByTimeAsync(1000);
  expect(onSnapshot).toHaveBeenCalledTimes(2);
  local.destroy();
  await vi.advanceTimersByTimeAsync(2000);
  expect(onSnapshot).toHaveBeenCalledTimes(2);
});

it("drops delayed result after a newer authorization or question notice", async () => {
  const onSnapshot = vi.fn(),
    local = client("", onSnapshot);
  let resolveResult!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    resolveResult = resolve;
  });
  let reads = 0;
  vi.mocked(interviewRequest).mockImplementation(async (path) => {
    if (path === "/v1/interviews/room")
      return ++reads === 1
        ? { version: 1, latestSubmissionId: "old", questionEpoch: "first" }
        : { version: 2, questionEpoch: "second" };
    if (path === "/v1/interviews/room/submissions/old") return pending;
    return { epoch: "one", version: 0, updates: [] };
  });
  socketEvents.changed?.("interview.session");
  await vi.advanceTimersByTimeAsync(0);
  socketEvents.changed?.("interview.session");
  resolveResult({ id: "old", privateCaseResults: ["secret"] });
  await vi.advanceTimersByTimeAsync(0);
  expect(onSnapshot.mock.calls.some(([, result]) => result?.id === "old")).toBe(false);
  expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ questionEpoch: "second" }));
  local.destroy();
});
