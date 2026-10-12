import { useEffect, useRef, useState } from "react";
import {
  PythonEditor,
  type PythonEditorHandle,
} from "../../../web/src/features/editor/PythonEditor";
import { Icon } from "../../../web/src/features/editor/components/Icon";
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
const frameDelay = (stage: number) => frames[stage].delay;

/** A finite, read-only typing scene using the app's mounted CodeMirror editor. */
export default function HeroEditorPreview() {
  const editor = useRef<PythonEditorHandle>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [paused, setPaused] = useState(false);
  const { root, stage, replay } = usePreviewSequence(frames.length - 1, true, frameDelay, paused);
  const finished = stage === frames.length - 1;
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
  useEffect(() => editor.current?.replaceSource(frames[stage].source), [stage]);
  return (
    <div
      ref={root}
      className="workspace-demo hero-typing"
      data-typing={!finished}
      data-paused={paused}
    >
      <div className="hero-problem-heading">
        <div>
          <span>Climbing Stairs</span>
          <small>Easy</small>
        </div>
        <button
          type="button"
          className="hero-typing-control"
          aria-label={finished ? "Replay typing" : paused ? "Resume typing" : "Pause typing"}
          onClick={() => {
            if (finished) {
              setPaused(false);
              replay();
            } else setPaused((value) => !value);
          }}
        >
          {finished ? (
            <Icon name="history" />
          ) : paused ? (
            <Icon name="play" />
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M8 5v14M16 5v14" />
            </svg>
          )}
        </button>
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
        <div className="preview-code">
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
      </div>
    </div>
  );
}
