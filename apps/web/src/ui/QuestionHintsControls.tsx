import { Tags, Gauge } from "lucide-react";
import { ToggleSwitch } from "./ToggleSwitch";
import type { QuestionHints } from "@quorem/contracts";
import "./question-hints.css";

export function QuestionHintsControls({
  value,
  onChange,
  disabled = false,
  complexityAvailable = false,
}: {
  value: QuestionHints;
  onChange: (value: QuestionHints) => void;
  disabled?: boolean;
  complexityAvailable?: boolean;
}) {
  return (
    <fieldset className="question-hints-controls" disabled={disabled}>
      <legend>Question hints</legend>
      {(["topics", ...(complexityAvailable ? ["complexity" as const] : [])] as const).map((key) => (
        <label key={key}>
          <span>
            {key === "topics" ? (
              <Tags size={16} aria-hidden="true" />
            ) : (
              <Gauge size={16} aria-hidden="true" />
            )}
            {key === "topics" ? "Allow topics" : "Allow complexity"}
          </span>
          <ToggleSwitch
            label={key === "topics" ? "Allow topics" : "Allow complexity"}
            disabled={disabled}
            checked={key === "topics" ? value.topics !== false : value.complexity === true}
            onChange={(checked) => onChange({ ...value, [key]: checked })}
          />
        </label>
      ))}
    </fieldset>
  );
}
