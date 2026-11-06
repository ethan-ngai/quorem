/** @file importQuestion.ts @description Validate private question imports. @module admin */
import { assertQuestionContent } from "@quorem/questions";
import type { QuestionContent } from "@quorem/contracts";
import { UserFacingError } from "../../ui/errors";

export const questionImportLimit = 2 * 1024 * 1024;

/** Validate before creating a draft; publication still checks typed cases and runtime rules. */
export function parseQuestionImport(text: string): QuestionContent {
  if (new TextEncoder().encode(text).length > questionImportLimit)
    throw new UserFacingError("Choose a JSON file smaller than 2 MiB.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UserFacingError("Invalid JSON. Check the file syntax and try again.");
  }
  try {
    assertQuestionContent(value);
  } catch (error) {
    throw new UserFacingError((error as Error).message);
  }
  return value;
}
