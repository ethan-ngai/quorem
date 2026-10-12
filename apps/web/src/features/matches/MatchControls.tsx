import * as Select from "@radix-ui/react-select";
import type { CreateMatchRequest, DevelopmentIdentity } from "@quorem/contracts";
import { useEffect, useState } from "react";
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

export function MatchSettings({
  value,
  onChange,
  disabled = false,
}: {
  value: CreateMatchRequest;
  onChange: (value: CreateMatchRequest) => void;
  disabled?: boolean;
}) {
  return (
    <div className="match-options">
      <div className="match-option">
        <span>
          <Icon name="target" />
          Difficulty
        </span>
        <div className="match-difficulty" role="group" aria-label="Difficulty">
          {(["easy", "medium", "hard"] as const).map((difficulty) => (
            <button
              type="button"
              key={difficulty}
              disabled={disabled}
              aria-pressed={value.difficulty === difficulty}
              onClick={() => onChange({ ...value, difficulty })}
            >
              {difficulty[0].toUpperCase() + difficulty.slice(1)}
            </button>
          ))}
        </div>
      </div>
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
        ]}
      />
    </div>
  );
}
