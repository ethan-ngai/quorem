/** @file index.ts @description Pure question rules and public types. @module questions */
export type {
  QuestionContent,
  QuestionProblem,
  AuthoredQuestionProblem,
  Signature,
  Constraint,
  ConstraintTarget,
  InputPresetConfig,
  ExecutionLimits,
} from "./model.ts";
export {
  validQuestionType,
  validateInputConfig,
  validateSignature,
  primarySignature,
  findPrimarySignature,
  blankSignature,
} from "./signature.ts";
export {
  validateConstraints,
  constraintTargetOptions,
  comparisonChoices,
  constraintProperties,
} from "./constraints.ts";
export {
  constraintMatches,
  constraintRuleTargets,
  rangeContains,
  rangeMatches,
  comparisonMatches,
  propertyMatches,
} from "./constraintPredicates.ts";
export { structuredConstraintSuggestion } from "./constraintNotes.ts";
export {
  collectionProjection,
  constraintProjector,
  constraintTargetType,
  sequenceTarget,
} from "./constraintTargets.ts";
export {
  generateStarter,
  generateMethodStarter,
  generateQuestionImplementations,
  questionLanguages,
  supportsQuestionLanguage,
} from "./starter.ts";
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
  decodeQuestionImport,
  questionImportLimit,
  questionImportReadiness,
  QuestionImportError,
  type QuestionImportDiagnostic,
} from "./question-import.ts";

export {
  StreamingJsonReader,
  withStreamingJsonReader,
  decodeUtf8Chunks,
  encodeJsonStringChunks,
  readAllowedObjectSpans,
} from "./streaming-json.ts";
export type { JsonSpan as StreamingJsonSpan } from "./streaming-json.ts";
export {
  blankApproach,
  approachTitle,
  selectApproach,
  approachCode,
  approachDefaultLanguage,
  canonicalCode,
  withCanonicalApproach,
} from "./editorial.ts";

export { questionSlugFits, questionPublicationSlug } from "./identity.ts";

export { publicQuestionProblem } from "./projection.ts";
export {
  graphParameters,
  graphPresetType,
  graphNodeId,
  inferCaseGraph,
  projectCaseGraphs,
  GRAPH_RETURN,
  GRAPH_RETURN_LIST,
  caseGraphTargets,
  graphEncodingForTarget,
  graphReturnSlot,
  isGraphReturn,
  mergeGraphOutput,
  type CaseGraphs,
  validateGraph,
  type GraphEncoding,
  type QuestionGraph,
  type GraphNode,
  type GraphNodeId,
} from "./graph.ts";
