/** @file SignatureFields.tsx @description Shared typed method contract controls for question authors. @module admin */
import type { Signature } from "@quorem/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { Field } from "./AuthoringFields";
import { resolveInputPreset } from "../editor/inputPresets";
const types = [
  "int",
  "float",
  "str",
  "bool",
  "list<int>",
  "list<float>",
  "list<str>",
  "list<bool>",
  "list<list<int>>",
  "optional<int>",
  "ListNode",
  "TreeNode",
].map((value) => ({ value, label: value }));
export function SignatureFields({
  value,
  onChange,
  allowVoid = false,
  onValidityChange,
}: {
  value: Signature;
  onChange: (value: Signature) => void;
  allowVoid?: boolean;
  onValidityChange?: (label: string, invalid: boolean) => void;
}) {
  return (
    <fieldset className="admin-fields">
      <legend>Method</legend>
      <div className="admin-field-pair">
        <label className="admin-field">
          <span>Class</span>
          <input value={value.className} readOnly required />
        </label>
        <label className="admin-field">
          <span>Method name</span>
          <input
            value={value.methodName}
            onChange={(event) => onChange({ ...value, methodName: event.target.value })}
            required
            pattern="[a-zA-Z_][a-zA-Z0-9_]*"
          />
        </label>
      </div>
      {value.parameters.map((parameter, index) => (
        <div className="admin-field-pair" key={index}>
          <label className="admin-field">
            <span>Parameter name</span>
            <input
              value={parameter.name}
              required
              pattern="[a-zA-Z_][a-zA-Z0-9_]*"
              onChange={(event) =>
                onChange({
                  ...value,
                  parameters: value.parameters.map((item, position) =>
                    position === index ? { ...item, name: event.target.value } : item,
                  ),
                })
              }
            />
          </label>
          <TypeField
            label={`Type of ${parameter.name}`}
            value={parameter.type}
            onValidityChange={onValidityChange}
            onChange={(type) =>
              onChange({
                ...value,
                parameters: value.parameters.map((item, position) =>
                  position === index ? { ...item, type } : item,
                ),
              })
            }
          />
          <button
            type="button"
            className="quiet-button"
            aria-label={`Remove parameter ${parameter.name}`}
            onClick={() =>
              onChange({
                ...value,
                parameters: value.parameters.filter((_, position) => position !== index),
              })
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="quiet-button"
        disabled={value.parameters.length >= 16}
        onClick={() =>
          onChange({
            ...value,
            parameters: [
              ...value.parameters,
              { name: `arg${value.parameters.length + 1}`, type: "int" },
            ],
          })
        }
      >
        Add parameter
      </button>
      <TypeField
        label="Return type"
        value={value.returnType}
        allowVoid={allowVoid}
        onValidityChange={onValidityChange}
        onChange={(returnType) => onChange({ ...value, returnType })}
      />
    </fieldset>
  );
}

/** Preserve incomplete type expressions locally; native form validity prevents stale signatures being submitted. */
function TypeField({
  label,
  value,
  onChange,
  allowVoid = false,
  onValidityChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowVoid?: boolean;
  onValidityChange?: (label: string, invalid: boolean) => void;
}) {
  const id = useId();
  const [source, setSource] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => {
    setSource(value);
    setInvalid(false);
    input.current?.setCustomValidity("");
    validity.current?.(id, false);
  }, [value, id]);
  useEffect(() => () => validity.current?.(id, false), [id]);
  return (
    <Field label={label}>
      <input
        ref={input}
        value={source}
        list={`${id}-types`}
        required
        aria-invalid={invalid}
        onChange={(event) => {
          const next = event.target.value;
          setSource(next);
          let accepted = false;
          try {
            if (next === "void") accepted = allowVoid;
            else {
              resolveInputPreset(next);
              accepted = true;
            }
          } catch {
            /* Incomplete nested types remain editable. */
          }
          setInvalid(!accepted);
          event.currentTarget.setCustomValidity(
            accepted ? "" : "Enter a supported type expression.",
          );
          validity.current?.(id, !accepted);
          if (accepted) onChange(next);
        }}
      />
      <datalist id={`${id}-types`}>
        {types.map((type) => (
          <option key={type.value} value={type.value} />
        ))}
        {allowVoid && <option value="void" />}
      </datalist>
      {invalid && <span className="admin-error">Enter a supported type expression.</span>}
    </Field>
  );
}
