import { useRef, useState } from "react";
import { ArrowLeftRight, Brackets, ListChecks, Plus, Text, Trash2 } from "lucide-react";
import { AnimatedRows } from "../../ui/AnimatedRows";
import { Tooltip } from "../../ui/Tooltip";
import * as Popover from "../../ui/Popover";
import { TextArea, TextInput } from "../../ui/TextControl";
import type { Constraint, ConstraintTarget, Signature } from "@quorem/contracts";
import { SegmentedControl } from "../../ui/SegmentedControl";
import {
  Target,
  BoundRelation,
  MathOperator,
  initialConstraint,
  constraintTargets,
} from "./ConstraintInputs";
import "./constraints.css";

const ruleTypes = {
  range: { label: "Range", icon: Brackets },
  comparison: { label: "Compare", icon: ArrowLeftRight },
  property: { label: "Property", icon: ListChecks },
  prose: { label: "Note", icon: Text },
} as const;
const operators = {
  eq: { label: "Equal to", math: "=" },
  le: { label: "Less than or equal to", math: "\\le" },
  lt: { label: "Less than", math: "<" },
  ge: { label: "Greater than or equal to", math: "\\ge" },
  gt: { label: "Greater than", math: ">" },
} as const;

const properties = {
  sorted: "is sorted",
  nondecreasing: "is nondecreasing",
  unique: "has unique values",
} as const;

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
  const addConstraint = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const numericTargets = constraintTargets(signature, "range");
  const scalarTargets = constraintTargets(signature, "comparison");
  const sequenceTargets = constraintTargets(signature, "property");
  const addOptions = [
    {
      kind: "range",
      label: "Value range",
      detail: "Lower and upper bounds",
      icon: ruleTypes.range.icon,
      enabled: numericTargets.length > 0,
    },
    {
      kind: "comparison",
      label: "Compare values",
      detail: "Relate two input measurements",
      icon: ruleTypes.comparison.icon,
      enabled: scalarTargets.length > 0,
    },
    {
      kind: "property",
      label: "Ordering & uniqueness",
      detail: "Sorted or distinct elements",
      icon: ruleTypes.property.icon,
      enabled: sequenceTargets.length > 0,
    },
    {
      kind: "prose",
      label: "Written note",
      detail: "Describe another input guarantee",
      icon: ruleTypes.prose.icon,
      enabled: true,
    },
  ] as const;
  function add(kind: Constraint["kind"]) {
    const target = { range: numericTargets, comparison: scalarTargets, property: sequenceTargets };
    const rule: Constraint =
      kind === "prose" ? { kind, text: "" } : initialConstraint(kind, target[kind][0]!);
    onChange([...value, rule]);
    setOpen(false);
  }
  return (
    <div className="constraint-editor">
      <AnimatedRows
        items={value}
        focusFallback={addConstraint}
        className="constraint-list"
        label="Input constraints"
        empty={
          <p className="admin-authoring-hint">Add bounds, relationships, or input guarantees.</p>
        }
        renderRow={(rule, index) => {
          const change = (next: Constraint) =>
            onChange(value.map((item, position) => (position === index ? next : item)));
          const target = (
            label: string,
            current: ConstraintTarget,
            choices: ConstraintTarget[],
            onChange: (next: ConstraintTarget) => void,
          ) => (
            <Target
              label={label}
              value={current}
              targets={choices}
              disabled={disabled}
              onChange={onChange}
            />
          );
          const RuleIcon = ruleTypes[rule.kind].icon;
          return (
            <div className="constraint-row" role="group" aria-label={`Constraint ${index + 1}`}>
              <Tooltip content={ruleTypes[rule.kind].label}>
                <span className="constraint-kind" aria-label={ruleTypes[rule.kind].label}>
                  <RuleIcon size={14} aria-hidden="true" />
                </span>
              </Tooltip>
              <div className="constraint-expression" data-kind={rule.kind}>
                {rule.kind === "prose" && (
                  <TextArea
                    aria-label={`Constraint ${index + 1} note`}
                    rows={1}
                    value={rule.text}
                    disabled={disabled}
                    placeholder="Describe an input guarantee…"
                    onChange={(event) => change({ ...rule, text: event.target.value })}
                  />
                )}
                {rule.kind === "range" && (
                  <>
                    <TextInput
                      mono
                      className="constraint-lower-bound"
                      type="number"
                      step="any"
                      aria-label={`Constraint ${index + 1} minimum`}
                      placeholder="−∞"
                      value={rule.min ?? ""}
                      disabled={disabled}
                      onChange={(event) => {
                        const min = event.target.valueAsNumber;
                        if (Number.isFinite(min)) change({ ...rule, min });
                        else if (!event.target.value && rule.max !== undefined)
                          change({
                            ...rule,
                            min: undefined,
                            minInclusive: undefined,
                            max: rule.max,
                          });
                      }}
                    />
                    <BoundRelation
                      label={`Constraint ${index + 1} lower bound`}
                      className="constraint-lower-relation"
                      inclusive={rule.minInclusive !== false}
                      disabled={disabled || rule.min === undefined}
                      onChange={(minInclusive) =>
                        change({ ...rule, minInclusive: minInclusive ? undefined : false })
                      }
                    />
                    {target(
                      `Constraint ${index + 1} measurement`,
                      rule.target,
                      numericTargets,
                      (target) => change({ ...rule, target }),
                    )}
                    <BoundRelation
                      label={`Constraint ${index + 1} upper bound`}
                      className="constraint-upper-relation"
                      inclusive={rule.maxInclusive !== false}
                      disabled={disabled || rule.max === undefined}
                      onChange={(maxInclusive) =>
                        change({ ...rule, maxInclusive: maxInclusive ? undefined : false })
                      }
                    />
                    <TextInput
                      mono
                      className="constraint-upper-bound"
                      type="number"
                      step="any"
                      aria-label={`Constraint ${index + 1} maximum`}
                      placeholder="∞"
                      value={rule.max ?? ""}
                      disabled={disabled}
                      onChange={(event) => {
                        const max = event.target.valueAsNumber;
                        if (Number.isFinite(max)) change({ ...rule, max });
                        else if (!event.target.value && rule.min !== undefined)
                          change({
                            ...rule,
                            min: rule.min,
                            max: undefined,
                            maxInclusive: undefined,
                          });
                      }}
                    />
                  </>
                )}
                {rule.kind === "comparison" && (
                  <>
                    {target(
                      `Constraint ${index + 1} left measurement`,
                      rule.left,
                      scalarTargets,
                      (left) => change({ ...rule, left }),
                    )}
                    <SegmentedControl
                      label={`Constraint ${index + 1} relation`}
                      value={rule.operator}
                      disabled={disabled}
                      iconOnly
                      options={Object.entries(operators).map(([value, { label, math }]) => ({
                        value,
                        label,
                        icon: <MathOperator source={math} />,
                      }))}
                      onChange={(operator) =>
                        change({ ...rule, operator: operator as typeof rule.operator })
                      }
                    />
                    {target(
                      `Constraint ${index + 1} right measurement`,
                      rule.right,
                      scalarTargets,
                      (right) => change({ ...rule, right }),
                    )}
                  </>
                )}
                {rule.kind === "property" && (
                  <>
                    {target(
                      `Constraint ${index + 1} measurement`,
                      rule.target,
                      sequenceTargets,
                      (target) =>
                        change({
                          ...rule,
                          target,
                          property: target.projection === "value" ? "unique" : rule.property,
                        }),
                    )}
                    <SegmentedControl
                      label={`Constraint ${index + 1} guarantee`}
                      value={rule.property}
                      disabled={disabled}
                      options={Object.entries(properties)
                        .filter(
                          ([property]) =>
                            rule.target.projection !== "value" || property === "unique",
                        )
                        .map(([value, label]) => ({ value, label }))}
                      onChange={(property) =>
                        change({ ...rule, property: property as typeof rule.property })
                      }
                    />
                  </>
                )}
              </div>
              <Tooltip content="Remove constraint">
                <button
                  type="button"
                  className="icon-button destructive-icon"
                  disabled={disabled}
                  aria-label={`Remove constraint ${index + 1}`}
                  onClick={() => onChange(value.filter((_, position) => position !== index))}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          );
        }}
      />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="quiet-button"
            ref={addConstraint}
            disabled={disabled || value.length >= 64}
          >
            <Plus size={14} aria-hidden="true" />
            Add constraint
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="constraint-add-menu"
            align="start"
            aria-label="Add constraint"
          >
            {addOptions.map(({ kind, label, detail, icon: Icon, enabled }) => (
              <button
                type="button"
                className="constraint-add-option"
                key={kind}
                disabled={!enabled}
                onClick={() => add(kind)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>
                  {label}
                  <small>{detail}</small>
                </span>
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
