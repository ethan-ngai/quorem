/** @file editorial.ts @description Approach defaults, canonical references and language selection. @module questions */
import type { SolutionApproach, SolutionCode } from "@quorem/contracts";
import type { QuestionContent } from "./model.ts";

/** One metadata owner per algorithm; language variants contain code only. */
export function blankApproach(
  language: SolutionCode["language"] = "python",
  id = "default",
): SolutionApproach {
  return {
    id,
    title: "",
    ...(id === "default" ? {} : { defaultLanguage: language }),
    explanationMarkdown: "",
    timeComplexity: "",
    spaceComplexity: "",
    complexityNotes: "",
    implementations: [{ language, source: "" }],
  };
}

/** The canonical name is optional; incomplete alternatives still have a readable label. */
export function approachTitle(
  approach: { title?: string; id: string },
  canonicalId: string,
): string {
  return approach.title?.trim() || (approach.id === canonicalId ? "Solution" : "Approach");
}

/** Selection never depends on array order when the canonical approach is available. */
export function selectApproach<T extends { id: string }>(
  items: readonly T[] | undefined,
  selectedId: string | undefined,
  canonicalId: string,
): T | undefined {
  return (
    items?.find((item) => item.id === selectedId) ??
    items?.find((item) => item.id === canonicalId) ??
    items?.[0]
  );
}

/** Fallback belongs to each approach, independent of the workspace submission language. */
export function approachCode(
  approach: SolutionApproach,
  language: string,
): SolutionCode | undefined {
  return (
    approach.implementations.find((item) => item.language === language) ??
    approach.implementations.find((item) => item.language === approachDefaultLanguage(approach))
  );
}

/** Canonical executable code is also the default editorial, with no duplicate source. */
export function canonicalCode(content: QuestionContent): SolutionCode | undefined {
  const approach = content.approaches.find((item) => item.id === content.canonicalApproachId);
  return approach?.implementations.find(
    (item) => item.language === (content.problem.sql ? "postgresql" : "python"),
  );
}

/** Promoting a new canonical approach also gives an unnamed predecessor a valid alternative name. */
export function withCanonicalApproach(content: QuestionContent, id: string): QuestionContent {
  const language = content.problem.sql ? "postgresql" : "python";
  const next = content.approaches.find((item) => item.id === id);
  if (!next?.implementations.some((item) => item.language === language && item.source.trim()))
    throw new Error(`${language} code required for canonical approach`);
  return {
    ...content,
    canonicalApproachId: id,
    approaches: content.approaches.map((item) =>
      item.id === id
        ? withoutCanonicalDefault(item)
        : item.id === content.canonicalApproachId
          ? {
              ...item,
              defaultLanguage: approachDefaultLanguage(item),
              title: approachTitle(item, content.canonicalApproachId),
            }
          : item,
    ),
  };
}

/** A canonical fallback is determined by question kind; alternatives choose their own. */
export function approachDefaultLanguage(approach: SolutionApproach): SolutionCode["language"] {
  return (
    approach.defaultLanguage ??
    (approach.implementations.some((item) => item.language === "postgresql")
      ? "postgresql"
      : "python")
  );
}

function withoutCanonicalDefault(approach: SolutionApproach): SolutionApproach {
  const { defaultLanguage: _default, ...value } = approach;
  return value;
}
