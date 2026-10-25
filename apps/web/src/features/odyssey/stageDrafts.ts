/** @file stageDrafts.ts @description Lossless typed authoring drafts for ordered methods and stateful test calls. @module odyssey */
import { randomUUID } from "../../randomUUID";
import type { CustomCase, OdysseyLevel, Signature } from "@quorem/contracts";
import { supportedType } from "../editor/typedValues";
import { blankQuestion } from "../admin/content";
import { createCustomDraft, parseCustomDraft, type CustomCaseDraft } from "../editor/customCases";
export type MethodDraft = { id: string; signature: Signature };
export type CallDraft = { id: string; methodId: string; values: CustomCaseDraft };
export type SequenceDraft = { id: string; calls: CallDraft[]; explanation?: string };
export type StageDraft = {
  id: string;
  title: string;
  statement: string;
  methods: MethodDraft[];
  examples: SequenceDraft[];
  tests: SequenceDraft[];
};
const id = () => randomUUID();
export function methodDraft(signature: Signature): MethodDraft {
  return { id: id(), signature };
}
export function callDraft(method: MethodDraft): CallDraft {
  const signature =
    method.signature.returnType === "void"
      ? { ...method.signature, returnType: "optional<int>" }
      : method.signature;
  return {
    id: id(),
    methodId: method.id,
    values: {
      ...createCustomDraft({ ...blankQuestion().problem, signature }),
      expectedEnabled: true,
    },
  };
}
export function sequenceDraft(method: MethodDraft): SequenceDraft {
  return { id: id(), calls: [callDraft(method)] };
}
export function firstStage(
  signature: Signature,
  statement = "",
  examples?: CustomCaseDraft[],
  tests?: CustomCaseDraft[],
): StageDraft {
  const method = methodDraft(signature);
  const convert = (items?: CustomCaseDraft[]) =>
    items?.map((values) => ({
      id: id(),
      calls: [{ id: id(), methodId: method.id, values: { ...values, expectedEnabled: true } }],
    })) ?? [sequenceDraft(method)];
  return {
    id: id(),
    title: "Step 1",
    statement,
    methods: [method],
    examples: convert(examples),
    tests: convert(tests),
  };
}

/** Renames preserve call identity; signature edits retain compatible values and reset only changed types. */
export function updateMethod(
  stages: StageDraft[],
  methodId: string,
  next: Signature,
): StageDraft[] {
  const previous = stages
    .flatMap((stage) => stage.methods)
    .find((method) => method.id === methodId)?.signature;
  if (!previous) return stages;
  const defaults = callDraft({ id: methodId, signature: next }).values;
  const adapt = (items: SequenceDraft[]) =>
    items.map((test) => ({
      ...test,
      calls: test.calls.map((call) =>
        call.methodId !== methodId
          ? call
          : {
              ...call,
              values: {
                ...call.values,
                args: next.parameters.map((parameter, index) => {
                  const old = previous.parameters.findIndex((item) => item.name === parameter.name);
                  const position = old >= 0 ? old : index;
                  return previous.parameters[position]?.type === parameter.type
                    ? (call.values.args[position] ?? defaults.args[index]!)
                    : defaults.args[index]!;
                }),
                expected:
                  next.returnType === previous.returnType
                    ? call.values.expected
                    : defaults.expected,
              },
            },
      ),
    }));
  return stages.map((stage) => ({
    ...stage,
    methods: stage.methods.map((method) =>
      method.id === methodId ? { ...method, signature: next } : method,
    ),
    examples: adapt(stage.examples),
    tests: adapt(stage.tests),
  }));
}

export function parseStages(
  stages: StageDraft[],
  { allowIncomplete = false } = {},
): {
  odyssey: { levels: OdysseyLevel[] };
  odysseyHiddenCases: CustomCase[][];
} {
  const available = new Map<string, Signature>();
  const names = new Set<string>();
  const hidden: CustomCase[][] = [];
  const levels = stages.map((stage, index) => {
    if (!allowIncomplete && (!stage.title.trim() || !stage.statement.trim()))
      throw new Error(`Step ${index + 1}: add a title and instructions.`);
    if (!allowIncomplete && !stage.methods.length)
      throw new Error(`Step ${index + 1}: add a method.`);
    for (const method of stage.methods) {
      if (
        !allowIncomplete &&
        (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(method.signature.methodName) ||
          names.has(method.signature.methodName))
      )
        throw new Error(`Step ${index + 1}: method names must be unique.`);
      if (
        (method.signature.returnType !== "void" && !supportedType(method.signature.returnType)) ||
        method.signature.parameters.some((parameter) => !supportedType(parameter.type))
      )
        throw new Error(`Step ${index + 1}: use supported method types.`);
      const parameters = new Set<string>();
      for (const parameter of method.signature.parameters) {
        if (
          !allowIncomplete &&
          (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(parameter.name) || parameters.has(parameter.name))
        )
          throw new Error(`Step ${index + 1}: parameter names must be valid and unique.`);
        parameters.add(parameter.name);
      }
      names.add(method.signature.methodName);
      available.set(method.id, method.signature);
    }
    const parse = (cases: SequenceDraft[], label: string): CustomCase[] => {
      if ((!allowIncomplete && !cases.length) || cases.length > 20)
        throw new Error(`Step ${index + 1}: add 1–20 ${label}.`);
      return cases.map((test, caseIndex) => {
        if ((!allowIncomplete && !test.calls.length) || test.calls.length > 100)
          throw new Error(`Step ${index + 1}, case ${caseIndex + 1}: add 1–100 calls.`);
        return {
          args: [],
          ...(test.explanation ? { explanation: test.explanation } : {}),
          calls: test.calls.map((call) => {
            const signature = available.get(call.methodId);
            if (!signature)
              throw new Error(
                `Step ${index + 1}, case ${caseIndex + 1}: choose an available method for each call.`,
              );
            try {
              const parsed = parseCustomDraft(
                {
                  ...call.values,
                  expectedEnabled: true,
                  expected: signature.returnType === "void" ? "null" : call.values.expected,
                },
                signature.returnType === "void"
                  ? { ...signature, returnType: "optional<int>" }
                  : signature,
              );
              return {
                methodName: signature.methodName,
                args: parsed.args,
                expected: parsed.expected,
              };
            } catch (cause) {
              throw new Error(
                `Step ${index + 1}, case ${caseIndex + 1}, ${signature.methodName}: ${(cause as Error).message}`,
              );
            }
          }),
        };
      });
    };
    hidden.push(parse(stage.tests, "private tests"));
    return {
      title: stage.title,
      statementMarkdown: stage.statement,
      methods: stage.methods.map((method) => method.signature),
      examples: parse(stage.examples, "examples"),
    };
  });
  if (!levels.length || levels.length > 8) throw new Error("Add 1–8 steps.");
  return { odyssey: { levels }, odysseyHiddenCases: hidden };
}
