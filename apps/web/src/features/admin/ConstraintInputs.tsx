import { Tally5, Hash, Ruler, ListOrdered, Sigma, CircleHelp } from "lucide-react";
import type { Constraint, ConstraintTarget } from "@quorem/contracts";
import { constraintTargetOptions } from "@quorem/questions";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { SelectField } from "../../ui/SelectField";
import { Tooltip } from "../../ui/Tooltip";
import { inlineStatement } from "../editor/components/StatementMarkdown";

const measures = {
  value: { label: "Value", icon: Hash },
  length: { label: "Length", icon: Ruler },
  elements: { label: "Each element", icon: ListOrdered },
  sum: { label: "Sum", icon: Sigma },
  nodeCount: { label: "Node count", icon: Tally5 },
  nodeValues: { label: "Node values", icon: Hash },
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
            label: pairs ? "Every value pair (∀)" : "Every value (∀)",
            icon: <MathOperator source={"\\forall"} />,
          },
          {
            value: "any",
            label: pairs ? "At least one value pair (∃)" : "At least one value (∃)",
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
  onChange,
}: {
  label: string;
  value: ConstraintTarget;
  targets: ConstraintTarget[];
  disabled: boolean;
  onChange: (value: ConstraintTarget) => void;
}) {
  if (!targets.length)
    return (
      <Tooltip content="No compatible input for this comparison">
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
      {projections.length > 0 &&
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
        ))}
    </div>
  );
}
