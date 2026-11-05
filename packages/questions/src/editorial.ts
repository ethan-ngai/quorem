/** @file editorial.ts @description Canonical solution construction and language fallback. @module questions */
import type { EditorialSolution } from "@quorem/contracts";
import type { QuestionContent } from "./model.ts";

/** Empty canonical/editorial fields for incomplete drafts. */
export function blankSolution(
  language: EditorialSolution["language"] = "python",
): EditorialSolution {
  return {
    language,
    source: "",
    explanationMarkdown: "",
    timeComplexity: "",
    spaceComplexity: "",
    complexityNotes: "",
  };
}

/** The canonical source is the default editorial, never a second authored copy. */
export function questionEditorials(content: QuestionContent): EditorialSolution[] {
  return [content.canonicalSolution, ...content.solutions];
}

/** Prefer the requested language; Python and SQL remain readable across workspace languages. */
export function selectEditorial<T extends { language: string }>(
  items: readonly T[] | undefined,
  language: string,
): T | undefined {
  return (
    items?.find((item) => item.language === language) ??
    items?.find((item) => item.language === "python" || item.language === "postgresql")
  );
}

/** Availability follows the same selection policy as editorial content. */
export function hasEditorial(languages: readonly string[] | undefined, language: string): boolean {
  return !!selectEditorial(
    languages?.map((language) => ({ language })),
    language,
  );
}
