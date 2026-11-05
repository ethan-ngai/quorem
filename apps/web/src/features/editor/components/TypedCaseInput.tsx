import { NoticeRegion } from "../../../ui/PersistentNotice";
import { useNodeReferenceSelection } from "./NodePreview";
import "./machine-values.css";
import { useQuestionLanguage } from "../QuestionLanguage";
import { TypeSyntax } from "./TypeSyntax";
import { questionValue } from "../questionTypes";
import { Tooltip } from "../../../ui/Tooltip";
import { SelectField } from "../../../ui/SelectField";
import { Icon } from "../../../ui/Icon";
import { useState, useRef, type ReactNode } from "react";
import { innerType } from "../customCases";
import { resolveInputPreset, type InputConfig } from "../inputPresets";

export function TypedCaseInput({
  id,
  name,
  type,
  input,
  purpose = "input",
  action,
  value,
  onChange,
}: {
  id: string;
  name: string;
  type: string;
  input?: InputConfig;
  purpose?: "input" | "expected";
  action?: ReactNode;
  value: string;
  onChange: (value: string) => void;
}) {
  const language = useQuestionLanguage();
  const referenceSelection = useNodeReferenceSelection();
  const change = useRef(onChange);
  change.current = onChange;
  const nullLabel = questionValue(null, language);
  const [touched, setTouched] = useState(false);
  const [rejected, setRejected] = useState<string>();
  let preset: ReturnType<typeof resolveInputPreset>;
  try {
    preset = resolveInputPreset(type, input);
  } catch {
    return (
      <div className="typed-case-field">
        <label>{name}</label>
        <p className="typed-case-error">This input preset is unavailable.</p>
      </div>
    );
  }
  const optional = innerType(type, "optional");
  const empty = optional !== undefined && value.trim() === "null";
  let controlType = type;
  while (innerType(controlType, "optional")) controlType = innerType(controlType, "optional")!;
  const control = optional ? resolveInputPreset(controlType, input) : preset;
  const framed = !!control.delimiters;
  let error = rejected;
  if (touched && !error) {
    try {
      preset.parse(value);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Check the input format.";
    }
  }
  const errorId = `${id}-error`;
  const props = {
    id,
    value: preset.toEditorSource(value),
    placeholder: input?.placeholder,
    "aria-invalid": !!error,
    "aria-describedby": error ? errorId : undefined,
    onBlur: () => {
      setTouched(true);
      if (preset.autoformat) {
        try {
          onChange(preset.format(preset.parse(value)));
        } catch {
          /* Keep incomplete input editable. */
        }
      }
    },
    onChange: (event: { target: { value: string } }) => {
      const source = event.target.value;
      if (!preset.accepts(source)) {
        setRejected("This input does not accept those characters.");
        return;
      }
      setRejected(undefined);
      onChange(preset.fromEditorSource(source));
    },
  };
  return (
    <div
      className="typed-case-field"
      onFocusCapture={(event) => {
        if (
          input?.nodeReference &&
          (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        )
          referenceSelection?.select({
            type: controlType,
            name,
            choose: (reference) => change.current(reference),
          });
      }}
    >
      <div className="typed-case-label">
        <label htmlFor={id}>
          {purpose === "input" ? <code className="parameter-name">{name}</code> : name}{" "}
          <code className="typed-case-type">
            <TypeSyntax type={type} />
          </code>
        </label>
        {action}
        {optional && (
          <button
            type="button"
            className="quiet-button"
            aria-label={empty ? `Set ${name} value` : `Set ${name} to ${nullLabel}`}
            onClick={() => {
              setTouched(false);
              setRejected(undefined);
              onChange(
                empty
                  ? preset.fromEditorSource(
                      control.kind === "number" ? "0" : control.kind === "boolean" ? "false" : "",
                    )
                  : "null",
              );
            }}
          >
            {empty ? "Set value" : `Use ${nullLabel}`}
          </button>
        )}
      </div>

      <NoticeRegion id={errorId} message={error} label={`Check ${name}`}>
        <div className="typed-input-row">
          <Tooltip content={purpose === "expected" ? "Expected output" : "Input"}>
            <span
              tabIndex={0}
              className="field-purpose"
              aria-label={purpose === "expected" ? "Expected output" : "Input"}
            >
              <Icon name={purpose === "expected" ? "target" : "input"} />
            </span>
          </Tooltip>
          {empty ? (
            <code className="typed-null">{nullLabel}</code>
          ) : control.kind === "boolean" ? (
            <SelectField
              label={name}
              value={props.value}
              options={[
                { value: "false", label: questionValue(false, language) },
                { value: "true", label: questionValue(true, language) },
              ]}
              onChange={(source) => props.onChange({ target: { value: source } })}
              triggerProps={{
                id,
                "aria-invalid": props["aria-invalid"],
                "aria-describedby": props["aria-describedby"],
                onBlur: props.onBlur,
              }}
            />
          ) : (
            <div
              className={`${framed ? "typed-collection" : "typed-control"}${control.kind === "tree" ? " typed-node-literal" : ""}`}
            >
              {framed && (
                <span className="collection-delimiter" aria-hidden="true">
                  {control.delimiters![0]}
                </span>
              )}
              {control.kind === "number" ||
              ((control.kind === "sequence" || control.kind === "linkedList") &&
                (input?.rows ?? 1) === 1) ? (
                <input {...props} type="text" autoComplete="off" spellCheck={false} />
              ) : (
                <textarea
                  {...props}
                  rows={
                    input?.rows ??
                    (control.kind === "tree"
                      ? Math.min(12, Math.max(1, props.value.split("\n").length))
                      : control.kind === "text"
                        ? 1
                        : framed
                          ? 2
                          : 1)
                  }
                  spellCheck={false}
                />
              )}
              {framed && (
                <span className="collection-delimiter" aria-hidden="true">
                  {control.delimiters![1]}
                </span>
              )}
            </div>
          )}
        </div>
      </NoticeRegion>
    </div>
  );
}
