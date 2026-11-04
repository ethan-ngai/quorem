import { compareNumericValues } from "@quorem/contracts/long";
import type { Constraint, ConstraintTarget, Signature } from "@quorem/contracts";
import { bindArguments } from "./argumentBinding";
import { formatConstraint } from "./constraintFormatter";

export function validateConstraints(
  signature: Signature,
  args: unknown[],
  constraints: Constraint[],
) {
  const bindings = bindArguments(signature, args);
  const project = (target: ConstraintTarget): unknown[] => {
    const binding = bindings.find(({ name }) => name === target.parameter);
    if (!binding) throw new Error(`Unknown constraint parameter ${target.parameter}.`);
    const type = binding.type.replaceAll("array<", "list<");
    const supported = {
      value: ["int", "long", "float", "str"].includes(type),
      length: type === "str" || type.startsWith("list<"),
      elements: ["list<int>", "list<long>", "list<float>"].includes(type),
      sum: ["list<int>", "list<long>", "list<float>"].includes(type),
      nodeCount: ["ListNode", "TreeNode"].includes(binding.type),
      nodeValues: ["ListNode", "TreeNode"].includes(binding.type),
    }[target.projection];
    if (!supported) throw new Error(`Unsupported constraint target ${target.parameter}.`);
    const value = binding.value;
    switch (target.projection) {
      case "value":
        return value === null ? [] : [type === "long" ? BigInt(value as string) : value];
      case "length":
        return [
          typeof value === "string"
            ? Array.from(value).length
            : Array.isArray(value)
              ? value.length
              : 0,
        ];
      case "sum":
        if (type === "list<long>")
          return [(value as string[]).reduce((total, item) => total + BigInt(item), 0n)];
        if (
          !Array.isArray(value) ||
          value.some((item) => typeof item !== "number" || !Number.isFinite(item))
        )
          throw new Error("A sum target requires a numeric list.");
        const total = value.reduce((total: number, item: number) => total + item, 0);
        if (!Number.isFinite(total)) throw new Error("Numeric list total must be finite.");
        return [total];
      case "elements":
        return Array.isArray(value)
          ? type === "list<long>"
            ? (value as string[]).map(BigInt)
            : value
          : [];
      case "nodeCount":
        return [Array.isArray(value) ? value.filter((item) => item !== null).length : 0];
      case "nodeValues":
        return Array.isArray(value) ? value.filter((item) => item !== null) : [];
    }
  };
  const numeric = (value: unknown): value is number | bigint =>
    typeof value === "bigint" || (typeof value === "number" && Number.isFinite(value));
  for (const constraint of constraints) {
    let valid = true;
    if (constraint.kind === "range")
      valid = project(constraint.target).every(
        (value) =>
          numeric(value) &&
          (constraint.min === undefined || value >= constraint.min) &&
          (constraint.max === undefined || value <= constraint.max),
      );
    if (constraint.kind === "comparison") {
      const [left] = project(constraint.left),
        [right] = project(constraint.right);
      const cmp = numeric(left) && numeric(right) ? compareNumericValues(left, right) : NaN;
      valid = { eq: cmp === 0, le: cmp <= 0, lt: cmp < 0, ge: cmp >= 0, gt: cmp > 0 }[
        constraint.operator
      ];
    }
    if (constraint.kind === "property") {
      if (
        !["elements", "nodeValues"].includes(constraint.target.projection) &&
        !(constraint.target.projection === "value" && constraint.property === "unique")
      )
        throw new Error("Unsupported property constraint target.");
      const projected = project(constraint.target);
      const values =
        constraint.target.projection === "value" && typeof projected[0] === "string"
          ? Array.from(projected[0])
          : projected;
      valid =
        constraint.property === "unique"
          ? new Set(values).size === values.length
          : values.every(
              (value, index) =>
                index === 0 ||
                (numeric(value) &&
                  numeric(values[index - 1]) &&
                  value >= (values[index - 1] as number | bigint)),
            );
    }
    if (!valid) throw new Error(`Constraint: ${formatConstraint(constraint)}.`);
  }
}

/** Odyssey constraints apply only to calls of the primary method. */
export function validateSequenceCallConstraints(
  primary: Signature,
  methodName: string,
  args: unknown[],
  constraints: Constraint[],
) {
  if (methodName === primary.methodName) validateConstraints(primary, args, constraints);
}
