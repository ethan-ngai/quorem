import { acceptsNumericExpression, parseNumericExpression } from "./numericExpression";
import { innerType, validateTypedValue, type WireValue } from "./typedValues";

export type InputConfig = { preset: string; placeholder?: string; rows?: number };
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
  constructor(
    readonly type: string,
    readonly config?: InputConfig,
  ) {}
  abstract accepts(source: string): boolean;
  protected abstract parseValue(source: string): WireValue;
  parse(source: string): WireValue {
    const value = this.parseValue(source);
    validateTypedValue(this.type, value);
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
    return acceptsNumericExpression(source);
  }
  protected parseValue(source: string) {
    return parseNumericExpression(source);
  }
}
export class TextPreset extends InputPreset {
  readonly kind = "text";
  accepts(_source: string) {
    return true;
  }
  protected parseValue(source: string) {
    return source;
  }
  override format(value: WireValue) {
    return String(value);
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

function scalarSource(type: string, source: string): WireValue {
  const optional = innerType(type, "optional");
  if (optional) return source.trim() === "null" ? null : scalarSource(optional, source);
  const list = innerType(type, "list");
  if (list || type === "TreeNode" || type === "ListNode") {
    if (source.trim() === "null" && !list) return null;
    const trimmed = source.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]"))
      throw new Error("Enter a bracketed sequence.");
    const contents = trimmed.slice(1, -1);
    if (!contents.trim()) return [];
    return splitEntries(contents).map((item) =>
      scalarSource(list ?? (type === "TreeNode" ? "optional<int>" : "int"), item),
    );
  }
  if (type === "str") {
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
    if (entries.length > 10000) throw new Error("Collection exceeds 10,000 elements.");
  }
  if (quoted || depth !== 0) throw new Error("Complete the string or nested sequence.");
  entries.push(source.slice(start));
  return entries;
}

export class SequencePreset extends InputPreset {
  readonly kind: InputKind = "sequence";
  accepts(source: string) {
    if (source.length > 65536) return false;
    let quoted = false,
      escaped = false;
    const allowStrings = /(?:^|<)str(?:>|$)/.test(this.type);
    const allowBoolean = /(?:^|<)bool(?:>|$)/.test(this.type);
    const allowNull =
      this.type.includes("optional<") || this.type === "TreeNode" || this.type === "ListNode";
    let outside = "";
    for (const character of source) {
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') {
        if (!allowStrings) return false;
        quoted = true;
      } else outside += character;
    }
    const alphabet = `0-9\\s.eE+*/%()\\[\\],-${allowBoolean ? "truefals" : ""}${allowNull ? "nul" : ""}`;
    return new RegExp(`^[${alphabet.replace(",-", ",\\-")}]*$`).test(outside);
  }
  protected parseValue(source: string) {
    return scalarSource(this.type, source);
  }
  override toEditorSource(source: string) {
    const trimmed = source.trim();
    return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : source;
  }
  override fromEditorSource(source: string) {
    return `[${source}]`;
  }
}
export class MatrixPreset extends SequencePreset {
  override readonly kind = "matrix";
}
export class TreePreset extends SequencePreset {
  override readonly kind = "tree";
}
export class LinkedListPreset extends SequencePreset {
  override readonly kind = "linkedList";
}
export class NullablePreset extends InputPreset {
  readonly kind = "optional";
  readonly inner: InputPreset;
  constructor(type: string, config?: InputConfig) {
    super(type, config);
    this.inner = resolveInputPreset(innerType(type, "optional")!);
  }
  accepts(source: string) {
    return source === "null" || this.inner.accepts(source);
  }
  protected parseValue(source: string) {
    return scalarSource(this.type, source);
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
export function resolveInputPreset(type: string, config?: InputConfig): InputPreset {
  let id: string;
  if (innerType(type, "optional")) id = "optional";
  else if (type === "int" || type === "float") id = "number";
  else if (type === "str") id = "text";
  else if (type === "bool") id = "boolean";
  else if (type === "TreeNode") id = "tree";
  else if (type === "ListNode") id = "linkedList";
  else if (innerType(type, "list"))
    id = innerType(innerType(type, "list")!, "list") ? "matrix" : "sequence";
  else id = "structured";
  const requested = config?.preset === "default" ? id : (config?.preset ?? id);
  const factory = registry.get(requested);
  if (!factory) throw new Error(`Unsupported input preset ${requested}.`);
  return factory(type, config);
}
