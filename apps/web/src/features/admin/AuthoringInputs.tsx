import { lazy, Suspense, useId, useState } from "react";
import { Field } from "./AuthoringFields";
import { useTheme } from "../editor/useTheme";
import type { EditorLanguage } from "../editor/editorLanguages";
const CodeEditor = lazy(() =>
  import("../editor/PythonEditor").then((module) => ({ default: module.PythonEditor })),
);
export function AuthoringCodeField({
  label,
  language,
  source,
  disabled,
  onChange,
}: {
  label: string;
  language: EditorLanguage;
  source: string;
  disabled: boolean;
  onChange: (source: string) => void;
}) {
  const id = useId();
  const { theme } = useTheme();
  return (
    <div className="admin-field">
      <span id={id}>{label}</span>
      <div className="admin-source-editor" role="group" aria-labelledby={id}>
        <Suspense fallback={<p role="status">Loading editor…</p>}>
          <CodeEditor
            documentKey={id}
            documentUri={`file:///question/${encodeURIComponent(id)}`}
            initialSource={source}
            language={language}
            theme={theme}
            colorScheme="workspace"
            fontSize={14}
            tabSize={4}
            wrap
            readOnly={disabled}
            completionEnabled={false}
            onSourceChange={onChange}
          />
        </Suspense>
      </div>
    </div>
  );
}
export function TopicField({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [source, setSource] = useState(tags.join(", "));
  return (
    <Field label="Topics, separated by commas">
      <input
        value={source}
        onChange={(event) => {
          setSource(event.target.value);
          onChange([
            ...new Set(
              event.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            ),
          ]);
        }}
      />
    </Field>
  );
}
