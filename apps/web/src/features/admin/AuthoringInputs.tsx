import { NoticeRegion } from "../../ui/PersistentNotice";
import { TextInput } from "../../ui/TextControl";
import { AnimatedRows } from "../../ui/AnimatedRows";
import "../../ui/topic-chip.css";
import { formatLabel } from "../../ui/formatLabel";
import { Plus, Tags, X } from "lucide-react";
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
  label = "Topics",
  limit = 32,
}: {
  tags: string[];
  label?: string;
  limit?: number;
  onChange: (tags: string[]) => void;
}) {
  const [source, setSource] = useState("");
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const next = source.trim();
  const canAdd =
    tags.length < limit && !!next && !tags.some((tag) => tag.toLowerCase() === next.toLowerCase());
  function add() {
    if (!canAdd) return;
    onChange([...tags, next]);
    setSource("");
  }
  return (
    <div className="admin-field">
      <label htmlFor={id} className="admin-icon-label">
        <Tags size={14} aria-hidden="true" />
        {label}
      </label>
      <div className="authoring-tag-entry">
        <AnimatedRows
          as="ul"
          inline
          className="authoring-chips"
          label={label}
          items={tags}
          focusFallback={field}
          getKey={(tag) => tag}
          renderRow={(tag, index) => (
            <span className="topic-chip">
              {formatLabel(tag)}
              <button
                type="button"
                aria-label={`Remove ${formatLabel(tag)}`}
                onClick={() => onChange(tags.filter((_, position) => position !== index))}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          )}
        />
        <div className="authoring-inline-input">
          <TextInput
            id={id}
            ref={field}
            placeholder={label === "Topics" ? "Add topic…" : "Add company…"}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              add();
            }}
          />
          <button
            type="button"
            className="button button-secondary"
            disabled={!canAdd}
            onClick={add}
          >
            <Plus size={14} aria-hidden="true" /> Add
          </button>
        </div>
      </div>
    </div>
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
    <NoticeRegion
      id={id}
      message={invalid ? "Enter a positive whole number." : undefined}
      label={`Check ${label}`}
    >
      <Field label={label}>
        <TextInput
          mono
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
      </Field>
    </NoticeRegion>
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
  const id = useId();
  const [invalid, setInvalid] = useState(false);
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => () => validity.current(false), []);
  return (
    <NoticeRegion
      message={invalid ? "Enter a positive whole number." : undefined}
      label="Check LeetCode ID"
      id={id}
    >
      <Field label="LeetCode ID (global questions)">
        <TextInput
          mono
          type="number"
          min={1}
          max={2147483647}
          step={1}
          value={source}
          aria-invalid={invalid}
          aria-describedby={invalid ? id : undefined}
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
      </Field>
    </NoticeRegion>
  );
}
