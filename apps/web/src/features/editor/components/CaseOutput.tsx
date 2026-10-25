import { useQuestionLanguage } from "../QuestionLanguage";
import { questionValue } from "../questionTypes";
import { Tooltip } from "./Tooltip";
import type { PublicCaseResult } from "@quorem/contracts";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function verdictTone(status?: string) {
  return status === "accepted"
    ? "verdict-success"
    : status && status !== "executed"
      ? "verdict-error"
      : "verdict-neutral";
}

export function CaseValue({
  name,
  value,
  purpose = "input",
  parameter = false,
  tone,
  type,
}: {
  name: string;
  value: unknown;
  purpose?: "input" | "output" | "target";
  parameter?: boolean;
  tone?: string;
  type?: string;
}) {
  const language = useQuestionLanguage();
  return (
    <div className="case-detail">
      <span className={parameter ? "parameter-name" : undefined}>{name}</span>
      <div className="case-value-row">
        <Tooltip content={purpose === "input" ? "Input" : name}>
          <span
            tabIndex={0}
            className="field-purpose"
            aria-label={purpose === "input" ? "Input" : name}
          >
            <Icon name={purpose} />
          </span>
        </Tooltip>
        <code className={`machine-value ${tone ?? ""}`}>
          {questionValue(value, language, type)}
        </code>
      </div>
    </div>
  );
}

export function CaseOutput({
  result,
  showExpected = true,
}: {
  result: PublicCaseResult;
  showExpected?: boolean;
}) {
  const tone = verdictTone(result.status);
  return (
    <div className="case-run-output">
      <span className={`case-verdict ${tone}`}>{result.status.replaceAll("_", " ")}</span>
      {result.actual !== undefined && (
        <CaseValue name="Output" purpose="output" value={result.actual} tone={tone} />
      )}
      {showExpected && result.expected !== undefined && (
        <CaseValue
          name="Expected output"
          purpose="target"
          value={result.expected}
          tone="verdict-success"
        />
      )}
      {(!!result.stdout?.trim() || !!result.stderr?.trim()) && (
        <ConsoleSection label="Standard output">
          {!!result.stdout?.trim() && (
            <span className="console-stream" aria-label="stdout">
              {result.stdout}
            </span>
          )}
          {!!result.stderr?.trim() && (
            <span className="console-stream console-error" aria-label="stderr">
              {result.stderr}
            </span>
          )}
        </ConsoleSection>
      )}
      {!!result.diagnostics?.length && (
        <ConsoleSection label="Diagnostics">
          {result.diagnostics.map((item, index) => (
            <div key={index}>
              {item.line ? `Line ${item.line}: ` : ""}
              {item.message}
            </div>
          ))}
        </ConsoleSection>
      )}
    </div>
  );
}

function ConsoleSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="case-console" aria-label={label}>
      <span>{label}</span>
      <div className="console-value-row">
        <Tooltip content={label}>
          <span tabIndex={0} className="field-purpose" aria-label={label}>
            <Icon name="terminal" />
          </span>
        </Tooltip>
        <pre>{children}</pre>
      </div>
    </section>
  );
}
