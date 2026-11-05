import type { QuestionProblem } from "@quorem/contracts";
import { parseProblemDraft, type CustomCaseDraft } from "../editor/customCases";
import { ConstraintViolation } from "../editor/constraintViolation";

export type AuthoringIssue = {
  message: string;
  source?: string;
  detail?: string;
  constraintIndex?: number;
  parameters?: readonly string[];
};
export type ReportAuthoringValidity = (
  label: string,
  invalid: boolean,
  issues?: readonly AuthoringIssue[],
) => void;

export function authoringIssue(cause: unknown, prefix: string): AuthoringIssue {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const match = /[Cc]onstraint (\d+):/.exec(detail);
  return {
    message: `${prefix}: ${detail}`,
    source: prefix,
    detail,
    ...(cause instanceof ConstraintViolation
      ? { constraintIndex: cause.constraintIndex, parameters: cause.parameters }
      : match
        ? { constraintIndex: Number(match[1]) - 1 }
        : {}),
  };
}

export function caseValidationIssues(
  drafts: readonly CustomCaseDraft[],
  problem: QuestionProblem,
  label: string,
): AuthoringIssue[] {
  return drafts.flatMap((draft, index) => {
    try {
      parseProblemDraft(draft, problem);
      return [];
    } catch (cause) {
      return [authoringIssue(cause, `${label} ${index + 1}`)];
    }
  });
}

export function defaultAuthoringIssue(label: string): AuthoringIssue {
  if (label === "leetcodeId") return { message: "LeetCode ID: positive integer required." };
  if (label.startsWith("limit:"))
    return {
      message: `${label.slice(6).replace(/([A-Z])/g, " $1")}: positive integer required.`,
    };
  if (label === "stages") return { message: "Steps: check types and inputs." };
  if (label === "constraints") return { message: "Constraints: check the marked rule." };
  if (label.startsWith("cases:")) return { message: "Tests: check inputs and expected output." };
  return { message: "Signature: complete fields and types." };
}

/** Origins update independently; clearing one conflict cannot erase another. */
export function updateAuthoringIssues(
  previous: Map<string, readonly AuthoringIssue[]>,
  label: string,
  invalid: boolean,
  issues?: readonly AuthoringIssue[],
): Map<string, readonly AuthoringIssue[]> {
  const next = new Map(previous);
  if (invalid) next.set(label, issues?.length ? issues : [defaultAuthoringIssue(label)]);
  else next.delete(label);
  return JSON.stringify([...next]) === JSON.stringify([...previous]) ? previous : next;
}

/** Present one explanation with every affected origin, without discarding origin state. */
export function authoringMessages(issues: readonly AuthoringIssue[]): string[] {
  const groups = new Map<string, { detail: string; sources: Set<string> }>();
  for (const issue of issues) {
    const key = JSON.stringify([issue.constraintIndex, issue.detail ?? issue.message]);
    let group = groups.get(key);
    if (!group) {
      group = { detail: issue.detail ?? issue.message, sources: new Set() };
      groups.set(key, group);
    }
    if (issue.source) group.sources.add(issue.source);
  }
  return [...groups.values()].map(({ detail, sources }) =>
    sources.size ? `${[...sources].join(", ")}: ${detail}` : detail,
  );
}
