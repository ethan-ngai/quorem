import { ConstraintViolation } from "./constraintViolation";
import {
  constraintMatches,
  constraintProjector,
  constraintRuleTargets,
  constraintTargetType,
  validateConstraints as validateDefinitions,
} from "@quorem/questions";
import type { Constraint, Signature } from "@quorem/contracts";
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
  const project = constraintProjector(signature, (index) => bindings[index].value);
  for (const [index, constraint] of constraints.entries()) {
    const targets = constraintRuleTargets(constraint);
    const parameters = [...new Set(targets.map((target) => target.parameter))];
    try {
      if (
        constraintMatches(constraint, project, (target) => constraintTargetType(signature, target))
      )
        continue;
    } catch (cause) {
      throw new ConstraintViolation(index, parameters, (cause as Error).message);
    }
    if (
      (constraint.kind === "range" || constraint.kind === "comparison") &&
      constraint.quantifier === "any"
    ) {
      const empty = targets.find((target) => !project(target).some((group) => group.length));
      if (empty)
        throw new ConstraintViolation(
          index,
          parameters,
          `${empty.parameter} is empty; ∃ needs a matching ${constraint.kind === "comparison" ? "pair" : "value"}. Use ∀ to allow empty inputs.`,
        );
    }
    throw new ConstraintViolation(index, parameters, `Requires ${formatConstraint(constraint)}.`);
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
