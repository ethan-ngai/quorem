import { Plus, Trash2 } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
/** @file SignatureFields.tsx @description Shared typed method contract controls for question authors. @module admin */
import { SelectField } from "../../ui/SelectField";
import type { Signature } from "@quorem/contracts";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { MethodSignature } from "../editor/components/MethodSignature";
import { Field } from "./AuthoringFields";
import { ValueTypeField } from "./ValueTypeField";
export function SignatureFields({
  value,
  onChange,
  allowVoid = false,
  disabled = false,
  onValidityChange,
  previewControl,
}: {
  value: Signature;
  onChange: (value: Signature) => void;
  allowVoid?: boolean;
  disabled?: boolean;
  previewControl?: ReactNode;
  onValidityChange?: (label: string, invalid: boolean) => void;
}) {
  const documented = value;
  const namesId = useId();
  const identifier = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  const invalidMethod = !identifier.test(value.methodName);
  const invalidParameter = (name: string) =>
    !identifier.test(name) ||
    value.parameters.filter((parameter) => parameter.name === name).length > 1;
  const invalidNames = invalidMethod || value.parameters.some(({ name }) => invalidParameter(name));
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => {
    validity.current?.(namesId, invalidNames);
  }, [namesId, invalidNames]);
  useEffect(() => () => validity.current?.(namesId, false), [namesId]);
  const updateParameter = (index: number, patch: Partial<Signature["parameters"][number]>) =>
    onChange({
      ...value,
      parameters: value.parameters.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    });
  return (
    <fieldset className="admin-fields" aria-labelledby={`${namesId}-method`}>
      <div className="admin-method-heading">
        <span id={`${namesId}-method`}>Method</span>
        {previewControl}
      </div>
      <div className="authoring-signature-line">
        <MethodSignature signature={value} showDocumentation />
      </div>
      <div className="authoring-signature-fields">
        <label className="admin-field">
          <span>Method name</span>
          <input
            className="admin-code"
            value={value.methodName}
            aria-invalid={invalidMethod}
            onChange={(event) => onChange({ ...value, methodName: event.target.value })}
            required
            pattern="[a-zA-Z_][a-zA-Z0-9_]*"
          />
        </label>
        <ValueTypeField
          disabled={disabled}
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
        {(value.returnType.startsWith("list<") || value.returnType.startsWith("array<")) && (
          <Field label="Return order">
            <SelectField
              label="Return order"
              value={value.outputOrder ?? "ordered"}
              onChange={(outputOrder) => {
                if (outputOrder === "ordered" || outputOrder === "unordered")
                  onChange({ ...value, outputOrder });
              }}
              options={[
                { value: "ordered", label: "Ordered" },
                { value: "unordered", label: "Any order" },
              ]}
            />
          </Field>
        )}
      </div>
      {invalidNames && (
        <p className="admin-error">Use valid identifiers and unique parameter names.</p>
      )}
      <div className="authoring-parameters-heading">
        <h3>Parameters</h3>
        <button
          type="button"
          className="quiet-button"
          disabled={value.parameters.length >= 16}
          onClick={() => {
            let next = value.parameters.length + 1;
            while (value.parameters.some(({ name }) => name === `arg${next}`)) next++;
            onChange({
              ...value,
              parameters: [...value.parameters, { name: `arg${next}`, type: "int" }],
            });
          }}
        >
          <Plus size={15} aria-hidden="true" /> Add parameter
        </button>
      </div>
      {!!value.parameters.length && (
        <div className="authoring-parameter-row authoring-parameter-columns" aria-hidden="true">
          <span>Name</span>
          <span>Type</span>
          <span>Description</span>
        </div>
      )}
      {value.parameters.map((parameter, index) => (
        <div className="authoring-parameter-row" key={index}>
          <div className="admin-field">
            <input
              aria-label={`Parameter ${index + 1} name`}
              className="admin-code"
              value={parameter.name}
              aria-invalid={invalidParameter(parameter.name)}
              required
              pattern="[a-zA-Z_][a-zA-Z0-9_]*"
              onChange={(event) => updateParameter(index, { name: event.target.value })}
            />
          </div>
          <ValueTypeField
            hideLabel
            disabled={disabled}
            label={`Parameter ${index + 1} type`}
            value={parameter.type}
            onValidityChange={onValidityChange}
            onChange={(type) => updateParameter(index, { type })}
          />
          <div className="admin-field authoring-parameter-description">
            <input
              aria-label={`Parameter ${index + 1} description`}
              placeholder="Optional description"
              className="code-doc-comment"
              value={parameter.description ?? ""}
              onChange={(event) => updateParameter(index, { description: event.target.value })}
            />
          </div>
          <Tooltip content="Remove parameter">
            <button
              type="button"
              className="icon-button destructive-icon authoring-parameter-remove"
              aria-label={`Remove parameter ${parameter.name}`}
              onClick={() =>
                onChange({
                  ...value,
                  parameters: value.parameters.filter((_, position) => position !== index),
                })
              }
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      ))}
      <details className="authoring-options">
        <summary>Method documentation</summary>
        <label className="admin-field">
          <span>Method description</span>
          <textarea
            rows={3}
            className="code-doc-comment"
            value={documented.description ?? ""}
            onChange={(event) => onChange({ ...value, description: event.target.value })}
          />
        </label>
        {value.returnType !== "void" && (
          <label className="admin-field">
            <span>Return description</span>
            <textarea
              rows={2}
              className="code-doc-comment"
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
                  className="code-doc-comment"
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
                  className="code-doc-comment"
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
              <Tooltip content="Remove exception">
                <button
                  type="button"
                  className="icon-button destructive-icon"
                  aria-label={`Remove exception ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...value,
                      throws: documented.throws!.filter((_, position) => position !== index),
                    })
                  }
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </Tooltip>
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
      </details>
    </fieldset>
  );
}
