// @vitest-environment happy-dom
import { act, createRef, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PublishedQuestion, Workspace } from "@quorem/contracts";
import type { PythonEditorHandle } from "./PythonEditor";
import * as recovery from "./recovery";
import { useWorkspaceDraft } from "./useWorkspaceDraft";

vi.mock("./recovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./recovery")>()),
  readLatestRecovery: vi.fn(async () => undefined),
}));

const problem = {
  id: "v1",
  starterSource: "starter",
  signature: { parameters: [], returnType: "int" },
  examples: [],
} as unknown as PublishedQuestion;
const workspace = {
  id: "w1",
  problemVersionId: "v1",
  kind: "solo",
  language: "python",
} as Workspace;
let state: ReturnType<typeof useWorkspaceDraft>;
let root: Root;
let container: HTMLDivElement;
const editor = createRef<PythonEditorHandle>();
const onError = vi.fn();
function Subject({
  active = workspace,
  editable = true,
  authoritative = false,
  saveMatchSource,
}: {
  active?: Workspace;
  editable?: boolean;
  authoritative?: boolean;
  saveMatchSource?: (workspaceId: string, source: string) => Promise<void>;
}) {
  state = useWorkspaceDraft({
    identity: "alice",
    accountPresent: true,
    canEdit: editable,
    authoritative,
    initialSource: authoritative ? "team authority" : undefined,
    queriedProblem: problem,
    loadedWorkspace: active,
    editorRef: editor,
    onError,
    saveMatchSource,
  });
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Subject />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("preserves an edited draft when switching workspaces", async () => {
  await act(async () => state.updateSource("unsaved source"));
  const next = { ...workspace, id: "w2", kind: "match" } as Workspace;
  await act(async () => root.render(<Subject active={next} />));
  expect(recovery.readBrowserDraft("alice", "solo", "v1")).toBe("unsaved source");
  expect(state.workspace?.id).toBe("w2");
  expect(state.sourceRef.current).toBe("starter");
});

it("retains a dirty draft on pagehide", async () => {
  await act(async () => state.updateSource("recover me"));
  await act(async () => window.dispatchEvent(new Event("pagehide")));
  expect(recovery.readBrowserDraft("alice", "solo", "v1")).toBe("recover me");
});

it("allows retry after autosave storage fails", async () => {
  vi.useFakeTimers();
  const storage = localStorage;
  vi.stubGlobal("localStorage", {
    getItem: storage.getItem.bind(storage),
    setItem: vi.fn(storage.setItem.bind(storage)).mockImplementationOnce(() => {
      throw new Error("unavailable");
    }),
  });
  await act(async () => state.updateSource("retry me"));
  await act(async () => state.saveCurrentDraft());
  expect(state.saveState).toBe("error");
  expect(onError).toHaveBeenCalled();
  await act(async () => state.saveCurrentDraft());
  expect(state.saveState).toBe("saved");
});

it("flushes a pending browser draft on unmount and cancels its save timer", async () => {
  vi.useFakeTimers();
  await act(async () => state.updateSource("last edit"));
  await act(async () => root.unmount());
  expect(recovery.readBrowserDraft("alice", "solo", "v1")).toBe("last edit");
  await act(async () => vi.runAllTimersAsync());
  expect(onError).not.toHaveBeenCalled();
  root = createRoot(container);
  vi.useRealTimers();
});

it("initializes the draft after Strict Mode effect replay", async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () =>
    root.render(
      <StrictMode>
        <Subject />
      </StrictMode>,
    ),
  );
  expect(state.contextKey).toBe("alice:w1:v1");
  await act(async () => state.updateSource("strict edit"));
  await act(async () => state.saveCurrentDraft());
  expect(state.saveState).toBe("saved");
});

it("freezes draft and custom case changes", async () => {
  await act(async () => state.updateSource("finished code"));
  await act(async () => root.render(<Subject editable={false} />));
  await act(async () => {
    state.updateSource("late edit");
    state.changeCustomDrafts([]);
  });
  expect(state.sourceRef.current).toBe("finished code");
});

it("never restores local drafts over a shared authoritative document", async () => {
  recovery.writeBrowserDraft("alice", "team-workspace", "v1", "obsolete local source");
  vi.mocked(recovery.readLatestRecovery).mockResolvedValueOnce({
    source: "obsolete recovery",
  } as never);
  await act(async () =>
    root.render(
      <Subject
        key="team"
        active={{ ...workspace, id: "team-workspace", kind: "match" }}
        authoritative
      />,
    ),
  );
  expect(state.sourceRef.current).toBe("team authority");
});

it("does not migrate delayed account recovery over a newly saved anonymous draft", async () => {
  localStorage.clear();
  vi.mocked(recovery.readLatestRecovery).mockReset();
  let finish!: (
    value: NonNullable<Awaited<ReturnType<typeof recovery.readLatestRecovery>>>,
  ) => void;
  vi.mocked(recovery.readLatestRecovery).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(<Subject active={{ ...workspace, id: "w2" }} />));
  recovery.writeBrowserDraft(
    "anonymous" as import("@quorem/contracts").DevelopmentIdentity,
    "solo",
    "v1",
    "anonymous work",
  );
  await act(async () =>
    finish({ scope: "old", source: "old account history", savedAt: "2026-01-01" }),
  );
  expect(state.sourceRef.current).toBe("starter");
  expect(recovery.readBrowserDraft("alice", "solo", "v1")).toBeUndefined();
});

it("saves the newest match code even while the player keeps typing", async () => {
  vi.useFakeTimers();
  const saveMatchSource = vi.fn(async () => {});
  const match = { ...workspace, id: "match-workspace", kind: "match" } as Workspace;
  await act(async () => root.render(<Subject active={match} saveMatchSource={saveMatchSource} />));
  await act(async () => state.updateSource("first edit"));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  await act(async () => state.updateSource("unsubmitted latest edit"));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(saveMatchSource).toHaveBeenCalledExactlyOnceWith(
    "match-workspace",
    "unsubmitted latest edit",
  );
});
