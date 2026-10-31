/** @file model.ts @description Match lifecycle inputs and ports. @module matches */
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../identity/model.ts";
export interface Settings {
  questionFilters: { type?: string; sql?: string; topic?: string; company?: string };
  admissionLocked: boolean;
  accessMode: string;
  mode: string;
  difficulties: string[];
  selectedProblemVersionId?: string;
  rules: { hints?: unknown; clipboard: string; focus: string };
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
          "rules",
          "difficulty",
          "durationMinutes",
        ].includes(k),
    ) ||
    Object.keys(filters).some((k) => !["type", "sql", "topic", "company"].includes(k)) ||
    Object.keys(rules).some((k) => !["hints", "clipboard", "focus"].includes(k)) ||
    (v.difficulties !== undefined && v.difficulties !== null && !Array.isArray(v.difficulties))
  )
    throw invalid();
  if (rules.hints !== undefined && rules.hints !== null) {
    if (typeof rules.hints !== "object" || Array.isArray(rules.hints)) throw invalid();
    const h = rules.hints as Record<string, unknown>;
    if (
      Object.keys(h).some((k) => !["topics", "complexity"].includes(k)) ||
      Object.values(h).some((x) => x !== null && typeof x !== "boolean")
    )
      throw invalid();
  }
  for (const k of ["accessMode", "mode", "difficulty", "selectedProblemVersionId"] as const)
    if (v[k] !== undefined && v[k] !== null && typeof v[k] !== "string") throw invalid();
  for (const k of ["clipboard", "focus"] as const)
    if (rules[k] !== undefined && rules[k] !== null && typeof rules[k] !== "string")
      throw invalid();
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
  const clipboard =
    typeof rules.clipboard === "string" && rules.clipboard ? rules.clipboard : "off";
  const focus = typeof rules.focus === "string" && rules.focus ? rules.focus : "off";
  if (
    !["accounts_only", "guests_allowed"].includes(access) ||
    !["showdown", "free-for-all"].includes(mode) ||
    ![15, 30, 45, 60].includes(duration) ||
    ds.length < 1 ||
    ds.length > 3 ||
    new Set(ds).size !== ds.length ||
    ds.some((x) => typeof x !== "string" || !["easy", "medium", "hard"].includes(x)) ||
    !["off", "warning", "announce"].includes(clipboard) ||
    !["off", "warning", "announce"].includes(focus) ||
    (v.admissionLocked != null && typeof v.admissionLocked !== "boolean")
  )
    throw invalid();
  const out: Settings = {
    questionFilters: {},
    admissionLocked: v.admissionLocked === true,
    accessMode: access,
    mode,
    difficulties: ds as string[],
    rules: { clipboard, focus },
    difficulty: ds[0] as string,
    durationMinutes: duration,
  };
  if (selected) out.selectedProblemVersionId = selected;
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
  if (rules.hints !== undefined && rules.hints !== null) {
    const h = rules.hints as Record<string, unknown>;
    out.rules.hints = {
      ...(h.topics == null ? {} : { topics: h.topics }),
      ...(h.complexity == null ? {} : { complexity: h.complexity }),
    };
  }
  return out;
}
const invalid = () => new ApplicationError("invalid_input", "Invalid match settings", 400);
export interface Lifecycle {
  create(who: Principal, key: string, settings: Settings): Promise<unknown>;
  read(who: Principal, id: string): Promise<unknown>;
  current(who: Principal): Promise<unknown>;
  mutate(
    who: Principal,
    id: string,
    key: string,
    action: "settings" | "ready" | "start" | "leave" | "forfeit",
    body: Settings | boolean | null,
  ): Promise<unknown>;
}
