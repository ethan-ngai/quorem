/** @file constraintTargets.ts @description Typed input measurements shared by authoring and case validation. @module questions */
import { nodeType } from "@quorem/contracts/node-type";
import type { ConstraintTarget, Signature } from "./model.ts";
import { graphEncodingForTarget, inferCaseGraph } from "./graph.ts";
import type { WireValue } from "@quorem/contracts/schema";
import { JsonNumber } from "./json.ts";

const listElement = (type: string) => (type.startsWith("list<") ? type.slice(5, -1) : undefined);
const numericTypes = ["int", "long", "float"];
const primitives = [...numericTypes, "str", "bool"];

export function constraintTargetType(
  signature: Signature,
  target: ConstraintTarget,
  depth = 0,
  budget = { remaining: 17 },
): string {
  if (--budget.remaining < 0)
    throw new Error("measurement expressions support at most 16 input operands");
  if (depth > 4) throw new Error("measurement expressions may nest four levels");
  const parameterType = signature.parameters
    .find((p) => p.name === target.parameter)
    ?.type.replaceAll("array<", "list<");
  if (!parameterType) throw new Error(`unknown parameter ${JSON.stringify(target.parameter)}`);
  let type: string = parameterType;
  if (
    target.path &&
    (target.path.length > 8 ||
      !target.path.length ||
      target.path.some(
        (step) => step !== "each" && (!Number.isInteger(step) || step < 0 || step > 99999),
      ))
  )
    throw new Error("invalid target path");
  for (const step of target.path ?? []) {
    const inner = listElement(type) ?? (type === "str" && step !== "each" ? "str" : undefined);
    if (!inner) throw new Error(`cannot index ${type}`);
    type = inner;
  }
  const element = listElement(type);
  const node = nodeType(type);
  let result: string | undefined;
  switch (target.projection) {
    case "value":
      result = primitives.includes(type) ? type : undefined;
      break;
    case "graph": {
      const encoding = graphEncodingForTarget(signature, target.parameter);
      result =
        !target.path &&
        encoding &&
        encoding.kind !== "custom" &&
        (encoding.directed !== undefined ||
          encoding.kind === "parent" ||
          encoding.kind === "successor")
          ? "graph"
          : undefined;
      break;
    }
    case "indices":
      result = element || type === "str" ? "int" : undefined;
      break;
    case "diagonal":
    case "columns":
      result = element && listElement(element);
      break;
    case "length":
      result = element || type === "str" ? "int" : undefined;
      break;
    case "elements":
      result = element;
      break;
    case "characters":
      result = type === "str" ? "str" : undefined;
      break;
    case "sum":
      result = element && numericTypes.includes(element) ? element : undefined;
      break;
    case "nodeCount":
      result = node ? "int" : undefined;
      break;
    case "nodeValues":
      result = node?.payload;
      break;
  }
  if (
    !result ||
    (target.offset !== undefined &&
      (!numericTypes.includes(result) || !Number.isSafeInteger(target.offset)))
  )
    throw new Error(
      `parameter ${target.parameter}: projection ${target.projection} invalid for ${type}`,
    );
  if (target.total && (!numericConstraintType(result) || !baseSequence(target)))
    throw new Error("total requires a numeric sequence");
  if (target.operations) {
    if (!numericConstraintType(result) || !target.operations.length || target.operations.length > 4)
      throw new Error("arithmetic requires numeric measurements and one to four operations");
    for (const { operator, operand } of target.operations) {
      if (!["add", "subtract", "multiply"].includes(operator))
        throw new Error("unknown arithmetic operation");
      if (typeof operand === "number") {
        if (!Number.isSafeInteger(operand))
          throw new Error("arithmetic constants must be safe integers");
      } else {
        const other = constraintTargetType(signature, operand, depth + 1, budget);
        if (!numericConstraintType(other)) throw new Error("arithmetic requires numeric operands");
        if (other === "float" || (result === "int" && other === "long")) result = other;
      }
    }
  }
  return result;
}

export function numericConstraintType(type: string): boolean {
  return numericTypes.includes(type);
}

export function collectionProjection(target: ConstraintTarget): boolean {
  return ["elements", "characters", "nodeValues", "indices", "diagonal", "columns"].includes(
    target.projection,
  );
}

function baseSequence(target: ConstraintTarget): boolean {
  return collectionProjection(target) || target.path?.includes("each") === true;
}

export function sequenceTarget(target: ConstraintTarget): boolean {
  return (
    (!target.total && baseSequence(target)) ||
    target.operations?.some(
      ({ operand }) => typeof operand !== "number" && sequenceTarget(operand),
    ) === true
  );
}

export function sameTarget(a: ConstraintTarget, b: ConstraintTarget): boolean {
  const path = (target: ConstraintTarget) =>
    target.projection === "elements" ? [...(target.path ?? []), "each"] : (target.path ?? []);
  const projection = (target: ConstraintTarget) =>
    target.projection === "elements" ? "value" : target.projection;
  return (
    a.parameter === b.parameter &&
    projection(a) === projection(b) &&
    (a.offset ?? 0) === (b.offset ?? 0) &&
    !!a.total === !!b.total &&
    JSON.stringify(path(a)) === JSON.stringify(path(b)) &&
    (a.operations?.length ?? 0) === (b.operations?.length ?? 0) &&
    (a.operations ?? []).every(({ operator, operand }, index) => {
      const other = b.operations![index];
      return (
        operator === other.operator &&
        (typeof operand === "number" || typeof other.operand === "number"
          ? operand === other.operand
          : sameTarget(operand, other.operand))
      );
    })
  );
}

function numericValue(type: string, value: unknown): unknown {
  if (type === "long") return BigInt(value as string);
  return value instanceof JsonNumber ? Number(value.lexeme) : value;
}

/** Keep per-row groups for sequence properties and flatten only for value predicates. */
function constraintProjection(
  type: string,
  value: unknown,
  target: ConstraintTarget,
  project: (target: ConstraintTarget) => unknown[][],
): unknown[][] {
  type = type.replaceAll("array<", "list<");
  let selected: unknown[] = [value];
  for (const step of target.path ?? []) {
    selected = selected.flatMap((entry) => {
      const values = typeof entry === "string" ? Array.from(entry) : entry;
      if (!Array.isArray(values)) throw new Error("input is not indexable");
      if (step === "each") return values;
      if (step >= values.length) throw new Error(`index ${step} is missing`);
      return [values[step]];
    });
    type = listElement(type) ?? "str";
  }
  const columnGroups = (rows: unknown[][]) => {
    const columns: unknown[][] = [];
    rows.forEach((row) =>
      row.forEach((value, i) => {
        (columns[i] ??= []).push(numericValue(listElement(listElement(type)!)!, value));
      }),
    );
    return columns;
  };
  let groups =
    target.projection === "columns"
      ? selected.flatMap((entry) => columnGroups(entry as unknown[][]))
      : selected.map((entry): unknown[] => {
          switch (target.projection) {
            case "graph":
              throw new Error("graph target requires signature context");
            case "indices":
              return (typeof entry === "string" ? Array.from(entry) : (entry as unknown[])).map(
                (_, i) => i,
              );
            case "diagonal":
              return (entry as unknown[][]).map((row, i) => {
                if (i >= row.length) throw new Error(`diagonal index ${i} is missing`);
                return numericValue(listElement(listElement(type)!)!, row[i]);
              });
            case "columns":
              throw new Error("column projection is grouped separately");
            case "value":
              return [numericValue(type, entry)];
            case "length":
              return [
                typeof entry === "string" ? Array.from(entry).length : (entry as unknown[]).length,
              ];
            case "elements":
              return (entry as unknown[]).map((item) => numericValue(listElement(type)!, item));
            case "characters":
              return Array.from(entry as string);
            case "sum": {
              const items = entry as unknown[];
              return listElement(type) === "long"
                ? [items.reduce<bigint>((sum, item) => sum + BigInt(item as string), 0n)]
                : [items.reduce<number>((sum, item) => sum + Number(numericValue("int", item)), 0)];
            }
            case "nodeCount":
              return [(entry as unknown[] | null)?.filter((item) => item !== null).length ?? 0];
            case "nodeValues":
              return ((entry as unknown[] | null) ?? [])
                .filter((item) => item !== null)
                .map((item) => numericValue(nodeType(type)!.payload, item));
          }
        });
  if (target.total)
    groups = [[groups.flat().reduce<unknown>((sum, item) => arithmetic("add", sum, item), 0)]];
  if (target.offset)
    groups = groups.map((group) => group.map((item) => arithmetic("add", item, target.offset)));
  let sequence = !target.total && baseSequence(target);
  for (const { operator, operand } of target.operations ?? []) {
    const rightSequence = typeof operand !== "number" && sequenceTarget(operand);
    const right = typeof operand === "number" ? [[operand]] : project(operand);
    if (!sequence) {
      const left = groups[0]?.[0];
      groups = right.map((group) => group.map((item) => arithmetic(operator, left, item)));
    } else if (!rightSequence) {
      groups = groups.map((group) =>
        group.map((item) => arithmetic(operator, item, right[0]?.[0])),
      );
    } else {
      const flat = right.flat();
      if (groups.reduce((size, group) => size + group.length, 0) !== flat.length)
        throw new Error("arithmetic sequences have different sizes");
      let index = 0;
      groups = groups.map((group) =>
        group.map((item) => arithmetic(operator, item, flat[index++])),
      );
    }
    sequence ||= rightSequence;
  }
  return groups;
}

type Operation = NonNullable<ConstraintTarget["operations"]>[number]["operator"];

function arithmetic(operator: Operation, a: unknown, b: unknown): number | bigint {
  if (
    (typeof a === "bigint" || Number.isSafeInteger(a)) &&
    (typeof b === "bigint" || Number.isSafeInteger(b))
  ) {
    const left = BigInt(a as number | bigint);
    const right = BigInt(b as number | bigint);
    if (operator === "add") return left + right;
    if (operator === "subtract") return left - right;
    return left * right;
  }
  const left = Number(a);
  const right = Number(b);
  return operator === "add" ? left + right : operator === "subtract" ? left - right : left * right;
}

/** Resolve typed measurements consistently from browser values and normalized lossless JSON. */
export function constraintProjector(
  signature: Signature,
  argumentValue: (index: number) => unknown,
  limit = 100000,
): (target: ConstraintTarget) => unknown[][] {
  const indexes = new Map(signature.parameters.map(({ name }, i) => [name, i]));
  const graphs = new Map<string, unknown[][]>();
  function project(target: ConstraintTarget): unknown[][] {
    const index = indexes.get(target.parameter)!;
    if (target.projection !== "graph")
      return constraintProjection(
        signature.parameters[index].type,
        argumentValue(index),
        target,
        project,
      );
    const cached = graphs.get(target.parameter);
    if (cached) return cached;
    const decode = (value: unknown): WireValue =>
      Array.isArray(value) ? value.map(decode) : (numericValue("int", value) as WireValue);
    const args: (WireValue | undefined)[] = [];
    args[index] = decode(argumentValue(index));
    const count = graphEncodingForTarget(signature, target.parameter)?.countParameter;
    if (count) {
      const countIndex = indexes.get(count)!;
      args[countIndex] = decode(argumentValue(countIndex));
    }
    const graph = inferCaseGraph(signature, target.parameter, args, undefined, limit, "ignore");
    if (!graph) throw new Error(`invalid graph representation for ${target.parameter}`);
    const encoding = graphEncodingForTarget(signature, target.parameter);
    // An uncounted edge list can encode a singleton tree only as an empty list.
    if (encoding?.kind === "edgeList" && !count && !graph.nodes.length)
      graph.nodes.push(encoding.firstNode ?? 0);
    const groups = [[graph]];
    graphs.set(target.parameter, groups);
    return groups;
  }
  return project;
}
