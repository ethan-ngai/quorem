/** @file WorkspaceLayout.tsx @description Shared practice, competition and interview pane composition. @module editor */
import { QuestionLanguage } from "../QuestionLanguage";
import type { EditorLanguage } from "../editorLanguages";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { readPreference, writePreference } from "../editorSettings";
import { Icon } from "./Icon";
import { ResizableDivider } from "./ResizableDivider";

export type WorkspacePanel = "problem" | "code" | "results";

/** Controllers supply content; every coding mode shares sizing, navigation and action placement. */
export function WorkspaceLayout({
  language = "python",
  navigation,
  header,
  problem,
  editor,
  results,
  actions,
  panel,
  onPanelChange,
  pending = false,
  children,
}: {
  language?: EditorLanguage;
  navigation: ReactNode;
  header?: ReactNode;
  problem: ReactNode;
  editor: ReactNode;
  results: ReactNode;
  actions: ReactNode;
  panel: WorkspacePanel;
  onPanelChange: (panel: WorkspacePanel) => void;
  pending?: boolean;
  children?: ReactNode;
}) {
  const [ratio, setRatio] = useState(() => readPreference("quorem.pane-ratio.v1", 40));
  const [height, setHeight] = useState(() => readPreference("quorem.results-height.v1", 260));
  useEffect(() => writePreference("quorem.pane-ratio.v1", ratio), [ratio]);
  useEffect(() => writePreference("quorem.results-height.v1", height), [height]);
  const style = {
    "--problem-ratio": `${ratio}%`,
    "--results-height": `${height}px`,
    visibility: pending ? "hidden" : undefined,
  } as CSSProperties;
  return (
    <QuestionLanguage.Provider value={language}>
      <main
        className={`app-shell${header ? " has-match" : ""}`}
        aria-busy={pending}
        style={style}
        inert={pending}
      >
        {navigation}
        {header && <div className="match-strip">{header}</div>}
        <nav className="mobile-tabs" aria-label="Workspace panes">
          {(["problem", "code", "results"] as const).map((value) => (
            <button
              key={value}
              aria-current={panel === value ? "page" : undefined}
              onClick={() => onPanelChange(value)}
            >
              <Icon
                name={value === "problem" ? "problem" : value === "code" ? "code" : "results"}
              />
              {value === "problem" ? "Problem" : value === "code" ? "Code" : "Results"}
            </button>
          ))}
        </nav>
        <div className="workspace-grid" data-active-panel={panel}>
          <section className="problem-pane" aria-label="Problem statement">
            {problem}
          </section>
          <ResizableDivider axis="x" value={ratio} minimum={25} maximum={60} onChange={setRatio} />
          <div className="solution-pane">
            <section className="coding-pane" aria-label="Code editor">
              {editor}
            </section>
            <ResizableDivider
              axis="y"
              value={height}
              minimum={170}
              maximum={480}
              onChange={setHeight}
            />
            <section className="results-pane" aria-label="Execution results">
              {results}
            </section>
          </div>
          <footer className="execution-bar" aria-label="Execution actions">
            {actions}
          </footer>
        </div>
        {children}
      </main>
    </QuestionLanguage.Provider>
  );
}
