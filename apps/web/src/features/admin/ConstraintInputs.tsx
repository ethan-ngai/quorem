import {
  Tally5,
  Hash,
  Ruler,
  ListOrdered,
  Sigma,
  CircleHelp,
  CaseSensitive,
  SlidersHorizontal,
  Trash2,
  Plus,
} from "lucide-react";
import type { Constraint, ConstraintTarget } from "@quorem/contracts";
import { constraintTargetOptions, sequenceTarget } from "@quorem/questions";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { SelectField } from "../../ui/SelectField";
import { TextInput } from "../../ui/TextControl";
import * as Popover from "../../ui/Popover";
import {
  arithmeticOperators,
  formatMeasurement,
  formatTarget,
} from "../editor/constraintFormatter";
import { Tooltip } from "../../ui/Tooltip";
import { inlineStatement } from "../editor/components/StatementMarkdown";

const measures = {
  value: { label: "Value", icon: Hash },
  length: { label: "Length", icon: Ruler },
  elements: { label: "Each element", icon: ListOrdered },
  sum: { label: "Sum", icon: Sigma },
  nodeCount: { label: "Node count", icon: Tally5 },
  nodeValues: { label: "Node values", icon: Hash },
  indices: { label: "Each index", icon: Hash },
  diagonal: { label: "Diagonal", icon: ListOrdered },
  columns: { label: "Columns", icon: ListOrdered },
  graph: { label: "Graph", icon: Hash },
  characters: { label: "Each character", icon: CaseSensitive },
} as const;
export function MathOperator({ source, className = "" }: { source: string; className?: string }) {
  return (
    <span className={`constraint-operator ${className}`} aria-hidden="true">
      {inlineStatement(`$${source}$`)}
    </span>
  );
}
export function BoundRelation({
  label,
  inclusive,
  disabled,
  onChange,
  className,
}: {
  label: string;
  inclusive: boolean;
  disabled: boolean;
  onChange: (inclusive: boolean) => void;
  className: string;
}) {
  return (
    <div className={className}>
      <Tooltip content={inclusive ? "Inclusive bound (≤)" : "Strict bound (<)"}>
        <button
          type="button"
          className="icon-button bound-toggle"
          aria-label={`Include ${label.toLowerCase()}`}
          aria-pressed={inclusive}
          disabled={disabled}
          onClick={() => onChange(!inclusive)}
        >
          <span className="bound-symbol" data-inclusive={inclusive}>
            <span className="bound-angle">
              <MathOperator source={"\\le"} />
            </span>
            <span className="bound-inclusive-line">
              <MathOperator source={"\\le"} />
            </span>
          </span>
        </button>
      </Tooltip>
    </div>
  );
}

export function Quantifier({
  label,
  value,
  disabled,
  onChange,
  pairs = false,
}: {
  pairs?: boolean;
  label: string;
  value: "all" | "any" | undefined;
  disabled: boolean;
  onChange: (value: "all" | "any") => void;
}) {
  return (
    <div className="constraint-quantifier">
      <SegmentedControl
        label={label}
        value={value ?? "all"}
        disabled={disabled}
        iconOnly
        options={[
          {
            value: "all",
            label: pairs ? "All pairs (∀)" : "All values (∀)",
            icon: <MathOperator source={"\\forall"} />,
          },
          {
            value: "any",
            label: pairs ? "Any pair (∃)" : "Any value (∃)",
            icon: <MathOperator source={"\\exists"} />,
          },
        ]}
        onChange={onChange}
      />
    </div>
  );
}

export function initialConstraint(
  kind: Exclude<Constraint["kind"], "prose">,
  target: ConstraintTarget,
): Constraint {
  if (kind === "range") return { kind, target, min: 0 };
  if (kind === "definition") return { kind, target, name: "" };
  if (kind === "membership") return { kind, target, values: [] };
  if (kind === "comparison") return { kind, left: target, right: target, operator: "le" };
  return { kind, target, property: "unique" };
}

/** Available targets come from the domain policy shared with admission. */
export const constraintTargets = constraintTargetOptions;

export function Target({
  label,
  value,
  targets,
  disabled,
  arithmeticTargets,
  onChange,
}: {
  label: string;
  value: ConstraintTarget;
  targets: ConstraintTarget[];
  arithmeticTargets?: ConstraintTarget[];
  disabled: boolean;
  onChange: (value: ConstraintTarget) => void;
}) {
  if (!targets.length)
    return (
      <Tooltip content="No compatible input">
        <span
          role="img"
          aria-label="No compatible input"
          className="constraint-measure"
          tabIndex={0}
        >
          <CircleHelp size={15} aria-hidden="true" />
        </span>
      </Tooltip>
    );
  const options = targets;
  const parameters = [...new Set(options.map((target) => target.parameter))];
  const projections = options.filter((target) => target.parameter === value.parameter);
  const measure = measures[value.projection];
  const measurementKey = (target: ConstraintTarget) =>
    JSON.stringify([target.projection, target.path ?? []]);
  const nested = projections.some((target) => target.path) || !!value.path;
  const measurements = projections.some(
    (target) => measurementKey(target) === measurementKey(value),
  )
    ? projections
    : [...projections, value];
  const MeasureIcon = measure.icon;
  function selectParameter(parameter: string) {
    const next =
      options.find(
        (target) => target.parameter === parameter && target.projection === value.projection,
      ) ?? options.find((target) => target.parameter === parameter);
    if (next) onChange(next);
  }
  return (
    <div className="constraint-target">
      {parameters.length === 1 && parameters[0] === value.parameter ? (
        <code className="mono-text">{value.parameter}</code>
      ) : parameters.length <= 4 ? (
        <SegmentedControl
          label={`${label} parameter`}
          mono
          value={value.parameter}
          disabled={disabled}
          options={parameters.map((parameter) => ({ value: parameter, label: parameter }))}
          onChange={selectParameter}
        />
      ) : (
        <SelectField
          label={`${label} parameter`}
          mono
          value={value.parameter}
          disabled={disabled}
          options={parameters.map((parameter) => ({ value: parameter, label: parameter }))}
          onChange={selectParameter}
        />
      )}
      {nested ? (
        <SelectField
          label={label}
          mono
          value={measurementKey(value)}
          disabled={disabled}
          options={measurements.map((target) => ({
            value: measurementKey(target),
            label:
              target.projection === "value" &&
              target.path?.length === 1 &&
              target.path[0] === "each"
                ? `${target.parameter}[index]`
                : formatTarget(target, true),
          }))}
          onChange={(key) => {
            const target = measurements.find((candidate) => measurementKey(candidate) === key);
            if (target)
              onChange({
                ...target,
                offset: value.offset,
                operations: value.operations,
                total: sequenceTarget(target) ? value.total : undefined,
              });
          }}
        />
      ) : (
        projections.length > 0 &&
        (projections.length > 1 ||
        !projections.some((target) => target.projection === value.projection) ? (
          <SegmentedControl
            label={label}
            iconOnly
            value={value.projection}
            disabled={disabled}
            options={projections.map((target) => {
              const { label, icon: Icon } = measures[target.projection];
              return {
                value: target.projection,
                label,
                icon: <Icon size={15} aria-hidden="true" />,
              };
            })}
            onChange={(projection) => onChange({ ...value, projection })}
          />
        ) : (
          <Tooltip content={measure.label}>
            <span className="constraint-measure" role="img" aria-label={measure.label} tabIndex={0}>
              <MeasureIcon size={15} aria-hidden="true" />
            </span>
          </Tooltip>
        ))
      )}
      {(value.path || arithmeticTargets?.length) && (
        <Popover.Root>
          <Tooltip content="Measurement settings">
            <Popover.Trigger asChild>
              <button
                type="button"
                className="icon-button"
                aria-label={`${label} settings`}
                disabled={disabled}
              >
                <SlidersHorizontal size={14} aria-hidden="true" />
              </button>
            </Popover.Trigger>
          </Tooltip>
          <Popover.Portal>
            <Popover.Content
              align="start"
              className="constraint-target-settings"
              aria-label={`${label} settings`}
            >
              {value.path?.map((step, index) => (
                <label key={index}>
                  Index {index + 1}
                  <TextInput
                    mono
                    inputMode="numeric"
                    placeholder="Each"
                    value={step === "each" ? "" : step}
                    onChange={(event) => {
                      const input = event.target.value;
                      if (/^\d{0,5}$/.test(input))
                        onChange({
                          ...value,
                          path: value.path!.map((current, i) =>
                            i === index ? (input === "" ? "each" : Number(input)) : current,
                          ),
                        });
                    }}
                  />
                </label>
              ))}
              {!!arithmeticTargets?.length && (
                <TargetArithmetic
                  value={value}
                  targets={arithmeticTargets}
                  onChange={onChange}
                  label={label}
                />
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      {value.offset || value.total || value.operations?.length ? (
        <code className="mono-text" aria-label="Computed measurement">
          {formatMeasurement(value, true)}
        </code>
      ) : null}
    </div>
  );
}

function TargetArithmetic({
  value,
  targets,
  onChange,
  label,
}: {
  value: ConstraintTarget;
  targets: ConstraintTarget[];
  onChange: (value: ConstraintTarget) => void;
  label: string;
}) {
  const operations = value.operations ?? [];
  const update = (operations: ConstraintTarget["operations"]) =>
    onChange({ ...value, operations: operations?.length ? operations : undefined });
  const base = { ...value, total: undefined, operations: undefined };
  return (
    <>
      {sequenceTarget(base) && (
        <label className="constraint-total">
          <input
            type="checkbox"
            checked={!!value.total}
            onChange={(event) => onChange({ ...value, total: event.target.checked || undefined })}
          />
          Total projected values
        </label>
      )}
      <label>
        Offset
        <IntegerInput
          value={value.offset ?? 0}
          label={`${label} offset`}
          onChange={(offset) => onChange({ ...value, offset: offset || undefined })}
        />
      </label>
      {operations.map(({ operator, operand }, index) => {
        const change = (next: NonNullable<ConstraintTarget["operations"]>[number]) =>
          update(operations.map((item, i) => (i === index ? next : item)));
        return (
          <div className="constraint-arithmetic-row" key={index}>
            <SelectField
              label={`${label} operation ${index + 1}`}
              value={operator}
              options={Object.entries(arithmeticOperators).map(([value, label]) => ({
                value,
                label,
              }))}
              onChange={(value) => change({ operator: value as typeof operator, operand })}
            />
            <SegmentedControl
              label={`${label} operand ${index + 1} source`}
              value={typeof operand === "number" ? "number" : "input"}
              options={[
                { value: "number", label: "Number" },
                { value: "input", label: "Input" },
              ]}
              onChange={(mode) =>
                change({ operator, operand: mode === "number" ? 1 : targets[0]! })
              }
            />
            {typeof operand === "number" ? (
              <IntegerInput
                value={operand}
                label={`${label} operand ${index + 1}`}
                onChange={(operand) => change({ operator, operand })}
              />
            ) : (
              <Target
                label={`${label} operand ${index + 1}`}
                value={operand}
                targets={targets}
                arithmeticTargets={targets}
                disabled={false}
                onChange={(operand) => change({ operator, operand })}
              />
            )}
            <Tooltip content="Remove operation">
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove operation ${index + 1}`}
                onClick={() => update(operations.filter((_, i) => index !== i))}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        );
      })}
      <button
        type="button"
        className="button button-ghost"
        disabled={operations.length >= 4}
        onClick={() => update([...operations, { operator: "add", operand: 1 }])}
      >
        <Plus size={14} aria-hidden="true" /> Add operation
      </button>
    </>
  );
}

function IntegerInput({
  value,
  label,
  onChange,
}: {
  value: number;
  label: string;
  onChange: (value: number) => void;
}) {
  return (
    <TextInput
      mono
      type="number"
      step={1}
      aria-label={label}
      defaultValue={value}
      onBlur={(event) => {
        const n = event.target.valueAsNumber;
        if (Number.isSafeInteger(n)) onChange(n);
        else event.target.value = String(value);
      }}
    />
  );
}
