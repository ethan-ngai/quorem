import { Tally5, Hash } from "lucide-react";
import type { Constraint, ConstraintTarget, Signature } from "@quorem/contracts";
import { validateConstraints } from "@quorem/questions";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { SelectField } from "../../ui/SelectField";
import { Tooltip } from "../../ui/Tooltip";
import { inlineStatement } from "../editor/components/StatementMarkdown";

const measures = {
  value: "value",
  length: "length",
  elements: "each element",
  sum: "sum",
  nodeCount: "node count",
  nodeValues: "each node value",
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

export function initialConstraint(
  kind: Exclude<Constraint["kind"], "prose">,
  target: ConstraintTarget,
): Constraint {
  if (kind === "range") return { kind, target, min: 0 };
  if (kind === "comparison") return { kind, left: target, right: target, operator: "le" };
  return { kind, target, property: "unique" };
}

/** Authoring choices use the same admissibility rules as saved constraints. */
export function constraintTargets(
  signature: Signature | undefined,
  kind: Exclude<Constraint["kind"], "prose">,
): ConstraintTarget[] {
  if (!signature) return [];
  return signature.parameters.flatMap(({ name }) =>
    (Object.keys(measures) as ConstraintTarget["projection"][]).flatMap((projection) => {
      const target = { parameter: name, projection };
      try {
        validateConstraints(signature, [initialConstraint(kind, target)]);
        return [target];
      } catch {
        return [];
      }
    }),
  );
}

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
  const key = (target: ConstraintTarget) => JSON.stringify([target.parameter, target.projection]);
  const options = targets.some((target) => key(target) === key(value))
    ? targets
    : [value, ...targets];
  const parameters = [...new Set(options.map((target) => target.parameter))];
  const projections = options.filter((target) => target.parameter === value.parameter);
  const measureLabels = { ...measures, nodeCount: "Node count", nodeValues: "Node values" };
  return (
    <div className="constraint-target">
      {parameters.length === 1 ? (
        <code className="mono-text">{value.parameter}</code>
      ) : parameters.length <= 4 ? (
        <SegmentedControl
          label={`${label} parameter`}
          mono
          value={value.parameter}
          disabled={disabled}
          options={parameters.map((parameter) => ({ value: parameter, label: parameter }))}
          onChange={(parameter) =>
            onChange(
              options.find(
                (target) =>
                  target.parameter === parameter && target.projection === value.projection,
              ) ?? options.find((target) => target.parameter === parameter)!,
            )
          }
        />
      ) : (
        <SelectField
          label={`${label} parameter`}
          mono
          value={value.parameter}
          disabled={disabled}
          options={parameters.map((parameter) => ({ value: parameter, label: parameter }))}
          onChange={(parameter) =>
            onChange(
              options.find(
                (target) =>
                  target.parameter === parameter && target.projection === value.projection,
              ) ?? options.find((target) => target.parameter === parameter)!,
            )
          }
        />
      )}
      {projections.length > 1 ? (
        <SegmentedControl
          label={label}
          iconOnly={projections.every(
            (target) => target.projection === "nodeCount" || target.projection === "nodeValues",
          )}
          value={value.projection}
          disabled={disabled}
          options={projections.map((target) => ({
            value: target.projection,
            label: measureLabels[target.projection],
            icon:
              target.projection === "nodeCount" ? (
                <Tally5 size={15} aria-hidden="true" />
              ) : target.projection === "nodeValues" ? (
                <Hash size={15} aria-hidden="true" />
              ) : undefined,
          }))}
          onChange={(projection) => onChange({ ...value, projection })}
        />
      ) : (
        <span className="constraint-measure">{measureLabels[value.projection]}</span>
      )}
    </div>
  );
}
