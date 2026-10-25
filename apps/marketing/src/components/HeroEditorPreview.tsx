import { usePreviewTheme } from "./usePreviewTheme";
import { useEffect, useRef } from "react";
import {
  PythonEditor,
  type PythonEditorHandle,
} from "../../../web/src/features/editor/PythonEditor";
import { Icon } from "../../../web/src/ui/Icon";
import { usePreviewSequence } from "./usePreviewSequence";

const starter = "class Solution:\n    def climbStairs(self, n):\n        ";
const frames = [{ source: starter, delay: 650 }];
let draft = starter;
function type(text: string) {
  for (const char of text) {
    draft += char;
    frames.push({ source: draft, delay: char === "\n" ? 240 : 55 + (frames.length % 5) * 14 });
  }
}
function pause(delay: number) {
  frames[frames.length - 1].delay = delay;
}
function erase(count: number) {
  for (let i = 0; i < count; i++) {
    draft = draft.slice(0, -1);
    frames.push({ source: draft, delay: 65 });
  }
}
// The author catches an extra iteration, then corrects the returned accumulator.
type("a, b = 1, 1\n        for _ in range(n):");
pause(1100);
erase(3);
pause(350);
type("1, n):\n            a, b = b, a + b");
pause(800);
type("\n        return a");
pause(950);
erase(1);
pause(300);
type("b");
const finalSource = draft;
const typingEnd = frames.length - 1;
frames.push(...[650, 1100, 1000, 1200, 800].map((delay) => ({ source: finalSource, delay })));
const frameDelay = (stage: number) => frames[stage].delay;
/** A finite, read-only typing scene using the app's mounted CodeMirror editor. */
export default function HeroEditorPreview() {
  const editor = useRef<PythonEditorHandle>(null);
  const theme = usePreviewTheme();
  const { root, stage } = usePreviewSequence(frames.length - 1, true, frameDelay);
  const phase = Math.max(0, stage - typingEnd);
  useEffect(() => editor.current?.replaceSource(frames[stage].source), [stage]);
  return (
    <div className="workspace-demo hero-typing" data-typing={stage < typingEnd}>
      <div className="hero-problem-description">
        <h2>
          Climbing Stairs <small>Easy</small>
        </h2>
        <div className="topic-list" data-visible="true">
          <span>Dynamic Programming</span>
          <span>Math</span>
        </div>
        <div className="problem-copy">
          <p>
            There are <code>n</code> steps to the top. Take one or two steps at a time. Return the
            number of distinct ways to reach the top.
          </p>
        </div>
        <div className="example-data hero-problem-example">
          <div>
            <span className="value-label" aria-label="Sample input">
              <Icon name="input" />
            </span>
            <code>n = 3</code>
          </div>
          <div>
            <span className="value-label" aria-label="Sample output">
              <Icon name="output" />
            </span>
            <code>3</code>
          </div>
        </div>
      </div>
      <div
        className="demo-readonly"
        inert
        role="img"
        aria-label="Example Python solution for Climbing Stairs, written with pauses and two corrections."
      >
        <div className="code-toolbar">
          <span className="editor-language">
            <span className="editor-language-logo" aria-hidden="true" />
            Python
          </span>
        </div>
        <div className="preview-code" ref={root}>
          <PythonEditor
            ref={editor}
            documentKey="marketing-hero-stairs"
            documentUri="file:///preview/climbing-stairs.py"
            initialSource={finalSource}
            theme={theme}
            colorScheme="workspace"
            fontSize={12}
            tabSize={4}
            wrap
            readOnly
            onSourceChange={() => {}}
          />
          <pre className="preview-source">{finalSource}</pre>
        </div>
        <footer className="execution-bar demo-execution-bar hero-execution">
          <span className="hero-run-status" data-passed={phase >= 2}>
            {phase === 1 ? "Running…" : phase >= 2 ? "20 / 20 passed" : ""}
          </span>
          <div className="run-actions">
            <button
              className={`button button-secondary ${phase === 1 ? "demo-action-active" : ""}`}
              type="button"
            >
              <Icon name="play" />
              Run
            </button>
            <button
              className={`button button-primary ${phase === 3 ? "demo-action-active" : ""}`}
              type="button"
            >
              <Icon name="submit" />
              Submit
            </button>
          </div>
        </footer>
      </div>
      <div className="hero-scoreboard" aria-label="Example submissions" data-phase={phase}>
        <div>
          <span className="product-avatar">Y</span>
          <span>You</span>
          <span>{phase >= 4 ? "20 / 20" : phase === 3 ? "Submitting…" : "Writing…"}</span>
        </div>
        <div>
          <span className="product-avatar">J</span>
          <span>Jamie</span>
          <span>{phase >= 2 ? "14 / 20" : phase === 1 ? "Submitting…" : "Writing…"}</span>
        </div>
        <p className={phase >= 4 ? "hero-winner visible" : "hero-winner"}>
          <Icon name="submit" />
          You win<span>First correct submission</span>
        </p>
      </div>
    </div>
  );
}
