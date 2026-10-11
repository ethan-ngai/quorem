import { Icon } from "./Icon";
import { useState } from "react";
import type { InputPresetConfig } from "@quorem/contracts";
import { innerType } from "../customCases";
import { resolveInputPreset } from "../inputPresets";

export function TypedCaseInput({
  id,
  name,
  type,
  input,
  purpose = "input",
  value,
  onChange,
}: {
  id: string;
  name: string;
  type: string;
  input?: InputPresetConfig;
  purpose?: "input" | "expected";
  value: string;
  onChange: (value: string) => void;
}) {
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
  const framed = ["sequence", "matrix", "tree", "linkedList"].includes(control.kind);
  let error = rejected;
  if (touched && !error) {
    try {
      preset.parse(value);
    } catch (cause) {
      error = (cause as Error).message;
    }
  }
  const errorId = `${id}-error`;
  const props = {
    id,
    value: preset.toEditorSource(value),
    placeholder: input?.placeholder,
    "aria-invalid": !!error,
    "aria-describedby": error ? errorId : undefined,
    onBlur: () => setTouched(true),
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
    <div className="typed-case-field">
      <div className="typed-case-label">
        <label htmlFor={id} className="value-label">
          <Icon name={purpose === "expected" ? "target" : "input"} />
          {name} <span>{type}</span>
        </label>
        {optional && (
          <button
            type="button"
            className="quiet-button"
            aria-label={empty ? `Set ${name} value` : `Set ${name} to null`}
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
            {empty ? "Set value" : "Use null"}
          </button>
        )}
      </div>
      {empty ? (
        <code className="typed-null">null</code>
      ) : control.kind === "boolean" ? (
        <select {...props}>
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      ) : (
        <div className={framed ? "typed-collection" : "typed-control"}>
          {framed && (
            <span className="collection-delimiter" aria-hidden="true">
              [
            </span>
          )}
          {control.kind === "number" ||
          ((control.kind === "sequence" || control.kind === "linkedList") &&
            (input?.rows ?? 1) === 1) ? (
            <input {...props} type="text" autoComplete="off" spellCheck={false} />
          ) : (
            <textarea {...props} rows={input?.rows ?? (framed ? 2 : 1)} spellCheck={false} />
          )}
          {framed && (
            <span className="collection-delimiter" aria-hidden="true">
              ]
            </span>
          )}
        </div>
      )}
      {error && (
        <p id={errorId} className="typed-case-error">
          {error}
        </p>
      )}
    </div>
  );
}
