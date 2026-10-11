/** Local visual fixture. Uses production result components without executing or saving code. */
import type { ProblemVersion, Submission } from "@quorem/contracts";
import { Brand, Icon } from "./components/Icon";
import { ResultContent } from "./components/ResultContent";
import { TestCases } from "./components/TestCases";
import { useTheme } from "./useTheme";
import "../../styles/workspace.css";

const problem: ProblemVersion = {
  id: "preview",
  slug: "preview",
  version: "1",
  title: "Hidden cases",
  difficulty: "easy",
  tags: [],
  statementMarkdown: "",
  constraints: [],
  examples: [],
  signature: { className: "Solution", methodName: "solve", parameters: [], returnType: "int" },
  starterSource: "",
  runtimeRevision: "preview",
  limits: {
    wallTimeMs: 2000,
    memoryBytes: 268435456,
    outputBytes: 65536,
    maxProcesses: 16,
    maxCollectionElements: 10000,
    maxNestingDepth: 100,
  },
};
const submission: Submission = {
  id: "preview",
  workspaceId: "preview",
  kind: "submit",
  state: "completed",
  sourceHash: "preview",
  admittedAt: "2026-10-11T00:00:00Z",
  updatedAt: "2026-10-11T00:00:01Z",
  verdict: "wrong_answer",
  score: { passed: 3, total: 5 },
  hiddenCases: [
    { index: 0, status: "accepted" },
    { index: 1, status: "accepted" },
    { index: 2, status: "wrong_answer" },
    { index: 3, status: "time_limit" },
    { index: 4, status: "accepted" },
  ],
};
export function HiddenCasesPreview() {
  useTheme();
  return (
    <main className="app-shell hidden-preview">
      <header className="topbar">
        <Brand />
        <span className="preview-label">UI preview</span>
        <a className="quiet-button" href="/mirror-letters">
          Back to editor
        </a>
      </header>
      <section className="results-pane preview-results" aria-label="Hidden case demonstration">
        <div className="results-toolbar">
          <span className="value-label">
            <Icon name="lock" />
            Hidden cases
          </span>
        </div>
        <div className="results-content case-results-content">
          <div className="case-result-summary">
            <ResultContent submission={submission} busy={false} showCases={false} />
          </div>
          <div role="tabpanel" aria-label="Hidden cases">
            <TestCases
              problem={problem}
              customMode={false}
              drafts={[]}
              onDraftsChange={() => {}}
              submission={submission}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
