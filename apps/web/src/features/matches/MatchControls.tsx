import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import type { CreateMatchRequest, DevelopmentIdentity } from "@quorem/contracts";
import { useEffect, useRef, useState } from "react";
import {
  Clipboard,
  Focus,
  Gauge,
  Dices,
  Search,
  Swords,
  BookOpen,
  Shield,
  Info,
} from "lucide-react";
import { api, requireData } from "../editor/api";
import { Tooltip } from "../editor/components/Tooltip";
import { readPreference, writePreference } from "../editor/editorSettings";
import { FreeForAllIcon } from "./FreeForAllIcon";
import { Icon } from "../editor/components/Icon";

export function useLocalIdentity() {
  const [identity, setIdentity] = useState<DevelopmentIdentity>(() =>
    readPreference("quorem.dev-identity.v1", "alice"),
  );
  useEffect(() => writePreference("quorem.dev-identity.v1", identity), [identity]);
  return { identity, setIdentity };
}

function MatchChoice({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger className="settings-select" aria-label={label}>
        <Select.Value />
        <Select.Icon>
          <Icon name="chevron" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="settings-select-menu"
          position="popper"
          sideOffset={5}
          collisionPadding={8}
        >
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item className="settings-select-item" key={option.value} value={option.value}>
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Icon name="submit" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export const defaultMatchSettings: CreateMatchRequest = {
  mode: "showdown",
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
}: {
  value: CreateMatchRequest;
  onChange: (value: CreateMatchRequest) => void;
  disabled?: boolean;
  identity: DevelopmentIdentity;
  participantCount?: number;
  showHostRules?: boolean;
}) {
  const [problems, setProblems] = useState<{ id: string; title: string; difficulty: string }[]>([]);
  const [catalogError, setCatalogError] = useState<string>();
  useEffect(() => {
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
  }, [identity]);
  const pools = value.difficulties ?? [value.difficulty ?? "easy"];
  const [problemPickerOpen, setProblemPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const filteredProblems = problems.filter(
    (problem) =>
      pools.includes(problem.difficulty as (typeof pools)[number]) &&
      problem.title.toLowerCase().includes(search.trim().toLowerCase()),
  );
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
        <Popover.Root
          open={problemPickerOpen}
          onOpenChange={(open) => {
            setProblemPickerOpen(open);
            if (open) setSearch("");
          }}
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              className="settings-select problem-picker-trigger"
              disabled={disabled}
              aria-label="Problem"
            >
              <span>
                {!value.selectedProblemVersionId && <Dices size={16} />}
                {selectedProblem?.title ??
                  (value.selectedProblemVersionId ? "Selected problem" : "Random")}
              </span>
              <Icon name="chevron" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="problem-picker-popover"
              sideOffset={8}
              collisionPadding={12}
              align="end"
              aria-label="Choose problem"
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                searchInput.current?.focus();
              }}
            >
              <label className="problem-picker-search">
                <Search size={16} />
                <input
                  ref={searchInput}
                  aria-label="Search problems"
                  placeholder="Search problems"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <div className="problem-picker-results" role="group" aria-label="Matching problems">
                <button
                  type="button"
                  className="problem-picker-item"
                  aria-pressed={!value.selectedProblemVersionId}
                  onClick={() => {
                    onChange({
                      ...value,
                      difficulties: pools,
                      selectedProblemVersionId: undefined,
                    });
                    setProblemPickerOpen(false);
                  }}
                >
                  <Dices size={18} />
                  <span>Random</span>
                  {!value.selectedProblemVersionId && <Icon name="submit" />}
                </button>
                {filteredProblems.map((problem) => (
                  <button
                    type="button"
                    key={problem.id}
                    className="problem-picker-item"
                    aria-pressed={value.selectedProblemVersionId === problem.id}
                    onClick={() => {
                      onChange({
                        ...value,
                        difficulties: pools,
                        selectedProblemVersionId: problem.id,
                      });
                      setProblemPickerOpen(false);
                    }}
                  >
                    {value.selectedProblemVersionId === problem.id && <Icon name="submit" />}
                    <span>{problem.title}</span>
                    <small className={`difficulty-${problem.difficulty}`}>
                      {problem.difficulty}
                    </small>
                  </button>
                ))}
                {!filteredProblems.length && <p role="status">No matching problems</p>}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
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
        <MatchChoice
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
              <MatchChoice
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

export function IdentityChoice({
  identity,
  onChange,
  disabled = false,
}: {
  identity: DevelopmentIdentity;
  onChange: (identity: DevelopmentIdentity) => void;
  disabled?: boolean;
}) {
  return (
    <div className="identity-choice">
      <Icon name="people" />
      <MatchChoice
        label="Local development identity"
        value={identity}
        disabled={disabled}
        onChange={(value) => onChange(value as DevelopmentIdentity)}
        options={[
          { value: "alice", label: "Alice" },
          { value: "bob", label: "Bob" },
          { value: "charlie", label: "Charlie" },
          { value: "dana", label: "Dana" },
        ]}
      />
    </div>
  );
}
