// @vitest-environment happy-dom
import { act, createRef, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProblemVersion, Workspace } from "@quorem/contracts";
import type { PythonEditorHandle } from "./PythonEditor";
import * as recovery from "./recovery";
import { useWorkspaceDraft } from "./useWorkspaceDraft";

vi.mock("./recovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./recovery")>()),
  readLatestRecovery: vi.fn(async () => undefined),
  writeRecovery: vi.fn(async () => undefined),
}));

const problem = {
  id: "v1",
  starterSource: "starter",
  signature: { parameters: [], returnType: "int" },
  examples: [],
} as unknown as ProblemVersion;
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
}: {
  active?: Workspace;
  editable?: boolean;
  authoritative?: boolean;
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
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps newer edits when history restoration waits for an in-flight save", async () => {
  let finish!: () => void;
  vi.mocked(recovery.writeRecovery).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => state.updateSource("first edit"));
  let restoring!: Promise<void>;
  await act(async () => {
    restoring = state.restoreHistory("older revision");
    await Promise.resolve();
  });
  await act(async () => state.updateSource("newer edit"));
  const result = restoring.catch((error: Error) => error.message);
  await act(async () => {
    finish();
    await result;
  });
  expect(await result).toContain("Newer local edits were kept");
  expect(state.sourceRef.current).toBe("newer edit");
  expect(state.saveState).toBe("dirty");
});

it("preserves an edited draft when switching workspaces", async () => {
  await act(async () => state.updateSource("unsaved source"));
  const next = { ...workspace, id: "w2", kind: "match" } as Workspace;
  await act(async () => root.render(<Subject active={next} />));
  expect(recovery.writeRecovery).toHaveBeenCalledWith("alice", "solo", "v1", "unsaved source");
  expect(state.workspace?.id).toBe("w2");
  expect(state.sourceRef.current).toBe("starter");
});

it("does not apply an old restore completion to a new workspace", async () => {
  let finish!: () => void;
  vi.mocked(recovery.writeRecovery).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let restoring!: Promise<void>;
  await act(async () => {
    restoring = state.restoreHistory("old revision");
    await Promise.resolve();
  });
  const next = { ...workspace, id: "w2", kind: "match" } as Workspace;
  await act(async () => root.render(<Subject active={next} />));
  await act(async () => state.updateSource("new workspace edit"));
  await act(async () => {
    finish();
    await restoring;
  });
  expect(state.workspace?.id).toBe("w2");
  expect(state.sourceRef.current).toBe("new workspace edit");
  expect(state.saveState).toBe("dirty");
});

it("retains a dirty draft on pagehide", async () => {
  await act(async () => state.updateSource("recover me"));
  await act(async () => window.dispatchEvent(new Event("pagehide")));
  expect(recovery.readBrowserDraft("alice", "solo", "v1")).toBe("recover me");
  expect(recovery.writeRecovery).toHaveBeenCalledWith("alice", "solo", "v1", "recover me");
});

it("allows retry after recovery storage fails", async () => {
  vi.mocked(recovery.writeRecovery).mockRejectedValueOnce(new Error("unavailable"));
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
  const calls = vi.mocked(recovery.writeRecovery).mock.calls.length;
  await act(async () => vi.runAllTimersAsync());
  expect(recovery.writeRecovery).toHaveBeenCalledTimes(calls);
  vi.useRealTimers();
});

it("does not restore history after unmount while saving", async () => {
  let finish!: () => void;
  vi.mocked(recovery.writeRecovery).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => state.updateSource("current source"));
  let restoring!: Promise<void>;
  await act(async () => {
    restoring = state.restoreHistory("old source");
    await Promise.resolve();
  });
  await act(async () => root.unmount());
  await act(async () => {
    finish();
    await restoring;
  });
  expect(recovery.readBrowserDraft("alice", "solo", "v1")).toBe("current source");
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

it("freezes draft, history restore and custom case changes", async () => {
  await act(async () => state.updateSource("finished code"));
  await act(async () => root.render(<Subject editable={false} />));
  await act(async () => {
    state.updateSource("late edit");
    state.changeCustomDrafts([]);
    await state.restoreHistory("older code");
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

it("keeps an anonymous draft ahead of delayed account history", async () => {
  localStorage.clear();
  vi.mocked(recovery.readLatestRecovery).mockReset();
  let finish!: (value: recovery.RecoverySnapshot) => void;
  vi.mocked(recovery.readLatestRecovery).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  recovery.writeBrowserDraft(
    "anonymous" as import("@quorem/contracts").DevelopmentIdentity,
    "solo",
    "v1",
    "anonymous work",
  );
  await act(async () => root.render(<Subject active={{ ...workspace, id: "w2" }} />));
  await act(async () =>
    finish({ scope: "old", source: "old account history", savedAt: "2026-01-01" }),
  );
  expect(state.sourceRef.current).toBe("anonymous work");
});
