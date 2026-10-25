import type { OdysseyProgress, ProblemVersion } from "@quorem/contracts";

/** Preview only the first public level; execution/progression still require an account. */
export function publicOdysseyPreview(
  problem?: Pick<ProblemVersion, "odyssey">,
): OdysseyProgress | undefined {
  const level = problem?.odyssey?.levels[0];
  return level ? { level: 1, totalLevels: 1, completed: false, levels: [level] } : undefined;
}
