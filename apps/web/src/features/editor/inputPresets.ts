import { isLongValue } from "@quorem/contracts/long";
import { z } from "zod";
import { parseNodeLiteral, formatNodeLiteral, type NodeContext } from "./nodeLiterals";
import type { Signature } from "@quorem/contracts";
import { nodeType } from "@quorem/contracts/node-type";
import { acceptsNumericExpression, parseNumericExpression } from "./numericExpression";
import { innerType, validateTypedValue, type WireValue } from "./typedValues";
import { MAX_CUSTOM_CASE_BYTES, MAX_INPUT_ELEMENTS } from "./inputLimits";

export type InputConfig = {
  preset: string;
  placeholder?: string;
  rows?: number;
  nodeReference?: true;
  nodeContext?: NodeContext;
};
export type InputKind =
  | "number"
  | "text"
  | "boolean"
  | "sequence"
  | "matrix"
  | "tree"
  | "linkedList"
  | "optional"
  | "structured";

export abstract class InputPreset {
  abstract readonly kind: InputKind;
  readonly delimiters?: readonly [string, string];
  readonly autoformat: boolean = false;
  constructor(
    readonly type: string,
    readonly config?: InputConfig,
  ) {}
  abstract accepts(source: string): boolean;
  protected abstract parseValue(source: string): WireValue;
  parse(source: string): WireValue {
    if (source.length > MAX_CUSTOM_CASE_BYTES) throw new Error("Input exceeds 2 MiB.");
    const value = this.parseValue(source);
    if (!this.config?.nodeReference) validateTypedValue(this.type, value);
    return value;
  }
  format(value: WireValue): string {
    return JSON.stringify(value);
  }
  toEditorSource(source: string): string {
    return source;
  }
  fromEditorSource(source: string): string {
    return source;
  }
}

export class NumberPreset extends InputPreset {
  readonly kind = "number";
  accepts(source: string) {
    return this.type === "long"
      ? source === "" || source === "-" || isLongValue(source)
      : acceptsNumericExpression(source);
  }
  protected parseValue(source: string) {
    return this.type === "long" ? source.trim() : parseNumericExpression(source);
  }
  override format(value: WireValue) {
    return this.type === "long" && typeof value === "string" ? value : super.format(value);
  }
}
export class TextPreset extends InputPreset {
  override readonly delimiters = ['"', '"'] as const;
  readonly kind = "text";
  accepts(source: string) {
    if (this.type !== "datetime") return true;
    const template = "0000-00-00T00:00:00";
    if (source.length > template.length) return false;
    for (let index = 0; index < source.length; index++)
      if (template[index] === "0" ? !/\d/.test(source[index]!) : source[index] !== template[index])
        return false;
    if (source.length >= 4 && source.slice(0, 4) === "0000") return false;
    for (const [start, min, max] of [
      [5, 1, 12],
      [8, 1, 31],
      [11, 0, 23],
      [14, 0, 59],
      [17, 0, 59],
    ])
      if (source.length >= start + 2) {
        const part = Number(source.slice(start, start + 2));
        if (part < min || part > max) return false;
      }
    return source.length < 10 || z.iso.date().safeParse(source.slice(0, 10)).success;
  }
  protected parseValue(source: string) {
    return source;
  }
  override format(value: WireValue) {
    return value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}
export class BooleanPreset extends InputPreset {
  readonly kind = "boolean";
  accepts(source: string) {
    return /^(?:t(?:r(?:u(?:e)?)?)?|f(?:a(?:l(?:s(?:e)?)?)?)?)?$/.test(source);
  }
  protected parseValue(source: string) {
    if (source === "true") return true;
    if (source === "false") return false;
    throw new Error("Choose true or false.");
  }
}

function scalarSource(type: string, source: string, depth = 0): WireValue {
  if (depth > 100) throw new Error("Nesting exceeds 100 levels.");
  if (source.length > MAX_CUSTOM_CASE_BYTES) throw new Error("Input exceeds 2 MiB.");
  const optional = innerType(type, "optional");
  if (optional) return source.trim() === "null" ? null : scalarSource(optional, source, depth + 1);
  const list = innerType(type, "list");
  const node = nodeType(type);
  if (list || node) {
    if (source.trim() === "null" && !list) return null;
    const trimmed = source.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]"))
      throw new Error("Enter a bracketed sequence.");
    const contents = trimmed.slice(1, -1);
    if (!contents.trim()) return [];
    return splitEntries(contents).map((item) =>
      scalarSource(
        list ?? (node && node.kind !== "ListNode" ? `optional<${node.payload}>` : node!.payload),
        item,
        depth + 1,
      ),
    );
  }
  if (type === "long" && source.trim().startsWith('"')) return JSON.parse(source) as WireValue;
  if (type === "str" || type === "datetime") {
    const value: unknown = JSON.parse(source);
    if (typeof value !== "string") throw new Error("Quote each string entry.");
    return value;
  }
  return resolveInputPreset(type).parse(source);
}

/** Split delimiters outside quoted strings and nested collections. */
function splitEntries(source: string): string[] {
  const entries: string[] = [];
  let start = 0,
    depth = 0,
    quoted = false,
    escaped = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "[") {
      if (++depth > 100) throw new Error("Nesting exceeds 100 levels.");
    } else if (character === "]") {
      if (--depth < 0) throw new Error("Unmatched sequence bracket.");
    } else if (character === "," && depth === 0) {
      entries.push(source.slice(start, index));
      start = index + 1;
    }
    if (entries.length > MAX_INPUT_ELEMENTS)
      throw new Error("Collection exceeds 100,000 elements.");
  }
  if (quoted || depth !== 0) throw new Error("Complete the string or nested sequence.");
  entries.push(source.slice(start));
  return entries;
}

/** Change only whitespace so numeric expressions and quoted values survive formatting. */
export function formatMatrixSource(source: string, align: boolean) {
  if (source.length > 20_000) return source;
  const literal = source.trim();
  if (!literal.startsWith("[") || !literal.endsWith("]")) return source;
  try {
    const rows = splitEntries(literal.slice(1, -1)).map((entry) => {
      const row = entry.trim();
      if (!row.startsWith("[") || !row.endsWith("]")) throw new Error("Incomplete matrix row.");
      return splitEntries(row.slice(1, -1)).map((cell) => cell.trim());
    });
    const columns = rows[0]!.length;
    if (rows.some((row) => row.length !== columns || row.some((cell) => !cell))) return source;
    const widths = Array.from({ length: columns }, (_, column) =>
      rows.reduce((max, row) => Math.max(max, row[column]!.length), 0),
    );
    if (align && widths.reduce((sum, width) => sum + width + 2, 2) * rows.length > 20_000)
      return source;
    const result = rows.map(
      (row) =>
        `[${row.map((cell, column) => (align ? cell.padStart(widths[column]!) : cell)).join(align ? ", " : ",")}]`,
    );
    return `[${result.join(align ? ",\n" : ",")}]`;
  } catch {
    return source;
  }
}

/** Inspect literal punctuation while preserving arbitrary quoted payloads. */
function unquotedSource(source: string, allowStrings: boolean): string | undefined {
  let quoted = false,
    escaped = false,
    outside = "";
  for (const character of source) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') {
      if (!allowStrings) return undefined;
      quoted = true;
    } else outside += character;
  }
  return outside;
}

export class SequencePreset extends InputPreset {
  override readonly delimiters = ["[", "]"] as const;
  readonly kind: InputKind = "sequence";
  accepts(source: string) {
    if (source.length > MAX_CUSTOM_CASE_BYTES) return false;
    const allowStrings = /(?:^|<)(?:str|long|datetime)(?:>|$)/.test(this.type);
    const allowBoolean = /(?:^|<)bool(?:>|$)/.test(this.type);
    const allowNull = /(?:optional|NaryTreeNode|TreeNode|ListNode)(?:<|>|$)/.test(this.type);
    const outside = unquotedSource(source, allowStrings);
    if (outside === undefined) return false;
    let child = innerType(this.type, "list");
    while (child && innerType(child, "optional")) child = innerType(child, "optional");
    const allowBrackets =
      child !== undefined &&
      (innerType(child, "list") !== undefined || nodeType(child) !== undefined);
    if (!allowBrackets && (outside.includes("[") || outside.includes("]"))) return false;
    const alphabet = `0-9\\s.eE+*/%()\\[\\],-${allowBoolean ? "truefals" : ""}${allowNull ? "nul" : ""}`;
    return new RegExp(`^[${alphabet.replace(",-", ",\\-")}]*$`).test(outside);
  }
  protected parseValue(source: string) {
    return scalarSource(this.type, source);
  }
  override toEditorSource(source: string) {
    const trimmed = source.trim();
    if (trimmed === "null" && nodeType(this.type)) return "";
    return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : source;
  }
  override fromEditorSource(source: string) {
    return `[${source}]`;
  }
}
export class MatrixPreset extends SequencePreset {
  override readonly kind = "matrix";
}
export class TreePreset extends InputPreset {
  readonly kind: InputKind = "tree";
  override readonly autoformat = true;
  accepts(source: string) {
    if (source.length > MAX_CUSTOM_CASE_BYTES) return false;
    if (this.config?.nodeReference) return true;
    const payload = nodeType(this.type)?.payload;
    const quotedValues = payload === "str" || payload === "datetime" || payload === "long";
    const outside = unquotedSource(source, quotedValues);
    if (outside === undefined) return false;
    return payload === "bool"
      ? /^[0-9\s.eE+*/%\-()[\],_nultrfas]*$/.test(outside)
      : /^[0-9\s.eE+*/%\-()[\],_nul]*$/.test(outside);
  }
  protected parseValue(source: string) {
    if (!this.config?.nodeReference && source.trimStart().startsWith("["))
      return scalarSource(this.type, source);
    return parseNodeLiteral(this.type, source, this.config?.nodeContext);
  }
  override format(value: WireValue) {
    return formatNodeLiteral(this.type, value, this.config?.nodeContext);
  }
}
export class LinkedListPreset extends SequencePreset {
  override readonly kind = "linkedList";
}
export class NullablePreset extends InputPreset {
  readonly kind = "optional";
  readonly inner: InputPreset;
  override readonly autoformat: boolean;
  constructor(type: string, config?: InputConfig) {
    super(type, config);
    this.inner = resolveInputPreset(innerType(type, "optional")!, config);
    this.autoformat = this.inner.autoformat;
  }
  accepts(source: string) {
    return source === "null" || this.inner.accepts(source);
  }
  protected parseValue(source: string) {
    if (source.trim() === "null") return null;
    return this.inner.kind === "text"
      ? this.inner.parse(JSON.parse(source) as string)
      : this.inner.parse(source);
  }
  override format(value: WireValue) {
    return value === null || this.inner.kind === "text"
      ? super.format(value)
      : this.inner.format(value);
  }
  override toEditorSource(source: string) {
    if (source === "null") return source;
    if (this.inner.kind === "text") {
      try {
        return String(JSON.parse(source));
      } catch {
        return source;
      }
    }
    return this.inner.toEditorSource(source);
  }
  override fromEditorSource(source: string) {
    return this.inner.kind === "text"
      ? JSON.stringify(source)
      : this.inner.fromEditorSource(source);
  }
}
export class StructuredFallbackPreset extends InputPreset {
  readonly kind = "structured";
  accepts(_source: string) {
    return true;
  }
  protected parseValue(source: string): WireValue {
    return JSON.parse(source) as WireValue;
  }
}

type PresetFactory = (type: string, config?: InputConfig) => InputPreset;
const registry = new Map<string, PresetFactory>();
/** Register editors for existing server codecs; validation remains authoritative. */
export function registerInputPreset(id: string, factory: PresetFactory) {
  if (registry.has(id)) throw new Error(`Input preset ${id} is already registered.`);
  registry.set(id, factory);
}
for (const [id, Preset] of Object.entries({
  number: NumberPreset,
  text: TextPreset,
  boolean: BooleanPreset,
  sequence: SequencePreset,
  matrix: MatrixPreset,
  tree: TreePreset,
  linkedList: LinkedListPreset,
  optional: NullablePreset,
  structured: StructuredFallbackPreset,
})) {
  registerInputPreset(id, (type, config) => new Preset(type, config));
}
/** Use JSON fields when a node can be represented by a reference object. */
export function caseFieldConfig(
  signature: Signature,
  type: string,
  input?: InputConfig,
  expected = false,
  context?: Pick<NodeContext, "args" | "sources">,
): InputConfig | undefined {
  if (
    !nodeType(type) ||
    (expected ? signature.nodeReferences !== "return" : !signature.nodeReferences)
  )
    return input;
  return { ...input, preset: "tree", nodeReference: true, nodeContext: { signature, ...context } };
}

export function resolveInputPreset(type: string, config?: InputConfig): InputPreset {
  let id: string;
  if (config?.nodeReference) return new TreePreset(type, config);
  if (innerType(type, "optional")) return new NullablePreset(type, config);
  else if (type === "int" || type === "long" || type === "float") id = "number";
  else if (type === "str" || type === "datetime") id = "text";
  else if (type === "bool") id = "boolean";
  else if (nodeType(type)?.kind.endsWith("TreeNode")) id = "tree";
  else if (nodeType(type)?.kind === "ListNode") id = "linkedList";
  else if (innerType(type, "list"))
    id = innerType(innerType(type, "list")!, "list") ? "matrix" : "sequence";
  else id = "structured";
  const requested = config?.preset === "default" ? id : (config?.preset ?? id);
  const factory = registry.get(requested);
  if (!factory) throw new Error(`Unsupported input preset ${requested}.`);
  return factory(type, config);
}

/** Zod wraps the type-owned parser, so entry and submission share one contract. */
export function inputPresetSchemas(preset: InputPreset) {
  return {
    edit: z.string().refine((source) => preset.accepts(source)),
    value: z.string().superRefine((source, context) => {
      try {
        preset.parse(source);
      } catch (cause) {
        context.addIssue({
          code: "custom",
          message: cause instanceof Error ? cause.message : "Check the input format.",
        });
      }
    }),
  };
}
