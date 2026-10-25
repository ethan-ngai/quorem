import { ClipboardPaste, Focus } from "lucide-react";
import type { InterviewMonitoring } from "@quorem/contracts";
import { ToggleSwitch } from "../../ui/ToggleSwitch";

export function InterviewMonitoringControls({
  value,
  onChange,
  disabled = false,
}: {
  value: InterviewMonitoring;
  onChange: (value: InterviewMonitoring) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="question-hints-controls" disabled={disabled}>
      <legend>Interviewee monitoring</legend>
      {(["paste", "focus"] as const).map((key) => (
        <label key={key}>
          <span>
            {key === "paste" ? (
              <ClipboardPaste size={16} aria-hidden="true" />
            ) : (
              <Focus size={16} aria-hidden="true" />
            )}
            {key === "paste" ? "Code pasting" : "Leaving the window"}
          </span>
          <ToggleSwitch
            label={key === "paste" ? "Monitor code pasting" : "Monitor leaving the window"}
            checked={value[key] !== false}
            disabled={disabled}
            onChange={(checked) => onChange({ ...value, [key]: checked })}
          />
        </label>
      ))}
    </fieldset>
  );
}
