import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { useLocalEditorPreferences } from "../settings/useLocalEditorPreferences";
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
  const preferences = useLocalEditorPreferences();
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
            colorScheme={preferences.editorSchemes[theme]}
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
  label = "Topics, separated by commas",
}: {
  tags: string[];
  label?: string;
  onChange: (tags: string[]) => void;
}) {
  const [source, setSource] = useState(tags.join(", "));
  return (
    <Field label={label}>
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

export function AuthoringNumberField({
  label,
  value,
  onChange,
  onValidityChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onValidityChange: (invalid: boolean) => void;
}) {
  const [source, setSource] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const id = useId();
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => () => validity.current(false), []);
  return (
    <Field label={label}>
      <input
        type="number"
        min={1}
        step={1}
        value={source}
        aria-invalid={invalid}
        aria-describedby={invalid ? id : undefined}
        onChange={(event) => {
          setSource(event.target.value);
          const next = event.target.valueAsNumber;
          const bad = !Number.isSafeInteger(next) || next < 1;
          setInvalid(bad);
          onValidityChange(bad);
          if (!bad) onChange(next);
        }}
      />
      {invalid && (
        <span className="admin-error" id={id}>
          Enter a positive whole number.
        </span>
      )}
    </Field>
  );
}

export function LeetcodeIDField({
  value,
  onChange,
  onValidityChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  onValidityChange: (invalid: boolean) => void;
}) {
  const [source, setSource] = useState(value === null ? "" : String(value));
  const [invalid, setInvalid] = useState(false);
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => () => validity.current(false), []);
  return (
    <Field label="LeetCode ID (global questions)">
      <input
        type="number"
        min={1}
        max={2147483647}
        step={1}
        value={source}
        aria-invalid={invalid}
        onChange={(event) => {
          const text = event.target.value;
          const number = event.target.valueAsNumber;
          const bad =
            text !== "" && (!Number.isInteger(number) || number < 1 || number > 2147483647);
          setSource(text);
          setInvalid(bad);
          onValidityChange(bad);
          if (!bad) onChange(text === "" ? null : number);
        }}
      />
      {invalid && <span className="admin-error">Enter a positive whole number.</span>}
    </Field>
  );
}
