/** @file MatchControls.tsx @description Shared private match settings and local identity selection. @module matches */
import type { CreateMatchRequest, DevelopmentIdentity } from "@quorem/contracts";
import { useEffect, useState } from "react";
import { readPreference, writePreference } from "../editor/editorSettings";

/** @returns A persisted local account and its setter. */
export function useLocalIdentity() {
  const [identity, setIdentity] = useState<DevelopmentIdentity>(() =>
    readPreference("quorem.dev-identity.v1", "alice"),
  );
  useEffect(() => writePreference("quorem.dev-identity.v1", identity), [identity]);
  return { identity, setIdentity };
}

/** @returns Difficulty and duration controls reused by create and host settings. */
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
    <div className="match-settings">
      <label>
        Difficulty
        <select
          value={value.difficulty}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...value, difficulty: e.target.value as CreateMatchRequest["difficulty"] })
          }
        >
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </label>
      <label>
        Duration
        <select
          value={value.durationMinutes}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...value,
              durationMinutes: Number(e.target.value) as CreateMatchRequest["durationMinutes"],
            })
          }
        >
          {[15, 30, 45, 60].map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} minutes
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** @returns An explicitly labeled local account chooser. */
export function IdentityChoice({
  identity,
  onChange,
}: {
  identity: DevelopmentIdentity;
  onChange: (identity: DevelopmentIdentity) => void;
}) {
  return (
    <label className="identity-choice">
      Local account
      <select
        aria-label="Local development identity"
        value={identity}
        onChange={(e) => onChange(e.target.value as DevelopmentIdentity)}
      >
        <option value="alice">Alice</option>
        <option value="bob">Bob</option>
      </select>
    </label>
  );
}
