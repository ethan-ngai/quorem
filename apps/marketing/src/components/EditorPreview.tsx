import { useEffect, useState } from "react";
import { PythonEditor } from "../../../web/src/features/editor/PythonEditor";
import { TestCases } from "../../../web/src/features/editor/components/TestCases";
import { ResultContent } from "../../../web/src/features/editor/components/ResultContent";
import { Icon } from "../../../web/src/features/editor/components/Icon";
import { previewProblem, previewSnapshot, previewSubmission, source } from "./previewProblem";
import { usePreviewSequence } from "./usePreviewSequence";
/** Shared editor and case output, with read-only illustrative judging. */
export default function EditorPreview({ variant = "tests" }: { variant?: "hero" | "tests" }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const { root, stage } = usePreviewSequence(4, true, 1000);
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
    <div
      ref={root}
      className={`workspace-demo demo-${variant}`}
      role="img"
      aria-label={
        variant === "hero"
          ? "Example Two Sum Showdown workspace: read-only Python solution, two sample cases pass and the duplicate-value case fails. Jamie wins with the first correct submission."
          : "Example Two Sum test run: a cursor runs the Python solution; two cases pass, and the duplicate-value case fails with output [0,0] instead of [0,1]."
      }
    >
      {variant === "hero" && (
        <>
          <div className="demo-match-header">
            <span className="brand-mark" />
            <strong>Showdown</strong>
            <span>08:34</span>
          </div>
          <div className="demo-statement">
            <span>Problem</span>
            <h2>
              Two Sum <small>Easy</small>
            </h2>
            <p>Find the two indices whose values add up to the target.</p>
            <code>nums = [2, 7, 11, 15] · target = 9</code>
          </div>
        </>
      )}
      <div className="demo-readonly" inert>
        <div className="code-toolbar">
          <span className="editor-language">
            <span className="editor-language-logo" aria-hidden="true" />
            Python
          </span>
        </div>
        <div className="preview-code">
          <PythonEditor
            documentKey={`marketing-${variant}`}
            documentUri={`file:///preview/${variant}.py`}
            initialSource={source}
            theme={theme}
            colorScheme="workspace"
            fontSize={variant === "hero" ? 11 : 12}
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
          <div className="demo-case-browser">
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
        <footer className="execution-bar demo-execution-bar">
          <div className="run-actions">
            {stage === 0 && (
              <span className="demo-cursor" aria-hidden="true">
                <svg viewBox="0 0 24 28">
                  <path d="m3 2 1 22 6-5 5 8 4-2-5-8 8-2Z" />
                </svg>
              </span>
            )}
            <button className="button button-secondary" type="button">
              <Icon name="play" />
              Run
            </button>
            <button className="button button-primary" type="button">
              <Icon name="submit" />
              Submit
            </button>
          </div>
        </footer>
      </div>
      {variant === "hero" && (
        <div className="demo-match-score">
          <span>
            Alex <small>You</small>
            <b>14 / 20</b>
          </span>
          <span>
            Jamie <small>Winner</small>
            <b>20 / 20</b>
          </span>
        </div>
      )}
    </div>
  );
}
