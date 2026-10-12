/** @file EditorPreview.tsx @description In-memory preview of the workspace editor. @module marketing */
import { useEffect, useRef, useState } from "react";
import {
  PythonEditor,
  type PythonEditorHandle,
} from "../../../web/src/features/editor/PythonEditor";

const source = `class Solution:
    def runWidths(self, nums):
        widths = []
        start = 0

        for end in range(len(nums)):
            if end == len(nums) - 1 or nums[end] != nums[end + 1]:
                widths.append(end - start + 1)
                start = end + 1

        return widths`;

/** Reuses workspace editing behavior without sessions, persistence or judging. */
export default function EditorPreview() {
  const [ready, setReady] = useState(false);
  const editor = useRef<PythonEditorHandle>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const sync = () =>
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    sync();
    setReady(true);
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <div className="live-editor-preview">
      <div className="preview-editor-toolbar">
        <span>Solution.py</span>
        <span>Python</span>
      </div>
      <div className="preview-code">
        <PythonEditor
          ref={editor}
          documentKey="marketing-preview"
          documentUri="file:///preview/solution.py"
          initialSource={source}
          theme={theme}
          colorScheme="workspace"
          fontSize={12}
          tabSize={4}
          wrap={false}
          onSourceChange={() => {}}
        />
        <pre className="preview-source">{source}</pre>
      </div>
      <div className="preview-editor-footer">
        <span>{ready ? "Try editing the code" : "Python solution preview"}</span>
        <button
          type="button"
          disabled={!ready}
          onClick={() => editor.current?.replaceSource(source)}
        >
          Reset
        </button>
        <a href="/practice/run-widths">
          Open practice <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  );
}
