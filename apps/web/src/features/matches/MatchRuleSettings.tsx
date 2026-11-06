/** @file MatchRuleSettings.tsx @description Preset-first rules with contextual policy costs. @module matches */
import {
  MATCH_PRESETS,
  matchPreset,
  selectedMatchPreset,
  type MatchRuleSettings,
} from "@quorem/contracts/match-rules";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Disclosure } from "../../ui/Disclosure";
import { Tooltip } from "../../ui/Tooltip";
import { Info } from "lucide-react";
import "./match-rules.css";
const titles = {
  casual: "Casual",
  balanced: "Balanced",
  strict: "Strict",
  tournament: "Tournament",
};
const descriptions = {
  casual: "Free assistance. Unrestricted submissions and clipboard.",
  balanced: "Paid assistance. Submission cooldown. Notify on paste and focus loss.",
  strict: "Paid assistance. Penalties for extra submissions, paste and focus loss.",
  tournament: "No assistance or paste. Stricter penalties and score-only feedback.",
  custom: "Custom policies and costs. Open rule details to review.",
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
}: {
  value: MatchRuleSettings;
  onChange: (value: MatchRuleSettings) => void;
  disabled?: boolean;
}) {
  const preset = selectedMatchPreset(value);
  const costKey = value.victory === "race" ? "seconds" : "points";
  const costUnit = value.victory === "race" ? "seconds" : "points";
  const costMax = value.victory === "race" ? 3600 : 100;
  const behaviorKey = value.victory === "race" ? "behavioralSeconds" : "behavioralPoints";
  const penalizesBehavior = [value.copy, value.clipboard, value.focus].includes("penalty");
  return (
    <section className="match-rule-settings" aria-label="Match rules">
      <div className="match-option">
        <span>
          Victory{" "}
          <Tooltip
            content={
              value.victory === "race"
                ? "First correct submission after time penalties wins. Highest eligible score wins at the time limit."
                : "Play until time runs out. Your best test score minus point penalties decides the winner."
            }
          >
            <button type="button" className="icon-button" aria-label="How victory works">
              <Info size={14} />
            </button>
          </Tooltip>
        </span>
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
      <div className="match-option">
        <span>Rules {preset === "custom" && <small>Custom</small>}</span>
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
      <p className="match-rule-description">{descriptions[preset]}</p>
      <Disclosure
        title={disabled ? "View rule details" : "Customize rules"}
        summary={value.victory === "race" ? "Time penalties" : "Point penalties"}
      >
        <fieldset className="match-rule-group">
          <legend>Assistance</legend>
          {Object.entries(assistance).map(([key, label]) => {
            const kind = key as keyof typeof assistance,
              policy = value.assistance[kind];
            return (
              <div className="match-rule-policy" key={kind}>
                <div className="match-option">
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
                {policy.access === "penalty" && (
                  <Amount
                    label={`${label} cost (${costUnit})`}
                    value={policy[costKey]}
                    max={costMax}
                    disabled={disabled}
                    onChange={(cost) =>
                      onChange({
                        ...value,
                        assistance: { ...value.assistance, [kind]: { ...policy, [costKey]: cost } },
                      })
                    }
                  />
                )}
              </div>
            );
          })}
          <div className="match-option">
            <span>Test feedback</span>
            <SegmentedControl
              compact
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
        </fieldset>
        <fieldset className="match-rule-group">
          <legend>Submissions</legend>
          <Amount
            label="Cooldown (seconds)"
            value={value.submissions.cooldownSeconds}
            max={300}
            disabled={disabled}
            onChange={(cooldownSeconds) =>
              onChange({ ...value, submissions: { ...value.submissions, cooldownSeconds } })
            }
          />
          <Amount
            label={`Extra submission cost (${costUnit})`}
            value={value.submissions[costKey]}
            max={costMax}
            disabled={disabled}
            onChange={(cost) =>
              onChange({ ...value, submissions: { ...value.submissions, [costKey]: cost } })
            }
          />
          {value.submissions[costKey] > 0 && (
            <Amount
              label="Free submissions before penalties"
              value={value.submissions.freeSubmissions}
              max={100}
              disabled={disabled}
              onChange={(freeSubmissions) =>
                onChange({ ...value, submissions: { ...value.submissions, freeSubmissions } })
              }
            />
          )}
          <p className="match-rule-description">
            Set a cost or cooldown to 0 to disable it. Runs stay free.
          </p>
        </fieldset>
        <fieldset className="match-rule-group">
          <legend>Conduct</legend>
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
          {penalizesBehavior && (
            <Amount
              label={`Conduct penalty (${costUnit})`}
              value={value[behaviorKey]}
              max={costMax}
              disabled={disabled}
              onChange={(cost) => onChange({ ...value, [behaviorKey]: cost })}
            />
          )}
          {value.focus !== "off" && (
            <Amount
              label="Focus grace (seconds)"
              value={value.focusGraceSeconds}
              max={60}
              disabled={disabled}
              onChange={(focusGraceSeconds) => onChange({ ...value, focusGraceSeconds })}
            />
          )}
          {value.focus === "penalty" && (
            <Amount
              label="Free focus warnings"
              value={value.focusFreeWarnings}
              max={10}
              disabled={disabled}
              onChange={(focusFreeWarnings) => onChange({ ...value, focusFreeWarnings })}
            />
          )}
          <p className="match-rule-description">
            Focus and clipboard rules use browser signals; external assistance cannot be reliably
            detected.
          </p>
        </fieldset>
      </Disclosure>
    </section>
  );
}
