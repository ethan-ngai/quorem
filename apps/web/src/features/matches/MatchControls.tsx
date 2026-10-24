import { useSession } from "../auth/session";
import { ProblemPicker } from "../practice/ProblemPicker";
import { SelectField } from "../../ui/SelectField";
import type { CreateMatchRequest, DevelopmentIdentity } from "@quorem/contracts";
import { useEffect, useState } from "react";
import { Clipboard, Focus, Gauge, Swords, BookOpen, Shield, Info } from "lucide-react";
import { api, requireData } from "../editor/api";
import { Tooltip } from "../editor/components/Tooltip";
import { FreeForAllIcon } from "./FreeForAllIcon";
import { Icon } from "../editor/components/Icon";

export function useAccountIdentity() {
  const account = useSession();
  return { identity: (account.data?.user.id ?? "anonymous") as DevelopmentIdentity, account };
}

export const defaultMatchSettings: CreateMatchRequest = {
  mode: "showdown",
  accessMode: "accounts_only",
  difficulties: ["easy"],
  durationMinutes: 30,
  rules: { clipboard: "off", focus: "off" },
};

export function ModeIcon({ mode }: { mode: CreateMatchRequest["mode"] }) {
  return mode === "free-for-all" ? (
    <FreeForAllIcon />
  ) : (
    <Swords size={18} strokeWidth={1.5} aria-hidden="true" />
  );
}

/** Shared creation/lobby controls; the server validates and resets readiness on edits. */
export function MatchSettings({
  value,
  onChange,
  disabled = false,
  identity,
  participantCount = 0,
  showHostRules = false,
  catalog,
}: {
  value: CreateMatchRequest;
  onChange: (value: CreateMatchRequest) => void;
  disabled?: boolean;
  identity: DevelopmentIdentity;
  participantCount?: number;
  showHostRules?: boolean;
  catalog?: { id: string; title: string; difficulty: string }[];
}) {
  const [problems, setProblems] = useState<{ id: string; title: string; difficulty: string }[]>(
    catalog ?? [],
  );
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
  const pools = value.difficulties ?? [value.difficulty ?? "easy"];
  const selectedProblem = problems.find((problem) => problem.id === value.selectedProblemVersionId);
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
  const rules = value.rules ?? { clipboard: "off", focus: "off" };
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
        <div
          className="match-difficulty difficulty-segments"
          role="group"
          aria-label="Difficulty filter"
        >
          {(["easy", "medium", "hard"] as const).map((difficulty) => (
            <button
              type="button"
              key={difficulty}
              aria-pressed={pools.includes(difficulty)}
              disabled={disabled || (pools.length === 1 && pools.includes(difficulty))}
              onClick={() =>
                changeDifficulties(
                  pools.includes(difficulty)
                    ? pools.filter((pool) => pool !== difficulty)
                    : [...pools, difficulty],
                )
              }
            >
              <span className={`difficulty-${difficulty}`}>
                {difficulty[0].toUpperCase() + difficulty.slice(1)}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="match-option">
        <span>
          <BookOpen />
          Problem
        </span>
        <ProblemPicker
          items={problems.filter((problem) =>
            pools.includes(problem.difficulty as (typeof pools)[number]),
          )}
          value={value.selectedProblemVersionId}
          disabled={disabled}
          allowRandom
          onChange={(selectedProblemVersionId) =>
            onChange({ ...value, difficulties: pools, selectedProblemVersionId })
          }
        />
      </div>
      {catalogError && (
        <p className="match-catalog-error" role="status">
          {catalogError}
        </p>
      )}
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
              durationMinutes: Number(duration) as CreateMatchRequest["durationMinutes"],
            })
          }
          options={[15, 30, 45, 60].map((minutes) => ({
            value: String(minutes),
            label: `${minutes} minutes`,
          }))}
        />
      </div>
      {showHostRules && (
        <>
          <div className="match-rules-heading">
            <Shield size={16} />
            <span>Host rules</span>
            <Tooltip content="Browser-observed activity; these rules are not tamper-proof.">
              <button type="button" className="icon-button" aria-label="About host rules">
                <Info size={16} />
              </button>
            </Tooltip>
          </div>
          {(["clipboard", "focus"] as const).map((rule) => (
            <div className="match-option" key={rule}>
              <span>
                {rule === "clipboard" ? <Clipboard /> : <Focus />}
                {rule === "clipboard" ? "Copy / paste" : "Leaving the window"}
              </span>
              <SelectField
                className="match-choice"
                label={rule === "clipboard" ? "Copy and paste rule" : "Window focus rule"}
                value={rules[rule] ?? "off"}
                disabled={disabled}
                onChange={(action) => onChange({ ...value, rules: { ...rules, [rule]: action } })}
                options={[
                  { value: "off", label: "Allow" },
                  { value: "warning", label: "Warn" },
                  { value: "announce", label: "Announce to lobby" },
                ]}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
