/** @file schema-validation.ts @description Worker-safe canonical question schema validation. @module questions */
import validate from "./question-validator.mjs";

type Obj = { [key: string]: unknown };
function object(value: unknown): Obj | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : undefined;
}
function wireShape(value: unknown): unknown {
  if (typeof value === "number") return 0;
  if (Array.isArray(value)) return value.map(wireShape);
  const obj = object(value);
  if (!obj) return value;
  return Object.fromEntries(Object.entries(obj).map(([key, item]) => [key, wireShape(item)]));
}
function caseShape(value: unknown): void {
  const c = object(value);
  if (!c) return;
  if ("args" in c) c.args = wireShape(c.args);
  if ("expected" in c) c.expected = wireShape(c.expected);
  if (Array.isArray(c.calls))
    for (const item of c.calls) {
      const call = object(item);
      if (!call) continue;
      if ("args" in call) call.args = wireShape(call.args);
      if ("expected" in call) call.expected = wireShape(call.expected);
    }
}
/** Validate publication shape without rounding or bounding raw case numbers. */
export function validateQuestionSchema(rawJson: string): void {
  let value: unknown;
  try {
    value = JSON.parse(rawJson) as unknown;
  } catch {
    throw new Error("invalid question JSON");
  }
  const root = object(value),
    problem = object(root?.problem);
  const apply = (items: unknown) => {
    if (Array.isArray(items)) items.forEach(caseShape);
  };
  apply(problem?.examples);
  apply(root?.hiddenCases);
  const odyssey = object(problem?.odyssey);
  if (Array.isArray(odyssey?.levels))
    for (const level of odyssey.levels) apply(object(level)?.examples);
  if (Array.isArray(root?.odysseyHiddenCases))
    for (const suite of root.odysseyHiddenCases) apply(suite);
  if (!validate(value)) throw new Error("invalid question schema");
}
