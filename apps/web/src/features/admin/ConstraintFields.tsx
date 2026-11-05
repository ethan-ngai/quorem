import { authoringMessages } from "./authoringValidation";
import { PersistentNotice } from "../../ui/PersistentNotice";
import type { AuthoringIssue } from "./authoringValidation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Brackets,
  ListChecks,
  ListPlus,
  Text,
  Trash2,
  ListOrdered,
  Fingerprint,
  Info,
  ArrowDown01,
  ArrowDown10,
} from "lucide-react";
import { validateConstraints as validateDefinitions, comparisonChoices } from "@quorem/questions";
import { AnimatedRows } from "../../ui/AnimatedRows";
import { Tooltip } from "../../ui/Tooltip";
import * as Popover from "../../ui/Popover";
import { TextArea, TextInput } from "../../ui/TextControl";
import type { Constraint, ConstraintTarget, Signature } from "@quorem/contracts";
import { SelectField } from "../../ui/SelectField";
import { SegmentedControl } from "../../ui/SegmentedControl";
import {
  Target,
  BoundRelation,
  MathOperator,
  initialConstraint,
  constraintTargets,
  Quantifier,
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
  ordered: { label: "Sorted (ties allowed)", icon: ListOrdered },
  unique: { label: "Unique values", icon: Fingerprint },
} as const;

export function ConstraintFields({
  value,
  signature,
  disabled,
  onChange,
  onValidityChange,
  validationIssues = [],
}: {
  onValidityChange?: (invalid: boolean, issues?: readonly AuthoringIssue[]) => void;
  validationIssues?: readonly AuthoringIssue[];
  value: Constraint[];
  signature?: Signature;
  disabled: boolean;
  onChange: (value: Constraint[]) => void;
}) {
  const addConstraint = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const numericTargets = constraintTargets(signature, "range");
  const comparisonTargets = constraintTargets(signature, "comparison");
  const sequenceTargets = constraintTargets(signature, "property");
  function comparisonError(rule: Extract<Constraint, { kind: "comparison" }>): string | undefined {
    if (!signature) return "A signature is required to compare inputs.";
    try {
      validateDefinitions(signature, [rule]);
    } catch (error) {
      return (error instanceof Error ? error.message : String(error)).replace(
        /^constraint 1: /,
        "",
      );
    }
  }
  const semanticIssues = value.flatMap((rule, constraintIndex): AuthoringIssue[] => {
    const error = rule.kind === "comparison" ? comparisonError(rule) : undefined;
    return error
      ? [{ message: `Constraint ${constraintIndex + 1}: ${error}`, constraintIndex }]
      : [];
  });
  const issueKey = JSON.stringify(semanticIssues);
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => {
    validity.current?.(semanticIssues.length > 0, semanticIssues);
  }, [issueKey]);
  useEffect(() => () => validity.current?.(false), []);
  const addOptions = [
    {
      kind: "range",
      label: "Value range",
      icon: ruleTypes.range.icon,
      enabled: numericTargets.length > 0,
    },
    {
      kind: "comparison",
      label: "Compare values",
      icon: ruleTypes.comparison.icon,
      enabled: comparisonTargets.length > 1,
    },
    {
      kind: "property",
      label: "Ordering & uniqueness",
      icon: ruleTypes.property.icon,
      enabled: sequenceTargets.length > 0,
    },
    {
      kind: "prose",
      label: "Written note",
      icon: ruleTypes.prose.icon,
      enabled: true,
    },
  ] as const;
  function add(kind: Constraint["kind"]) {
    const target = {
      range: numericTargets,
      comparison: comparisonTargets,
      property: sequenceTargets,
    };
    const rule: Constraint =
      kind === "prose" ? { kind, text: "" } : initialConstraint(kind, target[kind][0]!);
    if (rule.kind === "comparison") rule.right = comparisonTargets[1]!;
    onChange([...value, rule]);
    setOpen(false);
  }
  return (
    <div className="constraint-editor">
      <AnimatedRows
        items={value}
        focusFallback={addConstraint}
        className="authoring-constraint-list"
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
          const comparison =
            rule.kind === "comparison" ? comparisonChoices(signature, rule) : undefined;
          const RuleIcon = ruleTypes[rule.kind].icon;
          return (
            <div className="constraint-row" role="group" aria-label={`Constraint ${index + 1}`}>
              <Tooltip content={ruleTypes[rule.kind].label}>
                <span className="constraint-kind" aria-label={ruleTypes[rule.kind].label}>
                  <RuleIcon size={14} aria-hidden="true" />
                </span>
              </Tooltip>
              <div
                className="constraint-expression"
                data-kind={rule.kind}
                data-quantified={
                  rule.kind === "range"
                    ? ["elements", "nodeValues"].includes(rule.target.projection)
                    : rule.kind === "comparison" &&
                      [rule.left, rule.right].some((target) =>
                        ["elements", "nodeValues"].includes(target.projection),
                      )
                }
              >
                {((rule.kind === "range" &&
                  ["elements", "nodeValues"].includes(rule.target.projection)) ||
                  (rule.kind === "comparison" &&
                    [rule.left, rule.right].some((target) =>
                      ["elements", "nodeValues"].includes(target.projection),
                    ) &&
                    !comparison?.reflexiveSequence)) && (
                  <Quantifier
                    label={`Constraint ${index + 1} quantifier`}
                    value={rule.quantifier}
                    disabled={disabled}
                    onChange={(quantifier) =>
                      change({ ...rule, quantifier: quantifier === "all" ? undefined : quantifier })
                    }
                  />
                )}

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
                {rule.kind === "comparison" && comparison && (
                  <>
                    {target(
                      `Constraint ${index + 1} left measurement`,
                      rule.left,
                      comparison.left,
                      (left) => change({ ...rule, left }),
                    )}
                    <SelectField
                      label={`Constraint ${index + 1} relation`}
                      value={
                        comparison.reflexiveSequence
                          ? `${rule.quantifier ?? "all"}:${rule.operator}`
                          : rule.operator
                      }
                      disabled={disabled || !comparison.modes.length}
                      options={
                        comparison.reflexiveSequence
                          ? comparison.modes.map(({ quantifier, operator }) => ({
                              value: `${quantifier}:${operator}`,
                              label: `${quantifier === "any" ? "Any pair" : "All pairs"}: ${operators[operator].label}`,
                              display: (
                                <MathOperator
                                  source={`${quantifier === "any" ? "\\exists" : "\\forall"}\\;${operators[operator].math}`}
                                />
                              ),
                            }))
                          : comparison.operators.map((operator) => ({
                              value: operator,
                              label: operators[operator].label,
                              display: <MathOperator source={operators[operator].math} />,
                            }))
                      }
                      onChange={(value) => {
                        if (comparison.reflexiveSequence) {
                          const mode = comparison.modes.find(
                            (mode) => `${mode.quantifier}:${mode.operator}` === value,
                          );
                          if (mode)
                            change({
                              ...rule,
                              operator: mode.operator,
                              quantifier: mode.quantifier === "all" ? undefined : mode.quantifier,
                            });
                        } else {
                          const operator = comparison.operators.find(
                            (operator) => operator === value,
                          );
                          if (operator) change({ ...rule, operator });
                        }
                      }}
                    />
                    {target(
                      `Constraint ${index + 1} right measurement`,
                      rule.right,
                      comparison.right,
                      (right) => change({ ...rule, right }),
                    )}
                    {rule.left.parameter === rule.right.parameter &&
                      rule.left.projection === rule.right.projection &&
                      !comparisonError(rule) && (
                        <Tooltip
                          content={
                            rule.quantifier === "any"
                              ? "∃ self: at least two distinct values."
                              : "∀ self: all values equal; empty passes."
                          }
                        >
                          <span
                            className="constraint-semantics"
                            role="img"
                            aria-label="Comparison meaning"
                            tabIndex={0}
                          >
                            <Info size={14} aria-hidden="true" />
                          </span>
                        </Tooltip>
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
                          direction: target.projection === "value" ? undefined : rule.direction,
                        }),
                    )}
                    <SegmentedControl
                      label={`Constraint ${index + 1} guarantee`}
                      value={rule.property === "unique" ? "unique" : "ordered"}
                      disabled={disabled}
                      iconOnly
                      options={Object.entries(properties)
                        .filter(
                          ([property]) =>
                            rule.target.projection !== "value" || property === "unique",
                        )
                        .map(([value, { label, icon: Icon }]) => ({
                          value,
                          label,
                          icon: <Icon size={15} aria-hidden="true" />,
                        }))}
                      onChange={(property) =>
                        change({
                          ...rule,
                          direction: property === "unique" ? undefined : rule.direction,
                          property:
                            property === "unique"
                              ? "unique"
                              : rule.property === "sorted"
                                ? "sorted"
                                : "nondecreasing",
                        })
                      }
                    />
                    {rule.property !== "unique" && (
                      <SegmentedControl
                        label={`Constraint ${index + 1} sort direction`}
                        value={rule.direction ?? "asc"}
                        disabled={disabled}
                        iconOnly
                        options={[
                          {
                            value: "asc",
                            label: "Ascending (ASC)",
                            icon: <ArrowDown01 size={15} aria-hidden="true" />,
                          },
                          {
                            value: "desc",
                            label: "Descending (DESC)",
                            icon: <ArrowDown10 size={15} aria-hidden="true" />,
                          },
                        ]}
                        onChange={(direction) =>
                          change({
                            ...rule,
                            direction: direction === "asc" ? undefined : direction,
                          })
                        }
                      />
                    )}
                  </>
                )}
              </div>
              <PersistentNotice
                label={`Check constraint ${index + 1}`}
                message={authoringMessages(
                  [...semanticIssues, ...validationIssues].filter(
                    (issue) => issue.constraintIndex === index,
                  ),
                )}
              />
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
            className="button button-ghost constraint-add-trigger"
            data-align="start"
            ref={addConstraint}
            disabled={disabled || value.length >= 64}
          >
            <ListPlus size={16} aria-hidden="true" />
            Add constraint
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="constraint-add-menu"
            align="start"
            aria-label="Add constraint"
          >
            {addOptions.map(({ kind, label, icon: Icon, enabled }) => (
              <button
                type="button"
                className="constraint-add-option"
                key={kind}
                disabled={!enabled}
                onClick={() => add(kind)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
