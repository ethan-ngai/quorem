/** @file SignatureFields.tsx @description Shared typed method contract controls for question authors. @module admin */
import { SelectField } from "../../ui/SelectField";
import type { Signature } from "@quorem/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { Field } from "./AuthoringFields";
import { supportedType } from "../editor/typedValues";
const types = [
  "int",
  "float",
  "str",
  "bool",
  "datetime",
  "array<int>",
  "array<str>",
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
  const documented = value;
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
      <label className="admin-field">
        <span>Method description</span>
        <textarea
          rows={3}
          value={documented.description ?? ""}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
        />
      </label>
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
          <label className="admin-field">
            <span>Parameter description</span>
            <input
              value={(parameter as { description?: string }).description ?? ""}
              onChange={(event) =>
                onChange({
                  ...value,
                  parameters: value.parameters.map((item, position) =>
                    position === index ? { ...item, description: event.target.value } : item,
                  ),
                })
              }
            />
          </label>
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
        onChange={(returnType) =>
          onChange({
            ...value,
            returnType,
            outputOrder:
              returnType.startsWith("list<") || returnType.startsWith("array<")
                ? value.outputOrder
                : undefined,
          })
        }
      />
      {value.returnType !== "void" && (
        <label className="admin-field">
          <span>Return description</span>
          <textarea
            rows={2}
            value={documented.returns ?? ""}
            onChange={(event) => onChange({ ...value, returns: event.target.value })}
          />
        </label>
      )}
      <fieldset className="admin-fields">
        <legend>Exceptions</legend>
        {(documented.throws ?? []).map((exception, index) => (
          <div className="admin-field-pair" key={index}>
            <label className="admin-field">
              <span>Exception type</span>
              <input
                value={exception.type}
                onChange={(event) =>
                  onChange({
                    ...value,
                    throws: documented.throws!.map((item, position) =>
                      position === index ? { ...item, type: event.target.value } : item,
                    ),
                  })
                }
              />
            </label>
            <label className="admin-field">
              <span>Exception description</span>
              <input
                value={exception.description}
                onChange={(event) =>
                  onChange({
                    ...value,
                    throws: documented.throws!.map((item, position) =>
                      position === index ? { ...item, description: event.target.value } : item,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              className="quiet-button"
              aria-label={`Remove exception ${index + 1}`}
              onClick={() =>
                onChange({
                  ...value,
                  throws: documented.throws!.filter((_, position) => position !== index),
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
          onClick={() =>
            onChange({
              ...value,
              throws: [...(documented.throws ?? []), { type: "", description: "" }],
            })
          }
        >
          Add exception
        </button>
      </fieldset>
      {(value.returnType.startsWith("list<") || value.returnType.startsWith("array<")) && (
        <Field label="Return order">
          <SelectField
            label="Return order"
            value={value.outputOrder ?? "ordered"}
            onChange={(outputOrder) =>
              onChange({ ...value, outputOrder: outputOrder as "ordered" | "unordered" })
            }
            options={[
              { value: "ordered", label: "Ordered" },
              { value: "unordered", label: "Any order" },
            ]}
          />
        </Field>
      )}
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
          const accepted = next === "void" ? allowVoid : supportedType(next);
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
