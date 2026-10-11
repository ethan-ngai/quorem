import * as Select from "@radix-ui/react-select";
import type { CreateMatchRequest, DevelopmentIdentity } from "@quorem/contracts";
import { useEffect, useState } from "react";
import {
  Clipboard,
  Focus,
  Shuffle,
  Swords,
  UsersRound,
  BookOpen,
  Shield,
  Info,
} from "lucide-react";
import { api, requireData } from "../editor/api";
import { Tooltip } from "../editor/components/Tooltip";
import { readPreference, writePreference } from "../editor/editorSettings";
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
  const Glyph = mode === "free-for-all" ? UsersRound : Swords;
  return <Glyph size={18} strokeWidth={1.5} aria-hidden="true" />;
}

/** Shared creation/lobby controls; the server validates and resets readiness on edits. */
export function MatchSettings({
  value,
  onChange,
  disabled = false,
  identity,
  participantCount = 0,
}: {
  value: CreateMatchRequest;
  onChange: (value: CreateMatchRequest) => void;
  disabled?: boolean;
  identity: DevelopmentIdentity;
  participantCount?: number;
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
      <div className="match-option">
        <span>
          <BookOpen />
          Problem
        </span>
        <MatchChoice
          label="Problem"
          value={value.selectedProblemVersionId ?? "random"}
          disabled={disabled}
          onChange={(id) =>
            onChange({
              ...value,
              difficulties: pools,
              selectedProblemVersionId: id === "random" ? undefined : id,
            })
          }
          options={[
            { value: "random", label: "Random from pools" },
            ...problems.map((problem) => ({ value: problem.id, label: problem.title })),
          ]}
        />
      </div>
      {catalogError && (
        <p className="match-catalog-error" role="status">
          {catalogError}
        </p>
      )}
      {!value.selectedProblemVersionId && (
        <div className="match-option">
          <span>
            <Shuffle />
            Pools
          </span>
          <div className="match-difficulty" role="group" aria-label="Problem pools">
            {(["easy", "medium", "hard"] as const).map((difficulty) => (
              <button
                type="button"
                key={difficulty}
                disabled={disabled || (pools.length === 1 && pools.includes(difficulty))}
                aria-pressed={pools.includes(difficulty)}
                onClick={() =>
                  onChange({
                    ...value,
                    difficulty: undefined,
                    difficulties: pools.includes(difficulty)
                      ? pools.filter((pool) => pool !== difficulty)
                      : [...pools, difficulty],
                  })
                }
              >
                {difficulty[0].toUpperCase() + difficulty.slice(1)}
              </button>
            ))}
          </div>
        </div>
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
      <div className="match-rules-heading">
        <Shield size={16} />
        <span>Host rules</span>
        <Tooltip content="Browser-observed activity; these rules are not tamper-proof. Cooldowns block submissions for 30 seconds.">
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
              { value: "cooldown", label: "30-second cooldown" },
              { value: "announce", label: "Announce to lobby" },
            ]}
          />
        </div>
      ))}
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
