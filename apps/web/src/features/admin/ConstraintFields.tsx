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
  CircleCheck,
  Info,
  ArrowDown01,
  ArrowDown10,
} from "lucide-react";
import {
  validateConstraints as validateDefinitions,
  comparisonChoices,
  constraintProperties,
  sequenceTarget,
  structuredConstraintSuggestion,
} from "@quorem/questions";
import { AnimatedRows } from "../../ui/AnimatedRows";
import { Tooltip } from "../../ui/Tooltip";
import * as Popover from "../../ui/Popover";
import { inputConstraints, validateInput } from "../../ui/input-constraints";
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
  membership: { label: "Allowed values", icon: CircleCheck },
  definition: { label: "Measurement name", icon: Text },
  prose: { label: "Note", icon: Text },
} as const;
const operators = {
  eq: { label: "Equal to", math: "=" },
  ne: { label: "Different from", math: "\\ne" },
  le: { label: "Less than or equal to", math: "\\le" },
  lt: { label: "Less than", math: "<" },
  ge: { label: "Greater than or equal to", math: "\\ge" },
  gt: { label: "Greater than", math: ">" },
} as const;

const properties = {
  nondecreasing: "Sorted",
  strictlySorted: "Strictly sorted",
  unique: "Unique values",
  adjacentDistinct: "Consecutive values differ",
  even: "Even",
  powerOfTwo: "Power of two",
  symmetric: "Symmetric matrix",
  tree: "Tree",
  binaryTree: "Binary tree",
  star: "Star graph",
  acyclic: "Acyclic graph",
  noLoops: "No self-loops",
  noParallelEdges: "No parallel edges",
} as const;

type Membership = Extract<Constraint, { kind: "membership" }>;

function MembershipValues({
  rule,
  label,
  disabled,
  onChange,
}: {
  rule: Membership;
  label: string;
  disabled: boolean;
  onChange: (rule: Membership) => void;
}) {
  const [source, setSource] = useState(() => JSON.stringify(rule.values));
  return (
    <TextInput
      mono
      aria-label={label}
      placeholder="[0, 1]"
      value={source}
      disabled={disabled}
      onChange={(event) => {
        const text = event.target.value;
        setSource(text);
        let values: Membership["values"] = [];
        try {
          const parsed: unknown = JSON.parse(text);
          if (
            Array.isArray(parsed) &&
            parsed.every((item) => ["number", "string", "boolean"].includes(typeof item))
          )
            values = parsed;
        } catch {
          // An incomplete array stays editable while the rule is invalid.
        }
        onChange({ ...rule, values });
      }}
    />
  );
}

function RangeBound({
  value,
  label,
  placeholder,
  className,
  disabled,
  allowEmpty,
  onChange,
  onValidityChange,
}: {
  value: number | undefined;
  label: string;
  placeholder: string;
  className: string;
  disabled: boolean;
  allowEmpty: boolean;
  onChange: (value: number | undefined) => void;
  onValidityChange: (invalid: boolean) => void;
}) {
  const [source, setSource] = useState(value === undefined ? "" : String(value));
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => () => validity.current(false), []);
  return (
    <TextInput
      mono
      className={className}
      type="text"
      inputMode="decimal"
      constraint={inputConstraints.scientific}
      aria-label={label}
      placeholder={placeholder}
      value={source}
      disabled={disabled}
      onChange={(event) => {
        const text = event.target.value;
        setSource(text);
        const valid =
          text === "" ? allowEmpty : validateInput(text, inputConstraints.scientific).success;
        validity.current(!valid);
        if (valid) onChange(text === "" ? undefined : Number(text));
      }}
    />
  );
}

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
  const [invalidBounds, setInvalidBounds] = useState<Record<string, boolean>>({});
  const numericTargets = constraintTargets(signature, "range");
  const comparisonTargets = constraintTargets(signature, "comparison");
  const definitionTargets = constraintTargets(signature, "definition");
  const membershipTargets = constraintTargets(signature, "membership");
  const sequenceTargets = constraintTargets(signature, "property");
  function definitionError(rule: Constraint): string | undefined {
    if (!signature) return "A signature is required for structured constraints.";
    try {
      validateDefinitions(signature, [rule]);
    } catch (error) {
      return (error instanceof Error ? error.message : String(error)).replace(
        /^constraint 1: /,
        "",
      );
    }
  }
  const seenNames = new Set<string>();
  const semanticIssues = value.flatMap((rule, constraintIndex): AuthoringIssue[] => {
    let error = rule.kind !== "prose" ? definitionError(rule) : undefined;
    if (rule.kind === "definition" && !error) {
      if (seenNames.has(rule.name)) error = "A measurement name can only be defined once.";
      seenNames.add(rule.name);
    }
    return error
      ? [{ message: `Constraint ${constraintIndex + 1}: ${error}`, constraintIndex }]
      : [];
  });
  const issueKey = JSON.stringify(semanticIssues);
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => {
    validity.current?.(
      semanticIssues.length > 0 || Object.values(invalidBounds).some(Boolean),
      semanticIssues,
    );
  }, [issueKey, invalidBounds]);
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
      kind: "membership",
      label: "Allowed or excluded values",
      icon: ruleTypes.membership.icon,
      enabled: membershipTargets.length > 0,
    },
    {
      kind: "definition",
      label: "Name a measurement",
      icon: ruleTypes.definition.icon,
      enabled: definitionTargets.length > 0,
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
      membership: membershipTargets,
      definition: definitionTargets,
    };
    const rule: Constraint =
      kind === "prose" ? { kind, text: "" } : initialConstraint(kind, target[kind][0]!);
    if (rule.kind === "comparison") rule.right = comparisonTargets[1]!;
    if (rule.kind === "property" && signature)
      rule.property = constraintProperties(signature, rule.target)[0]!;
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
              arithmeticTargets={
                rule.kind === "comparison" || rule.kind === "range" || rule.kind === "definition"
                  ? numericTargets
                  : undefined
              }
              disabled={disabled}
              onChange={onChange}
            />
          );
          const comparison =
            rule.kind === "comparison" ? comparisonChoices(signature, rule) : undefined;
          const RuleIcon = ruleTypes[rule.kind].icon;
          const suggestion =
            rule.kind === "prose" && signature
              ? structuredConstraintSuggestion(signature, rule.text)
              : undefined;
          const messages = authoringMessages(
            [...semanticIssues, ...validationIssues].filter(
              (issue) => issue.constraintIndex === index,
            ),
          );
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
                    ? sequenceTarget(rule.target)
                    : rule.kind === "comparison" && [rule.left, rule.right].some(sequenceTarget)
                }
              >
                {((rule.kind === "range" && sequenceTarget(rule.target)) ||
                  (rule.kind === "comparison" &&
                    [rule.left, rule.right].some(sequenceTarget) &&
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
                    <RangeBound
                      className="constraint-lower-bound"
                      label={`Constraint ${index + 1} minimum`}
                      placeholder="−∞"
                      value={rule.min}
                      disabled={disabled}
                      allowEmpty={rule.max !== undefined}
                      onValidityChange={(invalid) =>
                        setInvalidBounds((current) =>
                          current[`${index}:min`] === invalid
                            ? current
                            : { ...current, [`${index}:min`]: invalid },
                        )
                      }
                      onChange={(min) =>
                        change({
                          ...rule,
                          min,
                          minInclusive: min === undefined ? undefined : rule.minInclusive,
                        } as typeof rule)
                      }
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
                    <RangeBound
                      className="constraint-upper-bound"
                      label={`Constraint ${index + 1} maximum`}
                      placeholder="∞"
                      value={rule.max}
                      disabled={disabled}
                      allowEmpty={rule.min !== undefined}
                      onValidityChange={(invalid) =>
                        setInvalidBounds((current) =>
                          current[`${index}:max`] === invalid
                            ? current
                            : { ...current, [`${index}:max`]: invalid },
                        )
                      }
                      onChange={(max) =>
                        change({
                          ...rule,
                          max,
                          maxInclusive: max === undefined ? undefined : rule.maxInclusive,
                        } as typeof rule)
                      }
                    />
                  </>
                )}
                {rule.kind === "comparison" && comparison && (
                  <>
                    {target(
                      `Constraint ${index + 1} left measurement`,
                      rule.left,
                      comparison.left,
                      (left) =>
                        change({
                          ...rule,
                          left,
                          pairing: sequenceTarget(left) ? rule.pairing : undefined,
                        }),
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
                      (right) =>
                        change({
                          ...rule,
                          right,
                          pairing: sequenceTarget(right) ? rule.pairing : undefined,
                        }),
                    )}
                    {sequenceTarget(rule.left) &&
                      sequenceTarget(rule.right) &&
                      !comparison.reflexiveSequence && (
                        <SegmentedControl
                          label={`Constraint ${index + 1} pairing`}
                          value={rule.pairing ?? "all"}
                          disabled={disabled}
                          options={[
                            { value: "all", label: "All pairs" },
                            { value: "corresponding", label: "Same position" },
                          ]}
                          onChange={(value) =>
                            change({ ...rule, pairing: value === "all" ? undefined : value })
                          }
                        />
                      )}
                    {comparison.reflexiveSequence && !definitionError(rule) && (
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
                {rule.kind === "property" &&
                  signature &&
                  (() => {
                    const options = constraintProperties(signature, rule.target);
                    const selected = rule.property === "sorted" ? "nondecreasing" : rule.property;
                    const ordered = (property: string) =>
                      property === "nondecreasing" || property === "strictlySorted";
                    return (
                      <>
                        {target(
                          `Constraint ${index + 1} measurement`,
                          rule.target,
                          sequenceTargets,
                          (target) => {
                            const available = constraintProperties(signature, target);
                            const property = available.includes(selected)
                              ? selected
                              : available[0]!;
                            change({
                              ...rule,
                              target,
                              property,
                              direction: ordered(property) ? rule.direction : undefined,
                            });
                          },
                        )}
                        <SelectField
                          label={`Constraint ${index + 1} guarantee`}
                          value={selected}
                          disabled={disabled}
                          options={options.map((value) => ({ value, label: properties[value] }))}
                          onChange={(property) =>
                            change({
                              ...rule,
                              property: property as keyof typeof properties,
                              direction: ordered(property) ? rule.direction : undefined,
                            })
                          }
                        />
                        {ordered(selected) && (
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
                    );
                  })()}
                {rule.kind === "definition" && (
                  <>
                    <TextInput
                      mono
                      aria-label={`Constraint ${index + 1} name`}
                      placeholder="Name"
                      value={rule.name}
                      disabled={disabled}
                      maxLength={32}
                      onChange={(event) => change({ ...rule, name: event.target.value })}
                    />
                    <MathOperator source="=" />
                    {target(
                      `Constraint ${index + 1} measurement`,
                      rule.target,
                      definitionTargets,
                      (target) => change({ ...rule, target }),
                    )}
                  </>
                )}
                {rule.kind === "membership" && (
                  <>
                    {target(
                      `Constraint ${index + 1} measurement`,
                      rule.target,
                      membershipTargets,
                      (target) => {
                        let values = rule.values;
                        if (signature) {
                          try {
                            validateDefinitions(signature, [{ ...rule, target }]);
                          } catch {
                            values = [];
                          }
                        }
                        change({ ...rule, target, values });
                      },
                    )}
                    <SegmentedControl
                      label={`Constraint ${index + 1} membership`}
                      value={rule.negated ? "exclude" : "allow"}
                      disabled={disabled}
                      options={[
                        { value: "allow", label: "Allow only" },
                        { value: "exclude", label: "Exclude" },
                      ]}
                      onChange={(value) =>
                        change({ ...rule, negated: value === "exclude" || undefined })
                      }
                    />
                    <MembershipValues
                      key={`${rule.target.parameter}:${rule.target.projection}:${JSON.stringify(rule.target.path)}`}
                      rule={rule}
                      label={`Constraint ${index + 1} values (JSON array)`}
                      disabled={disabled}
                      onChange={change}
                    />
                  </>
                )}
              </div>
              <PersistentNotice
                label={
                  suggestion ? "Structured constraint available" : `Check constraint ${index + 1}`
                }
                severity={suggestion && !messages.length ? "warning" : "error"}
                message={
                  messages.length
                    ? messages
                    : suggestion
                      ? "Convert this note to a rule that also checks inputs."
                      : undefined
                }
                actions={
                  suggestion && !disabled
                    ? [{ label: "Convert to structured rule", onClick: () => change(suggestion) }]
                    : undefined
                }
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
