/** @file MatchControls.tsx @description Shared match creation and lobby settings. @module matches */
import { Tooltip } from "../../ui/Tooltip";
import { Disclosure } from "../../ui/Disclosure";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { PersistentNotice } from "../../ui/PersistentNotice";
import { DifficultySegments } from "../../ui/DifficultySegments";
import { defaultCatalogFormat } from "@quorem/contracts/catalog-filter";
import { matchPreset } from "@quorem/contracts/match-rules";
import { MatchRuleSettingsControls } from "./MatchRuleSettings";
import { useSession } from "../auth/session";
import { ProblemPicker } from "../practice/ProblemPicker";
import { problemQueryOptions } from "../practice/problemQueries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SelectField } from "../../ui/SelectField";
import { SegmentedControl } from "../../ui/SegmentedControl";
import type {
  PartySettings,
  DevelopmentIdentity,
  ProblemVersion,
  FilterMatch,
} from "@quorem/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { api, requireData } from "../../api/client";
import { Swords, Gauge, BookOpen, Clock, Users, Code2, Info } from "lucide-react";
import { matchModeLabels, ModeIcon } from "./ModeIcon";

export function useAccountIdentity() {
  const account = useSession();
  return { identity: (account.data?.user.id ?? "anonymous") as DevelopmentIdentity, account };
}

export const defaultMatchSettings: PartySettings = {
  questionSelection: "recommended",
  mode: "showdown",
  accessMode: "accounts_only",
  difficulties: ["easy"],
  durationMinutes: 30,
  shareCodeAfterMatch: true,
  rules: matchPreset(),
};

type MatchProblem = Pick<ProblemVersion, "id" | "title"> & {
  difficulty: string;
} & Partial<Pick<ProblemVersion, "sql" | "odyssey" | "tags" | "companies">>;

function matchesValues(
  selection: string | undefined,
  match: FilterMatch | undefined,
  values: string[] = [],
  normalize = (value: string) => value,
) {
  if (!selection) return true;
  const requested = selection.split(",");
  const normalized = new Set(values.map(normalize));
  const includes = (value: string) => normalized.has(normalize(value));
  return match === "all" ? requested.every(includes) : requested.some(includes);
}

/** @returns Whether this question belongs to the lobby's adaptive pool. */
function matchesPool(
  problem: MatchProblem,
  difficulties: readonly string[],
  filters: PartySettings["questionFilters"],
  topicValues?: ReadonlyMap<string, string>,
) {
  return (
    difficulties.includes(problem.difficulty) &&
    !!problem.sql === (filters?.sql === "true") &&
    !!problem.odyssey === ((filters?.type ?? defaultCatalogFormat) === "odyssey") &&
    (!topicValues ||
      matchesValues(filters?.topic, filters?.topicMatch, problem.tags, (tag) => {
        const folded = tag.trim().replace(/\s+/g, " ").toLowerCase();
        return topicValues.get(folded) ?? folded;
      })) &&
    matchesValues(filters?.company, filters?.companyMatch, problem.companies)
  );
}

export function LobbySetupHeading({ options, hint }: { options: ReactNode; hint?: string }) {
  return (
    <div className="lobby-setup-heading">
      <h2>Match setup</h2>
      {hint && (
        <Tooltip content={hint}>
          <button type="button" className="icon-button" aria-label="About lobby settings">
            <Info size={16} aria-hidden="true" />
          </button>
        </Tooltip>
      )}
      {options}
    </div>
  );
}

/** Shared creation/lobby controls; the server validates and resets readiness on edits. */
export function MatchSettings({
  value,
  onChange,
  disabled: locked = false,
  identity,
  participantCount = 0,
  canEditPermissions = true,
  catalog,
  heading,
}: {
  value: PartySettings;
  onChange?: (value: PartySettings) => void;
  disabled?: boolean;
  identity: DevelopmentIdentity;
  participantCount?: number;
  canEditPermissions?: boolean;
  heading?: (lobbyOptions: ReactNode) => ReactNode;
  catalog?: MatchProblem[];
}) {
  const preview = !onChange;
  const disabled = locked || preview;
  const [problems, setProblems] = useState<MatchProblem[]>(catalog ?? []);
  const [catalogError, setCatalogError] = useState<string>();
  useEffect(() => {
    if (preview) return;
    if (catalog) {
      setProblems(catalog);
      return;
    }
    let active = true;
    api(identity)
      .GET("/v1/problems")
      .then(({ data, error }) => {
        const catalog = requireData(data, error);
        if (active) {
          setProblems(catalog.items);
          setCatalogError(undefined);
        }
      })
      .catch(() => {
        if (active) setCatalogError("Problem list unavailable");
      });
    return () => {
      active = false;
    };
  }, [identity, catalog, preview]);
  const [pickedProblem, setPickedProblem] = useState<ProblemVersion>();
  const pools = value.difficulties ?? [value.difficulty ?? "easy"];
  const selectedId = preview ? undefined : value.selectedProblemVersionId;
  const knownProblem =
    (pickedProblem?.id === selectedId ? pickedProblem : undefined) ??
    problems.find((problem) => problem.id === selectedId);
  const client = useQueryClient();
  const { data: selectedDetail, isLoading: loadingSelection } = useQuery(
    problemQueryOptions(client, identity, knownProblem ? "" : (selectedId ?? ""), true),
  );
  const selectedProblem = knownProblem ?? selectedDetail;
  const questionFilters = value.questionFilters;
  const pickerFilters =
    !questionFilters?.type && selectedProblem?.odyssey
      ? { ...questionFilters, type: "odyssey" as const }
      : questionFilters;
  const changePool = (
    difficulties: typeof pools,
    questionFilters: PartySettings["questionFilters"],
    topicValues?: ReadonlyMap<string, string>,
  ) => {
    const topicsChanged =
      questionFilters?.topic !== pickerFilters?.topic ||
      questionFilters?.topicMatch !== pickerFilters?.topicMatch;
    const selectedProblemVersionId =
      selectedProblem &&
      matchesPool(
        selectedProblem,
        difficulties,
        questionFilters,
        topicsChanged ? topicValues : undefined,
      )
        ? selectedId
        : undefined;
    onChange?.({
      ...value,
      difficulty: undefined,
      difficulties,
      questionFilters,
      selectedProblemVersionId,
      questionSelection:
        selectedId && !selectedProblemVersionId
          ? defaultMatchSettings.questionSelection
          : value.questionSelection,
    });
  };
  const rules = value.rules ?? matchPreset();
  const lobbyOptions = (
    <Disclosure title="Lobby options" header={heading}>
      <div className="match-option">
        <span>
          <Users size={16} aria-hidden="true" />
          Everyone can edit settings
        </span>
        <ToggleSwitch
          label="Everyone can edit lobby settings"
          checked={rules.settingsEditors === "everyone"}
          disabled={disabled || !canEditPermissions}
          onChange={(enabled) =>
            onChange?.({
              ...value,
              rules: { ...rules, settingsEditors: enabled ? "everyone" : "host" },
            })
          }
        />
      </div>
      <div className="match-option">
        <span>
          <Code2 size={16} aria-hidden="true" />
          Share code after match
        </span>
        <ToggleSwitch
          label="Share code after match"
          checked={value.shareCodeAfterMatch}
          disabled={disabled}
          onChange={(shareCodeAfterMatch) => onChange?.({ ...value, shareCodeAfterMatch })}
        />
      </div>
    </Disclosure>
  );
  return (
    <div className="match-options lobby-settings">
      {heading && lobbyOptions}
      <div className="match-option">
        <span>
          <Swords size={16} aria-hidden="true" />
          Game mode
        </span>
        <SegmentedControl
          label="Game mode"
          value={value.mode ?? "showdown"}
          disabled={disabled}
          compact
          options={(["showdown", "free-for-all", "factions"] as const).map((mode) => ({
            value: mode,
            label: matchModeLabels[mode],
            icon: <ModeIcon mode={mode} />,
            disabled: mode === "showdown" && participantCount > 2,
            hint: mode === "showdown" ? "Two players or fewer" : "Up to eight players",
          }))}
          onChange={(mode) => onChange?.({ ...value, mode })}
        />
      </div>
      <div className="match-option difficulty-option">
        <span>
          <Gauge size={16} aria-hidden="true" />
          Difficulty
        </span>
        <DifficultySegments
          selected={pools}
          onChange={(difficulties) => changePool(difficulties, pickerFilters)}
          required
          disabled={disabled || loadingSelection}
        />
      </div>
      <div className="match-option">
        <span>
          <BookOpen size={16} aria-hidden="true" />
          Problem
          <PersistentNotice message={catalogError} label="Problem list unavailable" />
        </span>
        {preview ? (
          <span>Visible after joining</span>
        ) : (
          <ProblemPicker
            items={selectedProblem ? [selectedProblem] : []}
            identity={identity}
            difficulties={pools}
            filters={pickerFilters}
            onFiltersChange={(questionFilters, topicValues) =>
              changePool(pools, questionFilters, topicValues)
            }
            exclusiveKind
            value={value.selectedProblemVersionId}
            disabled={disabled || loadingSelection}
            automaticSelection={{
              mode: value.questionSelection ?? "random",
              onChange: (questionSelection) =>
                onChange?.({
                  ...value,
                  difficulties: pools,
                  questionSelection,
                  selectedProblemVersionId: undefined,
                }),
            }}
            discloseFilters
            onChange={(selectedProblemVersionId, problem) => {
              setPickedProblem(problem);
              onChange?.({
                ...value,
                difficulties: pools,
                selectedProblemVersionId,
                questionSelection: undefined,
              });
            }}
          />
        )}
      </div>
      <div className="match-option">
        <span>
          <Clock size={16} aria-hidden="true" />
          Duration
        </span>
        <SelectField
          label="Duration"
          value={String(value.durationMinutes)}
          disabled={disabled}
          onChange={(duration) =>
            onChange?.({
              ...value,
              durationMinutes: Number(duration) as PartySettings["durationMinutes"],
            })
          }
          options={[15, 30, 45, 60].map((minutes) => ({
            value: String(minutes),
            label: `${minutes} min`,
          }))}
        />
      </div>
      <MatchRuleSettingsControls
        value={rules}
        disabled={disabled}
        onChange={(rules) => onChange?.({ ...value, rules })}
      />
      {!heading && lobbyOptions}
    </div>
  );
}
