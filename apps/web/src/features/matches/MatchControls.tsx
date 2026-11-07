import { Disclosure } from "../../ui/Disclosure";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { PersistentNotice } from "../../ui/PersistentNotice";
import { DifficultySegments } from "../../ui/DifficultySegments";
import { matchPreset } from "@quorem/contracts/match-rules";
import { MatchRuleSettingsControls } from "./MatchRuleSettings";
import { useSession } from "../auth/session";
import { ProblemPicker } from "../practice/ProblemPicker";
import { SelectField } from "../../ui/SelectField";
import { SegmentedControl } from "../../ui/SegmentedControl";
import type { PartySettings, DevelopmentIdentity, ProblemVersion } from "@quorem/contracts";
import { useEffect, useState } from "react";
import { api, requireData } from "../../api/client";
import { Swords, Gauge, BookOpen, Clock, Users, Code2 } from "lucide-react";
import { ModeIcon } from "./ModeIcon";

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
    <div className="match-options lobby-settings">
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
            label:
              mode === "showdown" ? "Showdown" : mode === "factions" ? "Factions" : "Free-for-all",
            icon: <ModeIcon mode={mode} />,
            disabled: mode === "showdown" && participantCount > 2,
            hint: mode === "showdown" ? "Two players or fewer" : "Up to eight players",
          }))}
          onChange={(mode) => onChange({ ...value, mode })}
        />
      </div>
      <div className="match-option difficulty-option">
        <span>
          <Gauge size={16} aria-hidden="true" />
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
          <BookOpen size={16} aria-hidden="true" />
          Problem
          <PersistentNotice message={catalogError} label="Problem list unavailable" />
        </span>
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
          discloseFilters
          onChange={(selectedProblemVersionId, problem) => {
            setPickedProblem(problem);
            onChange({ ...value, difficulties: pools, selectedProblemVersionId });
          }}
        />
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
            onChange({
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
        onChange={(rules) => onChange({ ...value, rules })}
      />
      <Disclosure title="Lobby options">
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
              onChange({
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
            onChange={(shareCodeAfterMatch) => onChange({ ...value, shareCodeAfterMatch })}
          />
        </div>
      </Disclosure>
    </div>
  );
}
