import { z } from "zod";

const amount = z.number().int().min(0).max(3600);
const points = z.number().int().min(0).max(100);
export const MAX_FREE_SUBMISSIONS = 100;
export const freeSubmissionsSchema = z.number().int().min(0).max(MAX_FREE_SUBMISSIONS).nullable();
export const assistancePolicySchema = z.strictObject({
  access: z.enum(["blocked", "free", "penalty"]),
  seconds: amount,
  points,
});
export const matchRulesSchema = z.strictObject({
  victory: z.enum(["race", "high_score"]),
  settingsEditors: z.enum(["host", "everyone"]),
  clipboard: z.enum(["off", "warning", "announce", "penalty"]),
  copy: z.enum(["off", "warning", "announce", "penalty"]),
  focus: z.enum(["off", "warning", "announce", "penalty"]),
  behavioralSeconds: amount,
  behavioralPoints: points,
  focusGraceSeconds: z.number().int().min(0).max(60),
  focusFreeWarnings: z.number().int().min(0).max(10),
  assistance: z.strictObject({
    topics: assistancePolicySchema,
    complexity: assistancePolicySchema,
    hiddenCase: assistancePolicySchema,
  }),
  submissions: z.strictObject({
    cooldownSeconds: z.number().int().min(0).max(300),
    freeSubmissions: freeSubmissionsSchema,
    seconds: amount,
    points,
  }),
});
export type MatchRuleSettings = z.infer<typeof matchRulesSchema>;
export type AssistanceKind = keyof MatchRuleSettings["assistance"];
export type MatchPreset = "casual" | "balanced" | "strict" | "tournament";
export const MATCH_PRESETS: readonly MatchPreset[] = ["casual", "balanced", "strict", "tournament"];

/** Fresh values prevent lobby edits from mutating preset defaults. */
export function matchPreset(preset: MatchPreset = "balanced"): MatchRuleSettings {
  const strict = preset === "strict" || preset === "tournament";
  const assistanceMultiplier = preset === "strict" ? 2 : 1;
  const access = preset === "casual" ? "free" : preset === "tournament" ? "blocked" : "penalty";
  return {
    victory: "race",
    settingsEditors: "host",
    clipboard:
      preset === "casual"
        ? "off"
        : preset === "tournament"
          ? "warning"
          : strict
            ? "penalty"
            : "announce",
    copy: "off",
    focus: preset === "casual" ? "off" : strict ? "penalty" : "announce",
    behavioralSeconds: 15,
    behavioralPoints: 2,
    focusGraceSeconds: 3,
    focusFreeWarnings: 1,
    assistance: {
      topics: { access, seconds: 30 * assistanceMultiplier, points: 3 * assistanceMultiplier },
      complexity: { access, seconds: 60 * assistanceMultiplier, points: 5 * assistanceMultiplier },
      hiddenCase: {
        access,
        seconds: 120 * assistanceMultiplier,
        points: 10 * assistanceMultiplier,
      },
    },
    submissions: {
      cooldownSeconds: preset === "casual" ? 0 : 10,
      freeSubmissions: 3,
      seconds: strict ? 10 : 0,
      points: strict ? 1 : 0,
    },
  };
}
export function selectedMatchPreset(rules: MatchRuleSettings): MatchPreset | "custom" {
  return (
    MATCH_PRESETS.find((name) => {
      const preset = matchPreset(name);
      return (
        JSON.stringify(
          matchRulesSchema.parse({ ...rules, victory: "race", settingsEditors: "host" }),
        ) === JSON.stringify(matchRulesSchema.parse(preset))
      );
    }) ?? "custom"
  );
}
export function assistanceCost(rules: MatchRuleSettings, kind: AssistanceKind) {
  const policy = rules.assistance[kind];
  return policy.access === "penalty"
    ? {
        seconds: rules.victory === "race" ? policy.seconds : 0,
        points: rules.victory === "high_score" ? policy.points : 0,
      }
    : { seconds: 0, points: 0 };
}

export interface RuleApproval {
  ruleVersion: string;
  seconds: number;
  points: number;
}
export interface RuleActionRequest {
  kind: AssistanceKind | "submission";
  submissionId?: string;
  caseIndex?: number;
  approval?: RuleApproval;
}
export interface RuleActionQuote extends RuleApproval {
  caseIndex?: number;
  kind: RuleActionRequest["kind"];
  alreadyRevealed: boolean;
  cooldownSeconds: number;
}
export interface RuleActionResult {
  quote: RuleActionQuote;
  revealed?: { topics?: string[]; complexity?: string; input?: string; result?: string };
}

export function ruleApproval(quote: RuleApproval): RuleApproval {
  return { ruleVersion: quote.ruleVersion, seconds: quote.seconds, points: quote.points };
}
