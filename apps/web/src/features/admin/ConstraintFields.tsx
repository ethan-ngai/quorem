import type { Constraint, ConstraintTarget, Signature } from "@quorem/contracts";
import { SelectField } from "../../ui/SelectField";
import { Field } from "./AuthoringFields";

const kinds = ["prose", "range", "comparison", "property"] as const;
const projections = ["value", "length", "elements", "sum", "nodeCount", "nodeValues"] as const;
const operators = ["eq", "le", "lt", "ge", "gt"] as const;
const properties = ["sorted", "nondecreasing", "unique"] as const;
const labels: Record<string, string> = {
  prose: "Text",
  range: "Range",
  comparison: "Comparison",
  property: "Property",
  value: "Value",
  length: "Length",
  elements: "Each element",
  sum: "Sum",
  nodeCount: "Node count",
  nodeValues: "Each node value",
  eq: "=",
  le: "≤",
  lt: "<",
  ge: "≥",
  gt: ">",
  sorted: "Sorted",
  nondecreasing: "Nondecreasing",
  unique: "Unique",
};

function Choice<T extends string>({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  choices: readonly T[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const options = choices.includes(value) ? choices : [value, ...choices];
  return (
    <Field label={label}>
      <SelectField
        label={label}
        value={value}
        disabled={disabled}
        options={options.map((choice) => ({ value: choice, label: labels[choice] ?? choice }))}
        onChange={(next) => {
          const match = choices.find((choice) => choice === next);
          if (match) onChange(match);
        }}
      />
    </Field>
  );
}

function TargetFields({
  label,
  value,
  parameters,
  disabled,
  onChange,
}: {
  label: string;
  value: ConstraintTarget;
  parameters: string[];
  disabled: boolean;
  onChange: (value: ConstraintTarget) => void;
}) {
  return (
    <div className="admin-field-pair">
      <Choice
        label={label}
        value={value.parameter}
        choices={parameters}
        disabled={disabled}
        onChange={(parameter) => onChange({ ...value, parameter })}
      />
      <Choice
        label="Measure"
        value={value.projection}
        choices={projections}
        disabled={disabled}
        onChange={(projection) => onChange({ ...value, projection })}
      />
    </div>
  );
}

export function ConstraintFields({
  value,
  signature,
  disabled,
  onChange,
}: {
  value: Constraint[];
  signature?: Signature;
  disabled: boolean;
  onChange: (value: Constraint[]) => void;
}) {
  const parameters = [...new Set(signature?.parameters.map(({ name }) => name).filter(Boolean))];
  return (
    <>
      {value.map((rule, index) => {
        const change = (next: Constraint) =>
          onChange(value.map((item, position) => (position === index ? next : item)));
        const target = (
          label: string,
          value: ConstraintTarget,
          onChange: (next: ConstraintTarget) => void,
        ) => (
          <TargetFields
            label={label}
            value={value}
            onChange={onChange}
            parameters={parameters}
            disabled={disabled}
          />
        );
        return (
          <fieldset key={index} className="admin-fields authoring-constraint">
            <legend>Constraint {index + 1}</legend>
            <div className="authoring-inline-input">
              <Choice
                label="Rule type"
                value={rule.kind}
                choices={parameters.length ? kinds : ["prose"]}
                disabled={disabled}
                onChange={(kind) => {
                  if (kind === rule.kind) return;
                  const target: ConstraintTarget = {
                    parameter: parameters[0]!,
                    projection: "value",
                  };
                  if (kind === "prose") change({ kind, text: "" });
                  if (kind === "range") change({ kind, target, min: 0 });
                  if (kind === "property") change({ kind, target, property: "unique" });
                  if (kind === "comparison")
                    change({ kind, left: target, right: target, operator: "le" });
                }}
              />
              <button
                type="button"
                className="quiet-button authoring-remove-field"
                aria-label={`Remove constraint ${index + 1}`}
                onClick={() => onChange(value.filter((_, position) => position !== index))}
              >
                Remove
              </button>
            </div>
            {rule.kind === "prose" && (
              <Field label="Constraint text">
                <input
                  value={rule.text}
                  onChange={(event) => change({ ...rule, text: event.target.value })}
                />
              </Field>
            )}
            {(rule.kind === "range" || rule.kind === "property") &&
              target("Parameter", rule.target, (target) => change({ ...rule, target }))}
            {rule.kind === "range" && (
              <div className="admin-field-pair">
                <Field label="Minimum">
                  <input
                    type="number"
                    step="any"
                    value={rule.min ?? ""}
                    onChange={(event) => {
                      const min = event.target.valueAsNumber;
                      if (Number.isFinite(min)) change({ ...rule, min });
                      else if (!event.target.value && rule.max !== undefined)
                        change({ ...rule, min: undefined, max: rule.max });
                    }}
                  />
                </Field>
                <Field label="Maximum">
                  <input
                    type="number"
                    step="any"
                    value={rule.max ?? ""}
                    onChange={(event) => {
                      const max = event.target.valueAsNumber;
                      if (Number.isFinite(max)) change({ ...rule, max });
                      else if (!event.target.value && rule.min !== undefined)
                        change({ ...rule, min: rule.min, max: undefined });
                    }}
                  />
                </Field>
              </div>
            )}
            {rule.kind === "property" && (
              <Choice
                label="Property"
                value={rule.property}
                choices={properties}
                disabled={disabled}
                onChange={(property) => change({ ...rule, property })}
              />
            )}
            {rule.kind === "comparison" && (
              <>
                {target("Left parameter", rule.left, (left) => change({ ...rule, left }))}
                <Choice
                  label="Operator"
                  value={rule.operator}
                  choices={operators}
                  disabled={disabled}
                  onChange={(operator) => change({ ...rule, operator })}
                />
                {target("Right parameter", rule.right, (right) => change({ ...rule, right }))}
              </>
            )}
          </fieldset>
        );
      })}
      <button
        type="button"
        className="button button-secondary"
        disabled={value.length >= 64}
        onClick={() => onChange([...value, { kind: "prose", text: "" }])}
      >
        Add constraint
      </button>
    </>
  );
}
