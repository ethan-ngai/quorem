/** @file index.ts @description Pure question rules and public types. @module questions */
export type {
  QuestionContent,
  QuestionProblem,
  Signature,
  Constraint,
  ConstraintTarget,
  InputPresetConfig,
  ExecutionLimits,
} from "./model.ts";
export { validQuestionType, validateInputConfig, validateSignature } from "./signature.ts";
export { validateConstraints } from "./constraints.ts";
export { generateStarter } from "./starter.ts";
export type { StarterLanguage } from "./starter.ts";
export { validateQuestionDraft } from "./draft.ts";
export { JsonNumber, parseLosslessJson, stringifyLosslessJson } from "./json.ts";
export type { JsonValue } from "./json.ts";
export { scanJsonSpans } from "./json-spans.ts";
export type { JsonSpan } from "./json-spans.ts";
export { normalizeQuestionValue, normalizeQuestionJson } from "./value-codec.ts";
export { validSource } from "./source.ts";
export { validateCodingCase, validateCodingSequence, compareCodingCase } from "./coding-case.ts";
export { normalizeSqlResult, compareSqlResult } from "./sql-result.ts";
export { validateSqlCase, validateSqlSchema } from "./sql-case.ts";
export { validateQuestionDefinition, validateQuestionPublication } from "./publication.ts";
export type { SchemaValidator, RuntimeResolver } from "./publication.ts";
export { validateQuestionSchema } from "./schema-validation.ts";
export { normalizeQuestionDraft } from "./draft-normalize.ts";

export {
  StreamingJsonReader,
  decodeUtf8Chunks,
  encodeJsonStringChunks,
  readAllowedObjectSpans,
} from "./streaming-json.ts";
export type { JsonSpan as StreamingJsonSpan } from "./streaming-json.ts";
