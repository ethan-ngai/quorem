/** @file MatchRuleSettings.tsx @description Shared match presets and editable rule policies. @module matches */
import {
  MATCH_PRESETS,
  matchPreset,
  selectedMatchPreset,
  type MatchRuleSettings,
} from "@quorem/contracts/match-rules";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import "./match-rules.css";
const titles = {
  casual: "Casual",
  balanced: "Balanced",
  strict: "Strict",
  tournament: "Tournament",
};
const assistance = {
  topics: "Topics",
  complexity: "Complexity",
  hiddenCase: "Failed hidden cases",
} as const;
function Amount({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="match-rule-amount">
      <span>{label}</span>
      <input
        key={value}
        aria-label={label}
        type="number"
        min={0}
        max={max}
        step={1}
        defaultValue={value}
        disabled={disabled}
        onBlur={(event) => {
          const next = Number(event.currentTarget.value);
          if (
            event.currentTarget.value !== "" &&
            Number.isInteger(next) &&
            next >= 0 &&
            next <= max
          ) {
            if (next !== value) onChange(next);
          } else event.currentTarget.value = String(value);
        }}
      />
    </label>
  );
}
export function MatchRuleSettingsControls({
  value,
  onChange,
  disabled = false,
  canEditPermissions = true,
}: {
  value: MatchRuleSettings;
  onChange: (value: MatchRuleSettings) => void;
  disabled?: boolean;
  canEditPermissions?: boolean;
}) {
  const preset = selectedMatchPreset(value);
  return (
    <section className="match-rule-settings" aria-label="Match rules">
      <div className="match-option">
        <span>Victory</span>
        <SegmentedControl
          label="Victory rule"
          value={value.victory}
          disabled={disabled}
          options={[
            { value: "race", label: "Race" },
            { value: "high_score", label: "High Score" },
          ]}
          onChange={(victory) => onChange({ ...value, victory })}
        />
      </div>
      <p className="match-rule-description">
        {value.victory === "race"
          ? "First eligible correct submission wins. Penalties delay results; highest eligible score wins at time limit."
          : "Play until time runs out. Your best test score minus penalties decides the winner."}
      </p>
      <div className="match-option">
        <span>Rules preset {preset === "custom" && <small>Custom</small>}</span>
        <SegmentedControl
          label="Rules preset"
          value={preset}
          disabled={disabled}
          options={MATCH_PRESETS.map((name) => ({ value: name, label: titles[name] }))}
          onChange={(name) => {
            if (name !== "custom")
              onChange({
                ...matchPreset(name),
                victory: value.victory,
                settingsEditors: value.settingsEditors,
              });
          }}
        />
      </div>
      <div className="match-option">
        <span>Everyone can edit lobby settings</span>
        <ToggleSwitch
          label="Everyone can edit lobby settings"
          checked={value.settingsEditors === "everyone"}
          disabled={disabled || !canEditPermissions}
          onChange={(enabled) =>
            onChange({ ...value, settingsEditors: enabled ? "everyone" : "host" })
          }
        />
      </div>
      <div className="match-rule-policy-list">
        {Object.entries(assistance).map(([key, label]) => {
          const kind = key as keyof typeof assistance,
            policy = value.assistance[kind];
          return (
            <div className="match-option" key={kind}>
              <span>{label}</span>
              <SegmentedControl
                compact
                label={label}
                value={policy.access}
                disabled={disabled}
                options={[
                  { value: "blocked", label: "Disabled" },
                  { value: "penalty", label: "Paid" },
                  { value: "free", label: "Free" },
                ]}
                onChange={(access) =>
                  onChange({
                    ...value,
                    assistance: { ...value.assistance, [kind]: { ...policy, access } },
                  })
                }
              />
            </div>
          );
        })}
        {(["copy", "clipboard", "focus"] as const).map((kind) => {
          const label =
            kind === "clipboard" ? "Paste" : kind === "copy" ? "Copy" : "Leaving the window";
          return (
            <div className="match-option" key={kind}>
              <span>{label}</span>
              <SegmentedControl
                compact
                label={label}
                value={value[kind]}
                disabled={disabled}
                options={[
                  { value: "off", label: "Allow" },
                  { value: "warning", label: kind === "focus" ? "Warn" : "Block" },
                  { value: "announce", label: "Notify" },
                  { value: "penalty", label: "Penalize" },
                ]}
                onChange={(action) => onChange({ ...value, [kind]: action })}
              />
            </div>
          );
        })}
      </div>
      <details className="match-rule-advanced">
        <summary>Costs and advanced rules</summary>
        <div className="match-option">
          <span>Test feedback</span>
          <SegmentedControl
            label="Test feedback"
            value={value.feedback}
            disabled={disabled}
            options={[
              { value: "verdicts", label: "Case verdicts" },
              { value: "aggregate", label: "Score only" },
            ]}
            onChange={(feedback) => onChange({ ...value, feedback })}
          />
        </div>
        {Object.entries(assistance).map(([key, label]) => {
          const kind = key as keyof typeof assistance,
            policy = value.assistance[kind];
          return (
            <div className="match-rule-cost" key={kind}>
              <span>{label}</span>
              <Amount
                label={`${label} seconds`}
                value={policy.seconds}
                max={3600}
                disabled={disabled}
                onChange={(seconds) =>
                  onChange({
                    ...value,
                    assistance: { ...value.assistance, [kind]: { ...policy, seconds } },
                  })
                }
              />
              <Amount
                label={`${label} points`}
                value={policy.points}
                max={100}
                disabled={disabled}
                onChange={(points) =>
                  onChange({
                    ...value,
                    assistance: { ...value.assistance, [kind]: { ...policy, points } },
                  })
                }
              />
            </div>
          );
        })}
        <div className="match-rule-cost">
          <Amount
            label="Behavior penalty seconds"
            value={value.behavioralSeconds}
            max={3600}
            disabled={disabled}
            onChange={(behavioralSeconds) => onChange({ ...value, behavioralSeconds })}
          />
          <Amount
            label="Behavior penalty points"
            value={value.behavioralPoints}
            max={100}
            disabled={disabled}
            onChange={(behavioralPoints) => onChange({ ...value, behavioralPoints })}
          />
        </div>
        <div className="match-rule-cost">
          <Amount
            label="Focus grace seconds"
            value={value.focusGraceSeconds}
            max={60}
            disabled={disabled}
            onChange={(focusGraceSeconds) => onChange({ ...value, focusGraceSeconds })}
          />
          <Amount
            label="Free focus warnings"
            value={value.focusFreeWarnings}
            max={10}
            disabled={disabled}
            onChange={(focusFreeWarnings) => onChange({ ...value, focusFreeWarnings })}
          />
        </div>
        <div className="match-rule-cost">
          {(
            [
              ["cooldownSeconds", "Submission cooldown seconds", 300],
              ["freeSubmissions", "Free submissions", 100],
              ["seconds", "Extra submission seconds", 3600],
              ["points", "Extra submission points", 100],
            ] as const
          ).map(([key, label, max]) => (
            <Amount
              key={key}
              label={label}
              value={value.submissions[key]}
              max={max}
              disabled={disabled}
              onChange={(amount) =>
                onChange({ ...value, submissions: { ...value.submissions, [key]: amount } })
              }
            />
          ))}
        </div>
        <p className="match-rule-description">
          Seconds apply in Race; points in High Score. Each submission after the free allowance
          incurs its configured cost. Runs are free. Browser focus and clipboard monitoring is not
          tamper-proof.
        </p>
      </details>
    </section>
  );
}
