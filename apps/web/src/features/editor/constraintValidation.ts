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
    const supported = {
      value: ["int", "float", "str"].includes(binding.type),
      length: binding.type === "str" || binding.type.startsWith("list<"),
      elements: ["list<int>", "list<float>"].includes(binding.type),
      sum: ["list<int>", "list<float>"].includes(binding.type),
      nodeCount: ["ListNode", "TreeNode"].includes(binding.type),
      nodeValues: ["ListNode", "TreeNode"].includes(binding.type),
    }[target.projection];
    if (!supported) throw new Error(`Unsupported constraint target ${target.parameter}.`);
    const value = binding.value;
    switch (target.projection) {
      case "value":
        return value === null ? [] : [value];
      case "length":
        return [
          typeof value === "string"
            ? Array.from(value).length
            : Array.isArray(value)
              ? value.length
              : 0,
        ];
      case "sum":
        if (
          !Array.isArray(value) ||
          value.some((item) => typeof item !== "number" || !Number.isFinite(item))
        )
          throw new Error("A sum target requires a numeric list.");
        const total = value.reduce((total: number, item: number) => total + item, 0);
        if (!Number.isFinite(total)) throw new Error("Numeric list total must be finite.");
        return [total];
      case "elements":
        return Array.isArray(value) ? value : [];
      case "nodeCount":
        return [Array.isArray(value) ? value.filter((item) => item !== null).length : 0];
      case "nodeValues":
        return Array.isArray(value) ? value.filter((item) => item !== null) : [];
    }
  };
  for (const constraint of constraints) {
    let valid = true;
    if (constraint.kind === "range")
      valid = project(constraint.target).every(
        (value) =>
          typeof value === "number" &&
          (constraint.min === undefined || value >= constraint.min) &&
          (constraint.max === undefined || value <= constraint.max),
      );
    if (constraint.kind === "comparison") {
      valid = false;
      const [left] = project(constraint.left),
        [right] = project(constraint.right);
      if (left !== undefined && right !== undefined) {
        valid =
          typeof left === "number" &&
          typeof right === "number" &&
          {
            eq: left === right,
            le: left <= right,
            lt: left < right,
            ge: left >= right,
            gt: left > right,
          }[constraint.operator];
      }
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
                (typeof value === "number" &&
                  typeof values[index - 1] === "number" &&
                  value >= (values[index - 1] as number)),
            );
    }
    if (!valid) throw new Error(`Constraint: ${formatConstraint(constraint)}.`);
  }
}
