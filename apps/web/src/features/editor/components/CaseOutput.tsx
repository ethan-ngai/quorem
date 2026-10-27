import "./machine-values.css";
import { SqlTables } from "./SqlTables";
import { bindArguments } from "../argumentBinding";
import type { MethodCall, ProblemVersion, Signature } from "@quorem/contracts";
import { useQuestionLanguage } from "../QuestionLanguage";
import { questionValue } from "../questionTypes";
import { Tooltip } from "../../../ui/Tooltip";
import type { PublicCaseResult } from "@quorem/contracts";
import type { ReactNode } from "react";
import { Icon } from "../../../ui/Icon";

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
  sql,
  sqlTypes,
}: {
  name: string;
  value: unknown;
  purpose?: "input" | "output" | "target";
  parameter?: boolean;
  tone?: string;
  type?: string;
  sql?: ProblemVersion["sql"];
  sqlTypes?: readonly string[];
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
        {sql ? (
          <SqlTables
            value={value}
            input={purpose === "input"}
            label={name}
            schema={sql}
            columnTypes={sqlTypes}
            useSchemaTypes={purpose !== "output"}
          />
        ) : (
          <code className={`machine-value ${tone ?? ""}`}>
            {questionValue(value, language, type)}
          </code>
        )}
      </div>
    </div>
  );
}

export function CaseOutput({
  result,
  showExpected = true,
  sequence,
  sql,
}: {
  result: PublicCaseResult;
  showExpected?: boolean;
  sql?: ProblemVersion["sql"];
  sequence?: { calls: readonly MethodCall[]; methods: readonly Signature[] };
}) {
  const tone = verdictTone(result.status);
  return (
    <div className="case-run-output">
      <span className={`case-verdict ${tone}`}>{result.status.replaceAll("_", " ")}</span>
      {sequence ? (
        sequence.calls.map((call, index) => {
          const signature = sequence.methods.find(
            (method) => method.methodName === call.methodName,
          );
          const actual = Array.isArray(result.actual) ? result.actual[index] : undefined;
          const expected = Array.isArray(result.expected) ? result.expected[index] : call.expected;
          const hasOutput = signature?.returnType !== "void";
          return (
            <section
              className="case-call-result"
              key={index}
              aria-label={`Call ${index + 1}: ${call.methodName}`}
            >
              <header className="case-call-heading">
                <span className="case-call-number">{index + 1}</span>
                <code>{call.methodName}</code>
              </header>
              <div className="case-call-inputs">
                {(signature
                  ? bindArguments(signature, call.args)
                  : call.args.map((value, index) => ({ name: `Argument ${index + 1}`, value }))
                ).map(({ name, value }) => (
                  <CaseValue key={name} name={name} value={value} parameter />
                ))}
                {!call.args.length && <span className="case-no-inputs">No arguments</span>}
              </div>
              {hasOutput && (actual !== undefined || (showExpected && expected !== undefined)) && (
                <div className="case-output-comparison">
                  {actual !== undefined && (
                    <CaseValue
                      name="Output"
                      purpose="output"
                      value={actual}
                      type={signature?.returnType}
                      tone={tone}
                    />
                  )}
                  {showExpected && expected !== undefined && (
                    <CaseValue
                      name="Expected"
                      purpose="target"
                      value={expected}
                      type={signature?.returnType}
                      tone="verdict-success"
                    />
                  )}
                </div>
              )}
            </section>
          );
        })
      ) : (
        <div className="case-output-comparison">
          {result.actual !== undefined && (
            <CaseValue
              name="Output"
              purpose="output"
              value={result.actual}
              tone={tone}
              sql={sql}
              sqlTypes={result.sqlTypes}
            />
          )}
          {showExpected && result.expected !== undefined && (
            <CaseValue
              name="Expected output"
              purpose="target"
              value={result.expected}
              tone="verdict-success"
              sql={sql}
            />
          )}
        </div>
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
