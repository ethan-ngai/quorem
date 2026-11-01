/** @file validation.ts @description Interview question request shape. @module interviews */
import { JsonNumber } from "@quorem/questions";
import { ApplicationError } from "../../../application/error.ts";
const invalid = (message: string) => new ApplicationError("invalid_input", message, 400);
export function validateCustomQuestionShape(value: unknown): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof JsonNumber ||
    Object.keys(value).some(
      (k) =>
        ![
          "odyssey",
          "odysseyHiddenCases",
          "title",
          "statementMarkdown",
          "signature",
          "publicCases",
          "privateCases",
        ].includes(k),
    )
  )
    throw invalid("Invalid custom question");
}
export function validateInterviewQuestionShape(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonNumber)
    throw invalid("Choose an existing question or custom question");
  const q = value as Record<string, unknown>;
  if (Object.keys(q).some((k) => !["hints", "problemVersionId", "custom", "language"].includes(k)))
    throw invalid("Invalid question input");
  const custom = q.custom !== undefined && q.custom !== null,
    published = typeof q.problemVersionId === "string" && q.problemVersionId !== "";
  if (custom === published || typeof q.language !== "string")
    throw invalid("Choose an existing question or custom question");
  if (custom) validateCustomQuestionShape(q.custom);
  if (q.hints !== undefined && q.hints !== null) {
    if (
      typeof q.hints !== "object" ||
      Array.isArray(q.hints) ||
      q.hints instanceof JsonNumber ||
      Object.keys(q.hints).some((k) => !["topics", "complexity"].includes(k)) ||
      Object.values(q.hints).some((v) => v !== null && typeof v !== "boolean")
    )
      throw invalid("Invalid hint visibility");
  }
}
