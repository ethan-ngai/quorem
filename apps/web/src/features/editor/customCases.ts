import { randomUUID } from "../../randomUUID";
import type { Constraint, CustomCase, ProblemVersion, Signature } from "@quorem/contracts";

import { bindArguments } from "./argumentBinding";
import { validateConstraints } from "./constraintValidation";
import { MAX_CUSTOM_CASE_BYTES } from "./inputLimits";

import { resolveInputPreset, type InputConfig } from "./inputPresets";
import { innerType, validateTypedValue, type WireValue } from "./typedValues";
export { innerType, validateTypedValue } from "./typedValues";
export type CustomCaseDraft = {
  id: string;
  args: string[];
  expectedEnabled: boolean;
  expected: string;
};
export type RunSnapshot = {
  problemVersionId: string;
  custom: boolean;
  cases: { id: string; value: CustomCase }[];
};

/** Snapshot only executable case data, including ordered stateful calls. */
export function caseSnapshotValue(value: CustomCase): CustomCase {
  return {
    args: value.args,
    ...(value.calls ? { calls: value.calls } : {}),
    ...(value.expected !== undefined ? { expected: value.expected } : {}),
  };
}

export function parseTypedField(type: string, source: string, config?: InputConfig): WireValue {
  return resolveInputPreset(type, config).parse(source);
}

export function formatTypedField(type: string, value: WireValue, config?: InputConfig) {
  return resolveInputPreset(type, config).format(value);
}

function defaultValue(type: string): WireValue {
  if (type === "str") return "";
  if (type === "bool") return false;
  if (type === "ListNode" || type === "TreeNode" || innerType(type, "optional")) return null;
  if (innerType(type, "list")) return [];
  return 0;
}

export function createCustomDraft(problem: ProblemVersion): CustomCaseDraft {
  const example = problem.examples[0];
  if (problem.sql || problem.odyssey) {
    return {
      id: randomUUID(),
      args: [
        JSON.stringify(
          problem.sql ? (example?.args[0] ?? { tables: [] }) : (example?.calls ?? []),
          null,
          2,
        ),
      ],
      expectedEnabled: false,
      expected: JSON.stringify(example?.expected ?? { rows: [] }, null, 2),
    };
  }
  const inputs = example ? bindArguments(problem.signature, example.args) : undefined;
  return {
    id: randomUUID(),
    args: problem.signature.parameters.map(({ type, input }, index) =>
      formatTypedField(type, inputs ? inputs[index]!.value : defaultValue(type), input),
    ),
    expectedEnabled: false,
    expected: formatTypedField(
      problem.signature.returnType,
      example?.expected ?? defaultValue(problem.signature.returnType),
    ),
  };
}

export function parseProblemDraft(draft: CustomCaseDraft, problem: ProblemVersion): CustomCase {
  if (!problem.sql && !problem.odyssey)
    return parseCustomDraft(draft, problem.signature, problem.constraints);
  try {
    const input: unknown = JSON.parse(draft.args[0] ?? "");
    if (problem.odyssey && !problem.sql) {
      if (!Array.isArray(input) || !input.length || input.length > 100)
        throw new Error("Add between 1 and 100 calls.");
      const methods = problem.odyssey.levels.flatMap((level) => level.methods);
      for (const call of input) {
        if (!call || typeof call !== "object" || Array.isArray(call))
          throw new Error("Each call must be an object.");
        const method = methods.find((item) => item.methodName === call.methodName);
        if (!method || !Array.isArray(call.args) || call.args.length !== method.parameters.length)
          throw new Error("Check each call's method and arguments.");
        method.parameters.forEach((parameter, index) =>
          validateTypedValue(parameter.type, call.args[index]),
        );
        if (call.expected !== undefined && method.returnType !== "void")
          validateTypedValue(method.returnType, call.expected);
      }
      return { args: [], calls: input } as CustomCase;
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Enter table data as an object.");
    return {
      args: [input],
      ...(draft.expectedEnabled ? { expected: JSON.parse(draft.expected) } : {}),
    } as CustomCase;
  } catch (error) {
    throw new Error(`Check the case JSON: ${(error as Error).message}`);
  }
}

export function parseProblemDrafts(
  drafts: CustomCaseDraft[],
  problem: ProblemVersion,
): CustomCase[] {
  if (!problem.sql && !problem.odyssey)
    return parseCustomDrafts(drafts, problem.signature, problem.constraints);
  if (drafts.length < 1 || drafts.length > 20)
    throw new Error("Add between 1 and 20 custom cases.");
  const cases = drafts.map((draft, index) => {
    try {
      return parseProblemDraft(draft, problem);
    } catch (error) {
      throw new Error(`Case ${index + 1}: ${(error as Error).message}`);
    }
  });
  if (new TextEncoder().encode(JSON.stringify(cases)).length > MAX_CUSTOM_CASE_BYTES)
    throw new Error("Custom cases exceed 2 MiB.");
  return cases;
}

export function parseCustomDraft(
  draft: CustomCaseDraft,
  signature: Signature,
  constraints: Constraint[] = [],
): CustomCase {
  const args = bindArguments(signature, draft.args).map(({ name, type, value, input }) => {
    try {
      return parseTypedField(type, value, input);
    } catch (error) {
      throw new Error(`${name}: ${(error as Error).message}`);
    }
  });
  validateConstraints(signature, args, constraints);
  if (!draft.expectedEnabled) return { args };
  try {
    return { args, expected: parseTypedField(signature.returnType, draft.expected) };
  } catch (error) {
    throw new Error(`Expected output: ${(error as Error).message}`);
  }
}

export function parseCustomDrafts(
  drafts: CustomCaseDraft[],
  signature: Signature,
  constraints: Constraint[] = [],
): CustomCase[] {
  if (drafts.length < 1 || drafts.length > 20)
    throw new Error("Add between 1 and 20 custom cases.");
  const cases = drafts.map((draft, index) => {
    try {
      return parseCustomDraft(draft, signature, constraints);
    } catch (error) {
      throw new Error(`Case ${index + 1}: ${(error as Error).message}`);
    }
  });
  if (new TextEncoder().encode(JSON.stringify(cases)).length > MAX_CUSTOM_CASE_BYTES)
    throw new Error("Custom cases exceed 2 MiB.");
  return cases;
}

export function parseCustomCases(
  source: string,
  signature: Signature,
  constraints: Constraint[] = [],
): CustomCase[] {
  if (new TextEncoder().encode(source).length > MAX_CUSTOM_CASE_BYTES)
    throw new Error("Custom cases exceed 2 MiB.");
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 20)
    throw new Error("Enter between 1 and 20 cases as a JSON array.");
  return parsed.map((item: unknown, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error(`Case ${index + 1} must be an object.`);
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "args" && key !== "expected"))
      throw new Error("Unknown case field.");
    if (!Array.isArray(record.args) || record.args.length !== signature.parameters.length)
      throw new Error("Wrong argument count.");
    bindArguments(signature, record.args).forEach(({ type, value }) =>
      validateTypedValue(type, value),
    );
    validateConstraints(signature, record.args, constraints);
    if ("expected" in record) validateTypedValue(signature.returnType, record.expected);
    return record as CustomCase;
  });
}

export function customDraftStorageKey(scope: string) {
  return `quorem.custom-cases.v1:${scope}`;
}

export function readCustomDrafts(scope: string, problem: ProblemVersion): CustomCaseDraft[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(customDraftStorageKey(scope)) ?? "null");
    if (
      Array.isArray(saved) &&
      saved.length >= 1 &&
      saved.length <= 20 &&
      saved.every((draft: unknown) => {
        if (!draft || typeof draft !== "object") return false;
        const value = draft as Record<string, unknown>;
        return (
          typeof value.id === "string" &&
          Array.isArray(value.args) &&
          value.args.length ===
            (problem.sql || problem.odyssey ? 1 : problem.signature.parameters.length) &&
          value.args.every((arg: unknown) => typeof arg === "string") &&
          typeof value.expectedEnabled === "boolean" &&
          typeof value.expected === "string"
        );
      }) &&
      new Set(saved.map((draft: CustomCaseDraft) => draft.id)).size === saved.length
    )
      return saved as CustomCaseDraft[];
  } catch {
    /* Browser storage is optional. */
  }
  return [createCustomDraft(problem)];
}

/** IDs plus exact dispatched values prevent edited or reordered rows inheriting old output. */
export function associatedResultIndex(
  snapshot: RunSnapshot | undefined,
  custom: boolean,
  id: string,
  value: CustomCase | undefined,
) {
  if (!snapshot || snapshot.custom !== custom || !value) return -1;
  return snapshot.cases.findIndex(
    (item) => item.id === id && JSON.stringify(item.value) === JSON.stringify(value),
  );
}
