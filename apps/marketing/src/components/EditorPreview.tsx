import { useEffect, useState } from "react";
import { PythonEditor } from "../../../web/src/features/editor/PythonEditor";
import { TestCases } from "../../../web/src/features/editor/components/TestCases";
import { ResultContent } from "../../../web/src/features/editor/components/ResultContent";
import { Icon } from "../../../web/src/features/editor/components/Icon";
import { previewProblem, previewSnapshot, previewSubmission, source } from "./previewProblem";
import { usePreviewSequence } from "./usePreviewSequence";
/** Shared editor and case output, with read-only illustrative judging. */
export default function EditorPreview() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const { root, stage, replay } = usePreviewSequence(4, true, (step) =>
    step === 0 ? 220 : step === 1 ? 1700 : 1400,
  );
  const selectedCase = Math.min(Math.max(stage - 2, 0), 2);
  const submission = previewSubmission(stage);
  useEffect(() => {
    const sync = () =>
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className="workspace-demo demo-tests" aria-label="Example Two Sum test run">
      <div className="demo-readonly" inert>
        <div className="code-toolbar">
          <span className="editor-language">
            <span className="editor-language-logo" aria-hidden="true" />
            Python
          </span>
        </div>
        <div className="preview-code">
          <PythonEditor
            documentKey="marketing-tests"
            documentUri="file:///preview/tests.py"
            initialSource={source}
            theme={theme}
            colorScheme="workspace"
            fontSize={12}
            tabSize={4}
            wrap
            readOnly
            onSourceChange={() => {}}
          />
          <pre className="preview-source">{source}</pre>
        </div>
        <section className="demo-results-pane">
          <div className="results-toolbar">
            <div className="result-tabs">
              <button aria-selected="true" type="button">
                <Icon name="samples" />
                Sample cases
              </button>
              <button aria-selected="false" type="button">
                <Icon name="custom" />
                Custom cases
              </button>
            </div>
          </div>
          <div className="demo-result-summary">
            <ResultContent
              submission={submission}
              busy={false}
              showCases={false}
              customMode={false}
            />
          </div>
          <div className="demo-case-browser" data-case={selectedCase}>
            <TestCases
              problem={previewProblem}
              customMode={false}
              drafts={[]}
              onDraftsChange={() => {}}
              submission={submission}
              snapshot={previewSnapshot}
              selectedSampleIndex={selectedCase}
            />
          </div>
        </section>
      </div>
      <footer className="execution-bar demo-execution-bar">
        <div className="run-actions">
          {stage === 0 && (
            <span className="demo-cursor" aria-hidden="true">
              <svg viewBox="0 0 24 28">
                <path d="m3 2 1 22 6-5 5 8 4-2-5-8 8-2Z" />
              </svg>
            </span>
          )}
          <button
            className="button button-secondary"
            type="button"
            onClick={replay}
            disabled={stage < 4}
          >
            <Icon name="play" />
            Run
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={replay}
            disabled={stage < 4}
          >
            <Icon name="submit" />
            Submit
          </button>
        </div>
      </footer>
    </div>
  );
}
