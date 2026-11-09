/** @file graphsPreview.tsx @description Local walkthrough of the real graph authoring and solver views. @module dev */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Braces, Eye, FlaskConical, Moon, RotateCcw, Sun } from "lucide-react";
import type { Signature } from "@quorem/contracts";
import { primarySignature, publicQuestionProblem } from "@quorem/questions";
import { AuthoringCases } from "../features/admin/AuthoringCases";
import { SignatureFields } from "../features/admin/SignatureFields";
import { adaptSignature } from "../features/admin/authoringSignature";
import {
  authoringMessages,
  updateAuthoringIssues,
  type AuthoringIssue,
} from "../features/admin/authoringValidation";
import { TestCases } from "../features/editor/components/TestCases";
import { AuthoringTabs } from "../ui/AuthoringTabs";
import { SelectField } from "../ui/SelectField";
import { fixtureQuestion, graphFixtures } from "./graphFixtures";
import "@fontsource-variable/geist";
import "@fontsource/jetbrains-mono/400.css";
import "@quorem/ui/theme.css";
import "../styles/global.css";
import "../styles/workspace.css";
import "../features/admin/admin.css";
import "../features/odyssey/authoring.css";
import "../ui/result-tabs.css";
import "./graphs-preview.css";

const tabs = [
  { value: "tests", label: "Tests", icon: <FlaskConical aria-hidden="true" /> },
  { value: "signature", label: "Signature", icon: <Braces aria-hidden="true" /> },
  { value: "solver", label: "Solver preview", icon: <Eye aria-hidden="true" /> },
] as const;
type View = (typeof tabs)[number]["value"];

function GraphFixture({ fixture, view }: { fixture: (typeof graphFixtures)[number]; view: View }) {
  const [content, setContent] = useState(() => fixtureQuestion(fixture));
  const [issues, setIssues] = useState(new Map<string, readonly AuthoringIssue[]>());
  const signature = primarySignature(content.problem);
  const changeSignature = (next: Signature) =>
    setContent((current) => adaptSignature(current, next));
  const notices = authoringMessages([...issues.values()].flat());
  return (
    <>
      <p className="graph-demo-hint">{fixture.hint}</p>
      <div
        id="graph-demo-tests-panel"
        role="tabpanel"
        aria-labelledby="graph-demo-tests"
        hidden={view !== "tests"}
      >
        {notices.length > 0 && (
          <ul className="graph-demo-notices" role="status">
            {notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        )}
        <AuthoringCases
          key={JSON.stringify(signature)}
          content={content}
          onChange={setContent}
          onValidityChange={(label, invalid, details) =>
            setIssues((current) => updateAuthoringIssues(current, label, invalid, details))
          }
        />
      </div>
      <div
        id="graph-demo-signature-panel"
        role="tabpanel"
        aria-labelledby="graph-demo-signature"
        hidden={view !== "signature"}
      >
        <SignatureFields graphAuthoring value={signature} onChange={changeSignature} />
      </div>
      {view === "solver" && (
        <div id="graph-demo-solver-panel" role="tabpanel" aria-labelledby="graph-demo-solver">
          <TestCases
            problem={publicQuestionProblem(content.problem)}
            customMode={false}
            drafts={[]}
            onDraftsChange={() => {}}
          />
        </div>
      )}
    </>
  );
}

function GraphDemo() {
  const [selected, setSelected] = useState(graphFixtures[0]!.id);
  const [view, setView] = useState<View>("tests");
  const [revision, reset] = useState(0);
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const fixture = graphFixtures.find(({ id }) => id === selected) ?? graphFixtures[0]!;
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  return (
    <main className="graph-demo">
      <header className="graph-demo-header">
        <div>
          <h1>Graph authoring demo</h1>
          <p>Local fixtures. Edits last until you switch scenarios, reset, or reload.</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={dark ? "Use light theme" : "Use dark theme"}
          onClick={() => setDark(!dark)}
        >
          {dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
        </button>
      </header>
      <div className="graph-demo-controls">
        <SelectField
          label="Scenario"
          value={selected}
          options={graphFixtures.map(({ id, title }) => ({ value: id, label: title }))}
          onChange={(id) => {
            setSelected(id);
            setView("tests");
          }}
        />
        <button
          type="button"
          className="button button-secondary"
          onClick={() => reset((value) => value + 1)}
        >
          <RotateCcw size={14} aria-hidden="true" /> Reset fixture
        </button>
      </div>
      <AuthoringTabs
        id="graph-demo"
        label="Demo view"
        appearance="plain"
        value={view}
        onChange={setView}
        tabs={tabs}
      />
      <GraphFixture key={`${fixture.id}:${revision}`} fixture={fixture} view={view} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<GraphDemo />);
