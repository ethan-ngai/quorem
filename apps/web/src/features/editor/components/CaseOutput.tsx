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
}: {
  name: string;
  value: unknown;
  purpose?: "input" | "output" | "target";
  parameter?: boolean;
  tone?: string;
}) {
  return (
    <div className="case-detail">
      <span className={parameter ? "parameter-name" : undefined}>{name}</span>
      <div className="case-value-row">
        <span
          className="field-purpose"
          title={purpose === "input" ? "Input" : name}
          aria-label={purpose === "input" ? "Input" : name}
        >
          <Icon name={purpose} />
        </span>
        <code className={`machine-value ${tone ?? ""}`}>{JSON.stringify(value)}</code>
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
      {result.stdout && <ConsoleSection label="Standard output">{result.stdout}</ConsoleSection>}
      {result.stderr && <ConsoleSection label="Standard error">{result.stderr}</ConsoleSection>}
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
      <pre>{children}</pre>
    </section>
  );
}
