import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "@quorem/contracts/questions/schema";
import type { QuestionContent } from "@quorem/contracts";
import { UserFacingError } from "../../ui/errors";

export const questionImportLimit = 2 * 1024 * 1024;
const ajv = new Ajv({ strict: true });
addFormats(ajv);
const validate = ajv.compile<QuestionContent>(schema);

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
  if (!validate(value)) {
    const error = validate.errors?.[0];
    throw new UserFacingError(
      `Invalid question at ${error?.instancePath || "/"}: ${error?.message || "check the question schema"}.`,
    );
  }
  return value;
}
