import type { CustomCase, ProblemVersion, Signature } from "@quorem/contracts";

type WireValue = CustomCase["args"][number];
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

export function innerType(type: string, wrapper: "optional" | "list") {
  return type.startsWith(`${wrapper}<`) && type.endsWith(">")
    ? type.slice(wrapper.length + 1, -1)
    : undefined;
}

function supportedType(type: string, depth = 0): boolean {
  if (depth > 100) return false;
  if (["int", "float", "str", "bool", "ListNode", "TreeNode"].includes(type)) return true;
  const inner = innerType(type, "optional") ?? innerType(type, "list");
  return inner !== undefined && supportedType(inner, depth + 1);
}

/** Matches the trusted server codec, including total nested collection size. */
export function validateTypedValue(
  type: string,
  value: unknown,
  depth = 0,
  count = { value: 0 },
): asserts value is WireValue {
  if (depth === 0 && !supportedType(type))
    throw new Error(`Unsupported or excessively nested type ${type}; a server codec is required.`);
  if (depth > 100) throw new Error("Nesting exceeds 100 levels.");
  if (depth > 0 && ++count.value > 10_000) throw new Error("Collection exceeds 10,000 elements.");
  const optional = innerType(type, "optional");
  if (optional) {
    if (value !== null) validateTypedValue(optional, value, depth + 1, count);
    return;
  }
  const list = innerType(type, "list");
  if (list) {
    if (!Array.isArray(value)) throw new Error("Enter a JSON array.");
    for (const item of value) validateTypedValue(list, item, depth + 1, count);
    return;
  }
  if (type === "ListNode" || type === "TreeNode") {
    if (value === null) return;
    if (!Array.isArray(value)) throw new Error("Enter a node array or null.");
    if (value.length > 10_000) throw new Error("At most 10,000 node entries.");
    let length = value.length;
    if (type === "TreeNode") while (length > 0 && value[length - 1] === null) length--;
    let slots = 1;
    for (let index = 0; index < length; index++) {
      const item: unknown = value[index];
      if (type === "TreeNode") {
        if (slots === 0) throw new Error("Tree contains an orphan node.");
        slots--;
        if (item === null) continue;
        if (index === 0 && item === null) throw new Error("A null root cannot have children.");
        slots += 2;
      }
      validateTypedValue("int", item, depth + 1, count);
    }
    if (type === "TreeNode" && length > 0 && value[0] === null)
      throw new Error("A null root cannot have children.");
    return;
  }
  if (type === "int") {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < -2_147_483_648 ||
      value > 2_147_483_647
    )
      throw new Error("Enter a signed 32-bit integer.");
  } else if (type === "float") {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error("Enter a finite number.");
  } else if (type === "str") {
    if (typeof value !== "string") throw new Error("Enter a string.");
  } else if (type === "bool") {
    if (typeof value !== "boolean") throw new Error("Choose true or false.");
  } else throw new Error(`Unsupported type ${type}; a server codec is required.`);
}

export function parseTypedField(type: string, source: string): WireValue {
  let value: unknown;
  if (type === "str") value = source;
  else {
    try {
      value = JSON.parse(source);
    } catch {
      throw new Error("Enter valid JSON for this value.");
    }
  }
  validateTypedValue(type, value);
  return value;
}

export function formatTypedField(type: string, value: WireValue) {
  return type === "str" && typeof value === "string" ? value : JSON.stringify(value);
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
  return {
    id: crypto.randomUUID(),
    args: problem.signature.parameters.map(({ type }, index) =>
      formatTypedField(type, example?.args[index] ?? defaultValue(type)),
    ),
    expectedEnabled: false,
    expected: formatTypedField(
      problem.signature.returnType,
      example?.expected ?? defaultValue(problem.signature.returnType),
    ),
  };
}

export function parseCustomDraft(draft: CustomCaseDraft, signature: Signature): CustomCase {
  if (draft.args.length !== signature.parameters.length) throw new Error("Wrong argument count.");
  const args = signature.parameters.map(({ name, type }, index) => {
    try {
      return parseTypedField(type, draft.args[index]!);
    } catch (error) {
      throw new Error(`${name}: ${(error as Error).message}`);
    }
  });
  if (!draft.expectedEnabled) return { args };
  try {
    return { args, expected: parseTypedField(signature.returnType, draft.expected) };
  } catch (error) {
    throw new Error(`Expected output: ${(error as Error).message}`);
  }
}

export function parseCustomDrafts(drafts: CustomCaseDraft[], signature: Signature): CustomCase[] {
  if (drafts.length < 1 || drafts.length > 20)
    throw new Error("Add between 1 and 20 custom cases.");
  const cases = drafts.map((draft, index) => {
    try {
      return parseCustomDraft(draft, signature);
    } catch (error) {
      throw new Error(`Case ${index + 1}: ${(error as Error).message}`);
    }
  });
  if (new TextEncoder().encode(JSON.stringify(cases)).length > 65_536)
    throw new Error("Custom cases exceed 64 KiB.");
  return cases;
}

export function parseCustomCases(source: string, signature: Signature): CustomCase[] {
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
    signature.parameters.forEach(({ type }, argIndex) =>
      validateTypedValue(type, (record.args as unknown[])[argIndex]),
    );
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
