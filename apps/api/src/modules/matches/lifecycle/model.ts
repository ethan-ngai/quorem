/** @file model.ts @description Match lifecycle inputs and ports. @module matches */
import {
  matchPreset,
  matchRulesSchema,
  type MatchRuleSettings,
  type RuleActionRequest,
  type RuleActionResult,
} from "@quorem/contracts/match-rules";
import { ApplicationError } from "../../../application/error.ts";
import type { FilterMatch } from "../../problems/model.ts";
import type { Principal } from "../../identity/model.ts";
export interface Settings {
  questionFilters: {
    type?: string;
    sql?: string;
    topic?: string;
    company?: string;
    topicMatch?: FilterMatch;
    companyMatch?: FilterMatch;
  };
  admissionLocked: boolean;
  accessMode: string;
  mode: string;
  difficulties: string[];
  selectedProblemVersionId?: string;
  questionSelection?: "random" | "recommended";
  rules: MatchRuleSettings;
  difficulty: string;
  durationMinutes: number;
}
export function normalizeSettings(value: unknown): Settings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const v = value as Record<string, unknown>,
    filters = (v.questionFilters ?? {}) as Record<string, unknown>,
    rules = (v.rules ?? {}) as Record<string, unknown>;
  if (
    !filters ||
    typeof filters !== "object" ||
    Array.isArray(filters) ||
    !rules ||
    typeof rules !== "object" ||
    Array.isArray(rules)
  )
    throw invalid();
  if (
    Object.keys(v).some(
      (k) =>
        ![
          "questionFilters",
          "admissionLocked",
          "accessMode",
          "mode",
          "difficulties",
          "selectedProblemVersionId",
          "questionSelection",
          "rules",
          "difficulty",
          "durationMinutes",
        ].includes(k),
    ) ||
    Object.keys(filters).some(
      (k) => !["type", "sql", "topic", "company", "topicMatch", "companyMatch"].includes(k),
    ) ||
    (v.difficulties !== undefined && v.difficulties !== null && !Array.isArray(v.difficulties))
  )
    throw invalid();
  const parsedRules = matchRulesSchema.safeParse(v.rules ?? matchPreset());
  if (!parsedRules.success) throw invalid();
  for (const k of ["accessMode", "mode", "difficulty", "selectedProblemVersionId"] as const)
    if (v[k] !== undefined && v[k] !== null && typeof v[k] !== "string") throw invalid();
  if (v.durationMinutes != null && typeof v.durationMinutes !== "number") throw invalid();
  const selected = typeof v.selectedProblemVersionId === "string" ? v.selectedProblemVersionId : "";
  const access = typeof v.accessMode === "string" && v.accessMode ? v.accessMode : "accounts_only";
  const mode = typeof v.mode === "string" && v.mode ? v.mode : "showdown";
  const duration =
    typeof v.durationMinutes === "number" && v.durationMinutes ? v.durationMinutes : 30;
  const ds: unknown[] =
    Array.isArray(v.difficulties) && v.difficulties.length
      ? v.difficulties
      : [v.difficulty || (selected ? "easy" : "")];
  if (
    !["accounts_only", "guests_allowed"].includes(access) ||
    !["showdown", "free-for-all", "factions"].includes(mode) ||
    ![15, 30, 45, 60].includes(duration) ||
    ds.length < 1 ||
    ds.length > 3 ||
    new Set(ds).size !== ds.length ||
    ds.some((x) => typeof x !== "string" || !["easy", "medium", "hard"].includes(x)) ||
    (v.questionSelection !== undefined &&
      v.questionSelection !== "random" &&
      v.questionSelection !== "recommended") ||
    (v.admissionLocked != null && typeof v.admissionLocked !== "boolean")
  )
    throw invalid();
  const out: Settings = {
    questionFilters: {},
    admissionLocked: v.admissionLocked === true,
    accessMode: access,
    mode,
    difficulties: ds as string[],
    rules: parsedRules.data,
    difficulty: ds[0] as string,
    durationMinutes: duration,
  };
  if (selected) out.selectedProblemVersionId = selected;
  else if (v.questionSelection === "recommended") out.questionSelection = v.questionSelection;
  for (const k of ["topicMatch", "companyMatch"] as const) {
    const input = filters[k];
    if (input === "all") out.questionFilters[k] = input;
    else if (input !== undefined && input !== "any") throw invalid();
  }
  for (const k of ["type", "sql", "topic", "company"] as const) {
    const input = filters[k];
    if (input === undefined || input === null || input === "") continue;
    if (typeof input !== "string") throw invalid();
    const x = new TextDecoder().decode(new TextEncoder().encode(input));
    if (
      (k === "type" && !["classic", "odyssey"].includes(x)) ||
      (k === "sql" && x !== "true") ||
      ((k === "topic" || k === "company") &&
        (x.split(",").length > 16 ||
          x.split(",").some((y) => !y || Array.from(y).length > 80 || y.includes("\0"))))
    )
      throw invalid();
    out.questionFilters[k] = x;
  }
  return out;
}
const invalid = () => new ApplicationError("invalid_input", "Invalid match settings", 400);
export interface Lifecycle {
  ruleAction(
    who: Principal,
    id: string,
    key: string,
    input: RuleActionRequest,
  ): Promise<RuleActionResult>;
  create(who: Principal, key: string, settings: Settings): Promise<unknown>;
  read(who: Principal, id: string): Promise<unknown>;
  current(who: Principal): Promise<unknown>;
  mutate(
    who: Principal,
    id: string,
    key: string,
    action:
      | "settings"
      | "ready"
      | "start"
      | "leave"
      | "forfeit"
      | "offer-draw"
      | "accept-draw"
      | "decline-draw"
      | "revoke-draw"
      | "rule-events",
    body: Settings | boolean | string | null,
  ): Promise<unknown>;
}
