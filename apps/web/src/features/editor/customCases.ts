import { primarySignature, validateSqlCase } from "@quorem/questions";
import { validateCodingCase, validateCodingSequence } from "@quorem/questions/coding-case";
import { nodeType } from "@quorem/contracts/node-type";
import { randomUUID } from "../../randomUUID";
import type { Constraint, CustomCase, QuestionProblem, Signature } from "@quorem/contracts";

import { bindArguments } from "./argumentBinding";
import { validateConstraints, validateSequenceCallConstraints } from "./constraintValidation";
import { MAX_CUSTOM_CASE_BYTES, MAX_INPUT_ELEMENTS } from "./inputLimits";
import { normalizeSqlDraft } from "./sqlDraft";

import { caseFieldConfig, resolveInputPreset, type InputConfig } from "./inputPresets";
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

/** Associate admitted case values with stable case IDs. */
export function createRunSnapshot(
  problemVersionId: string,
  cases: CustomCase[],
  drafts?: CustomCaseDraft[],
): RunSnapshot {
  return {
    problemVersionId,
    custom: !!drafts,
    cases: cases.map((value, index) => ({
      id: drafts ? drafts[index]!.id : String(index),
      value: caseSnapshotValue(value),
    })),
  };
}

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

export function defaultCaseValue(type: string): WireValue {
  if (type === "str") return "";
  if (type === "long") return "0";
  if (type === "datetime") return "1970-01-01T00:00:00";
  if (type === "bool") return false;
  if (nodeType(type) || innerType(type, "optional")) return null;
  if (innerType(type, "list")) return [];
  return 0;
}

export function createCustomDraft(problem: QuestionProblem): CustomCaseDraft {
  const example = problem.examples[0];
  if (problem.sql || problem.odyssey) {
    return {
      id: randomUUID(),
      args: [
        JSON.stringify(
          problem.sql
            ? (example?.args[0] ?? {
                tables: (problem.sql.tables ?? []).map((table) => ({ name: table.name, rows: [] })),
              })
            : (example?.calls ?? []),
          null,
          2,
        ),
      ],
      expectedEnabled: false,
      expected: JSON.stringify(example?.expected ?? { rows: [] }, null, 2),
    };
  }
  const inputs = example ? bindArguments(primarySignature(problem), example.args) : undefined;
  return {
    id: randomUUID(),
    args: primarySignature(problem).parameters.map(({ type, input }, index) =>
      formatTypedField(
        type,
        inputs ? inputs[index]!.value : defaultCaseValue(type),
        caseFieldConfig(primarySignature(problem), type, input, false, { args: example?.args }),
      ),
    ),
    expectedEnabled: false,
    expected: formatTypedField(
      primarySignature(problem).returnType,
      example?.expected ?? defaultCaseValue(primarySignature(problem).returnType),
      caseFieldConfig(
        primarySignature(problem),
        primarySignature(problem).returnType,
        undefined,
        true,
        {
          args: example?.args,
        },
      ),
    ),
  };
}

export function parseProblemDraft(draft: CustomCaseDraft, problem: QuestionProblem): CustomCase {
  if (!problem.sql && !problem.odyssey)
    return parseCustomDraft(draft, primarySignature(problem), problem.constraints);
  if (problem.sql)
    return normalizeSqlDraft(
      problem,
      draft.args[0] ?? "",
      draft.expectedEnabled ? draft.expected : undefined,
    ) as CustomCase;
  try {
    const input: unknown = JSON.parse(draft.args[0] ?? "");
    if (problem.odyssey) {
      if (!Array.isArray(input) || !input.length || input.length > 100)
        throw new Error("Add between 1 and 100 calls.");
      const methods = problem.odyssey.levels.flatMap((level) => level.methods);
      if (methods.some((method) => method.nodeReferences)) {
        const value = { args: [], calls: input };
        validateCodingSequence(
          primarySignature(problem),
          problem.constraints,
          methods,
          JSON.stringify(value),
          false,
          MAX_INPUT_ELEMENTS,
        );
        return value as CustomCase;
      }
      for (const call of input) {
        if (!call || typeof call !== "object" || Array.isArray(call))
          throw new Error("Each call must be an object.");
        const method = methods.find((item) => item.methodName === call.methodName);
        if (!method || !Array.isArray(call.args) || call.args.length !== method.parameters.length)
          throw new Error("Check each call's method and arguments.");
        method.parameters.forEach((parameter, index) =>
          validateTypedValue(parameter.type, call.args[index]),
        );
        validateSequenceCallConstraints(
          primarySignature(problem),
          method.methodName,
          call.args,
          problem.constraints,
        );
        if (call.expected !== undefined && method.returnType !== "void")
          validateTypedValue(method.returnType, call.expected);
      }
      return { args: [], calls: input } as CustomCase;
    }
    throw new Error("Unsupported case type.");
  } catch (error) {
    throw new Error(`Check the case JSON: ${(error as Error).message}`);
  }
}

export function parseProblemDrafts(
  drafts: CustomCaseDraft[],
  problem: QuestionProblem,
): CustomCase[] {
  if (!problem.sql && !problem.odyssey)
    return parseCustomDrafts(drafts, primarySignature(problem), problem.constraints);
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
      return parseTypedField(
        type,
        value,
        caseFieldConfig(signature, type, input, false, { sources: draft.args }),
      );
    } catch (error) {
      throw new Error(`${name}: ${(error as Error).message}`);
    }
  });
  const test: CustomCase = { args };
  if (draft.expectedEnabled) {
    try {
      test.expected = parseTypedField(
        signature.returnType,
        draft.expected,
        caseFieldConfig(signature, signature.returnType, undefined, true, { sources: draft.args }),
      );
    } catch (error) {
      throw new Error(`Expected output: ${(error as Error).message}`);
    }
  }
  if (signature.nodeReferences)
    validateCodingCase(signature, constraints, JSON.stringify(test), false, MAX_INPUT_ELEMENTS);
  else validateConstraints(signature, args, constraints);
  return test;
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
    if (signature.nodeReferences) {
      validateCodingCase(signature, constraints, JSON.stringify(record), false, MAX_INPUT_ELEMENTS);
      return record as CustomCase;
    }
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

export function writeCustomDrafts(scope: string, drafts: CustomCaseDraft[]) {
  try {
    localStorage.setItem(customDraftStorageKey(scope), JSON.stringify(drafts));
  } catch {
    /* Custom inputs remain usable without browser storage. */
  }
}

export function readCustomDrafts(scope: string, problem: QuestionProblem): CustomCaseDraft[] {
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
            (problem.sql || problem.odyssey ? 1 : primarySignature(problem).parameters.length) &&
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

/** Recover classic Run inputs using the question's own case codec. */
export function parseRunSnapshotCases(source: string, problem: QuestionProblem): CustomCase[] {
  if (!problem.sql) return parseCustomCases(source, primarySignature(problem));
  const values: unknown = JSON.parse(source);
  if (!Array.isArray(values) || values.length > 100) throw new Error("Invalid SQL Run snapshot");
  for (const value of values) validateSqlCase(problem.sql, JSON.stringify(value), false);
  return values as CustomCase[];
}
