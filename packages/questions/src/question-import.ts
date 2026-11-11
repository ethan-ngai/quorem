/** @file question-import.ts @description Lossless question file decoding and readiness. @module questions */
import { normalizeQuestionDraftValue } from "./draft-normalize.ts";
import { questionContentLimit } from "./draft.ts";
import {
  DuplicateJsonKeyError,
  JsonNumber,
  jsonPointerSegment,
  parseLosslessJson,
} from "./json.ts";
import type { QuestionContent } from "./model.ts";
import { validateQuestionPublication, type RuntimeResolver } from "./publication.ts";
import validateImport from "./question-import-validator.mjs";
import { questionSchemaValue, validateQuestionSchema } from "./schema-validation.ts";
import { QuestionFieldError } from "./validation-error.ts";

export const questionImportLimit = questionContentLimit;
const diagnosticLimit = 4;
const encoder = new TextEncoder();
// oxlint-disable-next-line no-control-regex
const controlCharacters = /[\x00-\x1f\x7f]/g;

export type QuestionImportDiagnostic = {
  path: string;
  code: string;
  message: string;
};

export class QuestionImportError extends Error {
  readonly diagnostics: readonly QuestionImportDiagnostic[];

  constructor(diagnostics: readonly QuestionImportDiagnostic[]) {
    const first = diagnostics[0];
    super(first ? `${first.path}: ${first.message}` : "Invalid question file");
    this.diagnostics = diagnostics;
  }
}

type ImportProblem = Pick<QuestionContent["problem"], "slug" | "title" | "leetcodeId">;

function diagnostic(path: string, code: string, message: string): QuestionImportDiagnostic {
  return {
    path: path.length <= 256 ? path.replace(controlCharacters, "\uFFFD") || "/" : "/",
    code,
    message: message.replace(controlCharacters, " ").slice(0, 240),
  };
}

function reject(path: string, code: string, message: string): never {
  throw new QuestionImportError([diagnostic(path, code, message)]);
}

function schemaDiagnostics(): QuestionImportDiagnostic[] {
  const diagnostics: QuestionImportDiagnostic[] = [];
  for (const error of validateImport.errors ?? []) {
    if (["if", "anyOf", "oneOf"].includes(error.keyword)) continue;
    const property = error.params.missingProperty ?? error.params.additionalProperty;
    const path =
      typeof property === "string"
        ? `${error.instancePath}/${jsonPointerSegment(property)}`
        : error.instancePath;
    const message =
      error.keyword === "additionalProperties"
        ? "Unknown property"
        : error.keyword === "required"
          ? "Required property is missing"
          : (error.message ?? "Check the question file schema");
    const item = diagnostic(path, error.keyword, message);
    if (!diagnostics.some(({ path, code }) => path === item.path && code === item.code))
      diagnostics.push(item);
    if (diagnostics.length === diagnosticLimit) break;
  }
  return diagnostics.length
    ? diagnostics
    : [diagnostic("/", "schema", "Check the question file schema")];
}

function checkMetadataText(value: unknown, path = ""): void {
  // Case text is handled by the typed codecs and lossless storage.
  if (
    path === "/hiddenCases" ||
    path === "/problem/examples" ||
    /^\/problem\/odyssey\/levels\/\d+\/(examples|hiddenCases)$/.test(path)
  )
    return;
  if (typeof value === "string" && value.includes("\0"))
    reject(path, "nul", "Question metadata cannot contain NUL characters");
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const child = `${path}/${jsonPointerSegment(key)}`;
    if (key.includes("\0")) reject(child, "nul", "Question keys cannot contain NUL characters");
    checkMetadataText(item, child);
  }
}

/** Validate the file before filling editor defaults and preserving its case number tokens. */
export function decodeQuestionImport(raw: string): { normalized: string; problem: ImportProblem } {
  if (encoder.encode(raw).length > questionImportLimit)
    reject("/", "size", "Question file exceeds 2 MiB");
  let parsed: ReturnType<typeof parseLosslessJson>;
  try {
    parsed = parseLosslessJson(raw, { rejectDuplicateKeys: true });
  } catch (error) {
    if (error instanceof DuplicateJsonKeyError) reject(error.path, "duplicate_key", error.message);
    reject("/", "json", "Invalid JSON");
  }
  let shape: unknown;
  try {
    shape = questionSchemaValue(raw);
    if (!validateImport(shape)) throw new QuestionImportError(schemaDiagnostics());
  } catch (error) {
    if (error instanceof QuestionImportError) throw error;
    reject("/", "schema", "Could not validate the question file");
  }

  const { problem: metadata } = shape as QuestionContent;
  const content = parsed as Record<string, typeof parsed>;
  const problem = content.problem as typeof content;
  const source = problem.leetcodeId;
  if (source instanceof JsonNumber && !/^[1-9]\d*$/.test(source.lexeme))
    reject(
      "/problem/leetcodeId",
      "integer",
      "Use a positive integer without a decimal or exponent",
    );
  checkMetadataText(shape);
  try {
    const normalized = normalizeQuestionDraftValue(parsed);
    if (encoder.encode(normalized).length > questionImportLimit)
      reject("/", "size", "Normalized question exceeds 2 MiB");
    validateQuestionSchema(normalized);
    return {
      normalized,
      problem: { slug: metadata.slug, title: metadata.title, leetcodeId: metadata.leetcodeId },
    };
  } catch (error) {
    if (error instanceof QuestionImportError) throw error;
    const path = error instanceof QuestionFieldError ? error.path : "/";
    reject(path, "content", error instanceof Error ? error.message : "Invalid question content");
  }
}

/** Check whether a decoded file is ready for publication with the supported runtimes. */
export function questionImportReadiness(
  normalized: string,
  runtime: RuntimeResolver,
): readonly QuestionImportDiagnostic[] {
  try {
    validateQuestionPublication(normalized, validateQuestionSchema, runtime);
    return [];
  } catch (error) {
    return [
      diagnostic(
        error instanceof QuestionFieldError ? error.path : "/",
        "publication",
        error instanceof Error ? error.message : "Question needs edits before publication",
      ),
    ];
  }
}
