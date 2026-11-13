// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { PublishedQuestion, Workspace } from "@quorem/contracts";
import type { PythonEditorHandle } from "./PythonEditor";
import { useWorkspaceDraft } from "./useWorkspaceDraft";
import { useSubmission } from "./useSubmission";

vi.mock("./recovery", async (original) => ({
  ...(await original<typeof import("./recovery")>()),
  readLatestRecovery: vi.fn(async () => undefined),
}));
vi.mock("../../ui/Notifications", () => ({ useErrorNotification: () => {} }));
vi.mock("./api", () => ({
  SubmissionReadError: class SubmissionReadError extends Error {
    status = 404;
  },
  createSubmission: vi.fn(async () => ({ id: "submission" })),
  fetchSubmission: vi.fn(async () => ({ id: "submission", state: "completed", kind: "run" })),
  cancelSubmission: vi.fn(),
}));
vi.mock("./submissionStream", () => ({ submissionStream: vi.fn(() => () => {}) }));
vi.mock("../../sha256", () => ({ sha256: vi.fn(async () => "hash") }));
import { createSubmission } from "./api";

const problem = {
  id: "version",
  slug: "question",
  starterSource: "starter",
  languages: [
    { language: "python", starterSource: "starter" },
    { language: "java", starterSource: "starter" },
  ],
  signature: { parameters: [], returnType: "int" },
  examples: [],
} as unknown as PublishedQuestion;
const own = {
  id: "own-review",
  kind: "review",
  problemVersionId: "version",
  language: "python",
} as unknown as Workspace;
const opponent = {
  id: "opponent-review",
  kind: "review",
  problemVersionId: "version",
  language: "java",
} as unknown as Workspace;
const editor = createRef<PythonEditorHandle>();
let draft: ReturnType<typeof useWorkspaceDraft>;
let execution: ReturnType<typeof useSubmission>;
function Subject({ selected }: { selected: Workspace }) {
  draft = useWorkspaceDraft({
    identity: "alice",
    accountPresent: true,
    queriedProblem: problem,
    loadedWorkspace: selected,
    editorRef: editor,
    onError: () => {},
  });
  execution = useSubmission({
    identity: "alice",
    workspace: draft.workspace,
    problem: draft.problem,
    editorRef: editor,
    sourceRef: draft.sourceRef,
    customMode: false,
    drafts: [],
    enabled: draft.workspace?.id === selected.id,
  });
  return null;
}
it("runs the selected participant copy in its language and retains the other draft", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = (selected: Workspace) =>
    root.render(
      <QueryClientProvider client={client}>
        <Subject selected={selected} />
      </QueryClientProvider>,
    );
  await act(async () => render(own));
  await act(async () => {
    draft.updateSource("my python draft");
    await draft.saveBeforeSwitch();
  });
  await act(async () => render(opponent));
  await act(async () => draft.updateSource("opponent java draft"));
  await act(async () => {
    await execution.run();
  });
  expect(createSubmission).toHaveBeenCalledWith(
    "alice",
    "opponent-review",
    "run",
    "opponent java draft",
    undefined,
    expect.any(String),
    undefined,
    undefined,
    undefined,
  );
  expect(draft.workspace?.language).toBe("java");
  await act(async () => {
    await draft.saveBeforeSwitch();
    render(own);
  });
  expect(draft.sourceRef.current).toBe("my python draft");
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});
