import { NoticeRegion } from "../../ui/PersistentNotice";
import { DifficultySegments } from "../../ui/DifficultySegments";
import { matchPreset } from "@quorem/contracts/match-rules";
import { MatchRuleSettingsControls } from "./MatchRuleSettings";
import { useSession } from "../auth/session";
import { ProblemPicker } from "../practice/ProblemPicker";
import { SelectField } from "../../ui/SelectField";
import type { PartySettings, DevelopmentIdentity, ProblemVersion } from "@quorem/contracts";
import { useEffect, useState } from "react";
import { Gauge, Swords, BookOpen } from "lucide-react";
import { api, requireData } from "../../api/client";
import { Tooltip } from "../../ui/Tooltip";
import { ModeIcon } from "./ModeIcon";
import { Icon } from "../../ui/Icon";

export function useAccountIdentity() {
  const account = useSession();
  return { identity: (account.data?.user.id ?? "anonymous") as DevelopmentIdentity, account };
}

export const defaultMatchSettings: PartySettings = {
  mode: "showdown",
  accessMode: "accounts_only",
  difficulties: ["easy"],
  durationMinutes: 30,
  shareCodeAfterMatch: true,
  rules: matchPreset(),
};

/** Shared creation/lobby controls; the server validates and resets readiness on edits. */
export function MatchSettings({
  value,
  onChange,
  disabled = false,
  identity,
  participantCount = 0,
  canEditPermissions = true,
  catalog,
}: {
  value: PartySettings;
  onChange: (value: PartySettings) => void;
  disabled?: boolean;
  identity: DevelopmentIdentity;
  participantCount?: number;
  canEditPermissions?: boolean;
  catalog?: { id: string; title: string; difficulty: string; hasComplexity?: boolean }[];
}) {
  const [problems, setProblems] = useState<
    { id: string; title: string; difficulty: string; hasComplexity?: boolean }[]
  >(catalog ?? []);
  const [catalogError, setCatalogError] = useState<string>();
  useEffect(() => {
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
  }, [identity, catalog]);
  const [pickedProblem, setPickedProblem] = useState<ProblemVersion>();
  const pools = value.difficulties ?? [value.difficulty ?? "easy"];
  const selectedProblem =
    problems.find((problem) => problem.id === value.selectedProblemVersionId) ??
    (pickedProblem?.id === value.selectedProblemVersionId ? pickedProblem : undefined);
  const changeDifficulties = (difficulties: typeof pools) => {
    onChange({
      ...value,
      difficulty: undefined,
      difficulties,
      selectedProblemVersionId:
        selectedProblem &&
        !difficulties.includes(selectedProblem.difficulty as (typeof pools)[number])
          ? undefined
          : value.selectedProblemVersionId,
    });
  };
  const rules = value.rules ?? matchPreset();
  return (
    <div className="match-options">
      <div className="match-option">
        <span>
          <Swords />
          Game mode
        </span>
        <div className="match-difficulty match-modes" role="group" aria-label="Game mode">
          {(["showdown", "free-for-all"] as const).map((mode) => (
            <Tooltip
              key={mode}
              content={
                mode === "showdown" && participantCount > 2
                  ? "Showdown needs two players or fewer"
                  : mode === "showdown"
                    ? "Two players"
                    : "Up to eight players"
              }
            >
              <button
                type="button"
                disabled={disabled || (mode === "showdown" && participantCount > 2)}
                aria-pressed={(value.mode ?? "showdown") === mode}
                onClick={() => onChange({ ...value, mode })}
              >
                <ModeIcon mode={mode} />
                {mode === "showdown" ? "Showdown" : "Free-for-all"}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="match-option difficulty-option">
        <span>
          <Gauge />
          Difficulty
        </span>
        <DifficultySegments
          selected={pools}
          onChange={changeDifficulties}
          required
          disabled={disabled}
        />
      </div>
      <div className="match-option">
        <span>
          <BookOpen />
          Problem
        </span>
        <NoticeRegion message={catalogError} label="Problem list unavailable">
          <ProblemPicker
            items={problems.filter((problem) =>
              pools.includes(problem.difficulty as (typeof pools)[number]),
            )}
            identity={identity}
            difficulties={pools}
            filters={value.questionFilters}
            onFiltersChange={(questionFilters) => onChange({ ...value, questionFilters })}
            value={value.selectedProblemVersionId}
            disabled={disabled}
            allowRandom
            onChange={(selectedProblemVersionId, problem) => {
              setPickedProblem(problem);
              onChange({ ...value, difficulties: pools, selectedProblemVersionId });
            }}
          />
        </NoticeRegion>
      </div>
      <div className="match-option">
        <span>
          <Icon name="clock" />
          Duration
        </span>
        <SelectField
          className="match-choice"
          label="Duration"
          value={String(value.durationMinutes)}
          disabled={disabled}
          onChange={(duration) =>
            onChange({
              ...value,
              durationMinutes: Number(duration) as PartySettings["durationMinutes"],
            })
          }
          options={[15, 30, 45, 60].map((minutes) => ({
            value: String(minutes),
            label: `${minutes} minutes`,
          }))}
        />
      </div>
      <MatchRuleSettingsControls
        value={rules}
        disabled={disabled}
        canEditPermissions={canEditPermissions}
        onChange={(rules) => onChange({ ...value, rules })}
      />
    </div>
  );
}
