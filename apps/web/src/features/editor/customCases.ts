import type { Constraint, CustomCase, ProblemVersion, Signature } from "@quorem/contracts";

import { bindArguments } from "./argumentBinding";
import { validateConstraints } from "./constraintValidation";

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
  const inputs = example ? bindArguments(problem.signature, example.args) : undefined;
  return {
    id: crypto.randomUUID(),
    args: problem.signature.parameters.map(({ type }, index) =>
      formatTypedField(type, inputs ? inputs[index]!.value : defaultValue(type)),
    ),
    expectedEnabled: false,
    expected: formatTypedField(
      problem.signature.returnType,
      example?.expected ?? defaultValue(problem.signature.returnType),
    ),
  };
}

export function parseCustomDraft(
  draft: CustomCaseDraft,
  signature: Signature,
  constraints: Constraint[] = [],
): CustomCase {
  const args = bindArguments(signature, draft.args).map(({ name, type, value, ...parameter }) => {
    try {
      return parseTypedField(type, value, (parameter as { input?: InputConfig }).input);
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
  if (new TextEncoder().encode(JSON.stringify(cases)).length > 65_536)
    throw new Error("Custom cases exceed 64 KiB.");
  return cases;
}

export function parseCustomCases(
  source: string,
  signature: Signature,
  constraints: Constraint[] = [],
): CustomCase[] {
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
          value.args.length === problem.signature.parameters.length &&
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
