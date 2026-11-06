import { NoticeRegion } from "../../ui/PersistentNotice";
import { inputConstraints, validateInput, withMaxBytes } from "../../ui/input-constraints";
import { TextInput } from "../../ui/TextControl";
import { AnimatedRows } from "../../ui/AnimatedRows";
import "../../ui/topic-chip.css";
import { formatLabel } from "../../ui/formatLabel";
import { Plus, Tags, X, Hash } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  hideLabel = false,
  onChange,
}: {
  label: string;
  language: EditorLanguage;
  source: string;
  disabled: boolean;
  hideLabel?: boolean;
  onChange: (source: string) => void;
}) {
  const id = useId();
  const { theme } = useTheme();
  const preferences = useLocalEditorPreferences();
  return (
    <div className="admin-field">
      <span id={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </span>
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
  icon = <Tags size={14} aria-hidden="true" />,
}: {
  tags: string[];
  label?: string;
  limit?: number;
  icon?: ReactNode;
  onChange: (tags: string[]) => void;
}) {
  const [source, setSource] = useState("");
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const baseTagConstraint = withMaxBytes(inputConstraints.tag, label === "Topics" ? 64 : 80);
  const tagConstraint =
    label === "Topics"
      ? baseTagConstraint
      : {
          ...baseTagConstraint,
          edit: (value: string) => baseTagConstraint.edit(value) && !value.includes(","),
          schema: baseTagConstraint.schema.refine((value) => !value.includes(",")),
        };
  const next = source.trim();
  const canAdd =
    tags.length < limit &&
    validateInput(next, tagConstraint).success &&
    !tags.some((tag) => tag.toLowerCase() === next.toLowerCase());
  function add() {
    if (!canAdd) return;
    onChange([...tags, next]);
    setSource("");
  }
  return (
    <div className="admin-field">
      <label htmlFor={id} className="admin-icon-label">
        {icon}
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
            constraint={tagConstraint}
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
  icon,
  hint,
  unit,
  scale = 1,
  value,
  onChange,
  onValidityChange,
}: {
  label: string;
  icon?: ReactNode;
  hint?: string;
  unit?: string;
  scale?: number;
  value: number;
  onChange: (value: number) => void;
  onValidityChange: (invalid: boolean, message?: string) => void;
}) {
  const [source, setSource] = useState(String(value / scale));
  const [invalid, setInvalid] = useState(false);
  const error = `${label}: ${scale === 1 ? "positive integer required" : "use a positive value in whole bytes"}.`;
  const id = useId();
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => () => validity.current(false), []);
  const constraint =
    scale === 1
      ? inputConstraints.integer({ min: 1, max: Number.MAX_SAFE_INTEGER })
      : inputConstraints.decimal({ min: 0, max: Number.MAX_SAFE_INTEGER / scale });
  return (
    <NoticeRegion id={id} message={invalid ? error : undefined} label={`Check ${label}`}>
      <Field label={label} icon={icon} hint={hint} unit={unit}>
        <TextInput
          mono
          constraint={constraint}
          aria-label={unit ? `${label} (${unit})` : label}
          type="text"
          inputMode={scale === 1 ? "numeric" : "decimal"}
          value={source}
          aria-invalid={invalid}
          aria-describedby={invalid ? id : undefined}
          onChange={(event) => {
            setSource(event.target.value);
            const next = event.target.value === "" ? NaN : Number(event.target.value) * scale;
            const bad =
              !validateInput(event.target.value, constraint).success ||
              !Number.isSafeInteger(next) ||
              next < 1;
            setInvalid(bad);
            onValidityChange(bad, bad ? error : undefined);
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
      message={invalid ? "LeetCode ID: use an integer from 1 to 2147483647." : undefined}
      label="Check LeetCode ID"
      id={id}
    >
      <Field
        label="LeetCode ID"
        icon={<Hash size={14} aria-hidden="true" />}
        hint="Optional source question ID"
      >
        <TextInput
          mono
          constraint={inputConstraints.integer({ min: 1, max: 2147483647 })}
          aria-label="LeetCode ID"
          type="text"
          inputMode="numeric"
          value={source}
          aria-invalid={invalid}
          aria-describedby={invalid ? id : undefined}
          onChange={(event) => {
            const text = event.target.value;
            const number = Number(text);
            const bad =
              text !== "" &&
              !validateInput(text, inputConstraints.integer({ min: 1, max: 2147483647 })).success;
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
