import { ConstraintViolation } from "./constraintViolation";
import {
  rangeMatches,
  comparisonMatches,
  propertyMatches,
  validateConstraints as validateDefinitions,
} from "@quorem/questions";
import { nodeType } from "@quorem/contracts/node-type";
import type { Constraint, ConstraintTarget, Signature } from "@quorem/contracts";
import { bindArguments } from "./argumentBinding";
import { formatConstraint } from "./constraintFormatter";

export function validateConstraints(
  signature: Signature,
  args: unknown[],
  constraints: Constraint[],
) {
  try {
    validateDefinitions(signature, constraints);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const match = /^constraint (\d+): (.*)$/.exec(message);
    if (match) throw new ConstraintViolation(Number(match[1]) - 1, [], match[2]);
    throw cause;
  }
  const bindings = bindArguments(signature, args);
  const project = (target: ConstraintTarget): unknown[] => {
    const binding = bindings.find(({ name }) => name === target.parameter);
    if (!binding) throw new Error(`Unknown constraint parameter ${target.parameter}.`);
    const type = binding.type.replaceAll("array<", "list<");
    const node = nodeType(type);
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
      case "nodeValues": {
        const values = Array.isArray(value) ? value.filter((item) => item !== null) : [];
        return node?.payload === "long" ? (values as string[]).map(BigInt) : values;
      }
    }
  };
  for (const [index, constraint] of constraints.entries()) {
    let valid = true;
    if (constraint.kind === "range") valid = rangeMatches(constraint, project(constraint.target));
    if (constraint.kind === "comparison")
      valid = comparisonMatches(constraint, project(constraint.left), project(constraint.right));
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
      valid = propertyMatches(constraint, values);
    }
    if (!valid) {
      const targets =
        constraint.kind === "comparison"
          ? [constraint.left, constraint.right]
          : constraint.kind === "range" || constraint.kind === "property"
            ? [constraint.target]
            : [];
      const parameters = [...new Set(targets.map((target) => target.parameter))];
      if (
        (constraint.kind === "range" || constraint.kind === "comparison") &&
        constraint.quantifier === "any"
      ) {
        const empty = targets.find((target) => project(target).length === 0);
        if (empty) {
          throw new ConstraintViolation(
            index,
            parameters,
            `${empty.parameter} is empty; ∃ needs a matching ${constraint.kind === "comparison" ? "pair" : "value"}. Use ∀ to allow empty inputs.`,
          );
        }
      }
      throw new ConstraintViolation(index, parameters, `Requires ${formatConstraint(constraint)}.`);
    }
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
