/** @file MatchRuleSettings.tsx @description Preset-first rules with contextual policy costs. @module matches */
import {
  MATCH_PRESETS,
  MAX_FREE_SUBMISSIONS,
  freeSubmissionsSchema,
  matchPreset,
  selectedMatchPreset,
  type MatchRuleSettings,
} from "@quorem/contracts/match-rules";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { SelectField } from "../../ui/SelectField";
import { TextInput } from "../../ui/TextControl";
import { inputConstraints } from "../../ui/input-constraints";
import { useChangeMotion } from "../../ui/useChangeMotion";
import { useEffect, useLayoutEffect, useState } from "react";
import { ChoiceMatrix } from "../../ui/ChoiceMatrix";
import { AnimatedRows } from "../../ui/AnimatedRows";
import { Disclosure } from "../../ui/Disclosure";
import { Tooltip } from "../../ui/Tooltip";
import {
  Info,
  Trophy,
  ChartNoAxesColumnIncreasing,
  SlidersHorizontal,
  Coffee,
  Scale,
  ShieldCheck,
  Medal,
  Tags,
  Timer,
  EyeOff,
  Copy,
  ClipboardPaste,
  PanelsTopLeft,
  Ban,
  CircleCheck,
  Bell,
  Hourglass,
  CircleMinus,
  Infinity as InfinityIcon,
} from "lucide-react";
import "./match-rules.css";
const titles = {
  casual: "Casual",
  balanced: "Balanced",
  strict: "Strict",
  tournament: "Tournament",
};
const presetIcons = {
  casual: <Coffee size={14} aria-hidden="true" />,
  balanced: <Scale size={14} aria-hidden="true" />,
  strict: <ShieldCheck size={14} aria-hidden="true" />,
  tournament: <Medal size={14} aria-hidden="true" />,
  custom: <SlidersHorizontal size={14} aria-hidden="true" />,
};
const allowanceNumber = inputConstraints.integer({ min: 0, max: MAX_FREE_SUBMISSIONS });
const allowanceConstraint = {
  ...allowanceNumber,
  edit: (text: string) => text === "∞" || allowanceNumber.edit(text),
};
const raceIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M4 22V3h16v12H4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    <path
      d="M4 3h4v4H4zm8 0h4v4h-4zM8 7h4v4H8zm8 0h4v4h-4zM4 11h4v4H4zm8 0h4v4h-4z"
      fill="currentColor"
    />
  </svg>
);
const assistanceIcons = {
  topics: <Tags size={16} aria-hidden="true" />,
  complexity: <Timer size={16} aria-hidden="true" />,
  hiddenCase: <EyeOff size={16} aria-hidden="true" />,
};
const descriptions = {
  casual: "Assistance without penalties; no submission cooldown.",
  balanced:
    "Assistance adds a penalty. Submissions have a cooldown. Paste and focus loss are announced.",
  strict:
    "Double assistance penalties. Extra submissions, paste and focus loss also add penalties.",
  tournament: "Assistance and paste disabled. Focus loss adds a penalty.",
  custom: "Rules have been customized. Expand Customize rules to review them.",
};
function RuleInfo({ label, children }: { label: string; children: string }) {
  return (
    <Tooltip content={children}>
      <button type="button" className="icon-button" aria-label={label}>
        <Info size={14} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
const assistance = {
  topics: "Topics",
  complexity: "Complexity",
  hiddenCase: "Hidden cases",
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
  const amount = useChangeMotion<HTMLInputElement>(`${label}:${value}`);
  useLayoutEffect(() => {
    if (amount.current) amount.current.value = String(value);
  }, [amount, value]);
  return (
    <label className="match-rule-amount">
      <span>{label}</span>
      <input
        ref={amount}
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
function SubmissionAllowance({
  value,
  disabled,
  onChange,
}: {
  value: number | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  const display = value === null ? "∞" : String(value);
  const amount = useChangeMotion<HTMLInputElement>(display);
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);

  return (
    <div className="match-rule-amount">
      <span>Submissions before penalties</span>
      <div className="match-rule-allowance">
        <TextInput
          ref={amount}
          aria-label="Submissions before penalties"
          inputMode="numeric"
          value={draft}
          disabled={disabled}
          constraint={allowanceConstraint}
          onFocus={(event) => {
            if (draft === "∞") event.currentTarget.select();
          }}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => {
            const result = freeSubmissionsSchema.safeParse(
              draft === "∞" ? null : draft === "" ? undefined : Number(draft),
            );
            if (result.success && result.data !== value) onChange(result.data);
            else setDraft(display);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setDraft(display);
            }
          }}
        />
        <Tooltip content="Unlimited submissions before penalties">
          <button
            type="button"
            className="icon-button"
            aria-label="Unlimited submissions before penalties"
            aria-pressed={value === null}
            disabled={disabled}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              setDraft("∞");
              if (value !== null) onChange(null);
            }}
          >
            <InfinityIcon size={16} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </div>
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
  const assistancePenalties = (Object.keys(assistance) as (keyof typeof assistance)[]).filter(
    (kind) => value.assistance[kind].access === "penalty",
  );
  const conductAmounts = [
    {
      key: "conduct",
      show: [value.copy, value.clipboard, value.focus].includes("penalty"),
      label: `Conduct penalty (${costUnit})`,
      value: value[behaviorKey],
      max: costMax,
      onChange: (cost: number) => onChange({ ...value, [behaviorKey]: cost }),
    },
    {
      key: "grace",
      show: value.focus !== "off",
      label: "Focus grace (seconds)",
      value: value.focusGraceSeconds,
      max: 60,
      onChange: (focusGraceSeconds: number) => onChange({ ...value, focusGraceSeconds }),
    },
    {
      key: "warnings",
      show: value.focus === "penalty",
      label: "Warnings before penalties",
      value: value.focusFreeWarnings,
      max: 10,
      onChange: (focusFreeWarnings: number) => onChange({ ...value, focusFreeWarnings }),
    },
  ].filter((field) => field.show);
  const penaltyIcon =
    value.victory === "race" ? (
      <Hourglass size={14} aria-hidden="true" />
    ) : (
      <CircleMinus size={14} aria-hidden="true" />
    );
  return (
    <section className="match-rule-settings" aria-label="Match rules">
      <div className="match-option">
        <span>
          <Trophy size={16} aria-hidden="true" />
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
            { value: "race", label: "Race", icon: raceIcon },
            {
              value: "high_score",
              label: "High Score",
              icon: <ChartNoAxesColumnIncreasing size={14} aria-hidden="true" />,
            },
          ]}
          onChange={(victory) => onChange({ ...value, victory })}
        />
      </div>
      <div className="match-option">
        <span>
          <SlidersHorizontal size={16} aria-hidden="true" />
          Rules
          <RuleInfo label="About this preset">{descriptions[preset]}</RuleInfo>
        </span>
        <SelectField
          label="Rules preset"
          value={preset}
          disabled={disabled}
          options={[
            ...(preset === "custom"
              ? [{ value: "custom", label: "Custom", leading: presetIcons.custom }]
              : []),
            ...MATCH_PRESETS.map((name) => ({
              value: name,
              label: titles[name],
              leading: presetIcons[name],
            })),
          ]}
          onChange={(name) => {
            if (name !== "custom")
              onChange({
                ...matchPreset(name as (typeof MATCH_PRESETS)[number]),
                victory: value.victory,
                settingsEditors: value.settingsEditors,
              });
          }}
        />
      </div>
      <Disclosure title={disabled ? "View rule details" : "Customize rules"}>
        <fieldset className="match-rule-group">
          <legend>Assistance</legend>
          <ChoiceMatrix
            label="Assistance policies"
            disabled={disabled}
            columns={[
              { value: "blocked", label: "Disabled", icon: <Ban size={14} aria-hidden="true" /> },
              { value: "penalty", label: "With penalty", icon: penaltyIcon },
              {
                value: "free",
                label: "Allowed",
                icon: <CircleCheck size={14} aria-hidden="true" />,
              },
            ]}
            rows={Object.entries(assistance).map(([key, label]) => {
              const kind = key as keyof typeof assistance;
              return {
                key: kind,
                label,
                icon: assistanceIcons[kind],
                value: value.assistance[kind].access,
              };
            })}
            onChange={(kind, access) =>
              onChange({
                ...value,
                assistance: { ...value.assistance, [kind]: { ...value.assistance[kind], access } },
              })
            }
          />
          <AnimatedRows
            className="match-rule-dependent-fields"
            items={assistancePenalties}
            getKey={(kind) => kind}
            renderRow={(kind) => {
              const policy = value.assistance[kind];
              return (
                <Amount
                  label={`${assistance[kind]} penalty (${costUnit})`}
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
              );
            }}
          />
        </fieldset>
        <fieldset className="match-rule-group">
          <legend>
            Submissions{" "}
            <RuleInfo label="About submission penalties">
              {
                "0 disables the penalty or cooldown. ∞ means submissions never add a penalty. Runs have no penalty."
              }
            </RuleInfo>
          </legend>
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
            label={`Extra submission penalty (${costUnit})`}
            value={value.submissions[costKey]}
            max={costMax}
            disabled={disabled}
            onChange={(cost) =>
              onChange({ ...value, submissions: { ...value.submissions, [costKey]: cost } })
            }
          />
          <AnimatedRows
            className="match-rule-dependent-fields"
            items={value.submissions[costKey] > 0 ? ["allowance"] : []}
            renderRow={() => (
              <SubmissionAllowance
                value={value.submissions.freeSubmissions}
                disabled={disabled}
                onChange={(freeSubmissions) =>
                  onChange({ ...value, submissions: { ...value.submissions, freeSubmissions } })
                }
              />
            )}
          />
        </fieldset>
        <fieldset className="match-rule-group">
          <legend>
            Conduct{" "}
            <RuleInfo label="About conduct rules">
              {
                "Copy and paste can be blocked; leaving the window can only trigger a warning. Notify announces the event to players. Browser signals cannot reliably detect external assistance."
              }
            </RuleInfo>
          </legend>
          <ChoiceMatrix
            label="Conduct policies"
            disabled={disabled}
            columns={[
              { value: "off", label: "Allow", icon: <CircleCheck size={14} aria-hidden="true" /> },
              { value: "warning", label: "Restrict", icon: <Ban size={14} aria-hidden="true" /> },
              { value: "announce", label: "Notify", icon: <Bell size={14} aria-hidden="true" /> },
              { value: "penalty", label: "Penalize", icon: penaltyIcon },
            ]}
            rows={[
              {
                key: "copy",
                label: "Copy",
                icon: <Copy size={16} aria-hidden="true" />,
                value: value.copy,
                labels: { warning: "Block" },
              },
              {
                key: "clipboard",
                label: "Paste",
                icon: <ClipboardPaste size={16} aria-hidden="true" />,
                value: value.clipboard,
                labels: { warning: "Block" },
              },
              {
                key: "focus",
                label: "Leave window",
                icon: <PanelsTopLeft size={16} aria-hidden="true" />,
                value: value.focus,
                labels: { warning: "Warn" },
              },
            ]}
            onChange={(kind, action) => onChange({ ...value, [kind]: action })}
          />
          <AnimatedRows
            className="match-rule-dependent-fields"
            items={conductAmounts}
            getKey={(field) => field.key}
            renderRow={({ label, value, max, onChange }) => (
              <Amount {...{ label, value, max, onChange, disabled }} />
            )}
          />
        </fieldset>
      </Disclosure>
    </section>
  );
}
