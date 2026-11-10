import { verdictIcon } from "./verdictPresentation";
import { CasePreviewLayout } from "./NodePreview";
import type { NodeContext } from "../nodeLiterals";
import "./machine-values.css";
import { CodeLiteral } from "./CodeLiteral";
import { SqlTables } from "./SqlTables";
import { bindArguments } from "../argumentBinding";
import type { MethodCall, PublishedQuestion, Signature } from "@quorem/contracts";
import { useQuestionLanguage } from "../QuestionLanguage";
import { questionValue } from "../questionTypes";
import { Tooltip } from "../../../ui/Tooltip";
import type { PublicCaseResult } from "@quorem/contracts";
import type { ReactNode } from "react";
import { Icon } from "../../../ui/Icon";
import { Spinner } from "../../../ui/Spinner";
import { useChangeMotion } from "../../../ui/useChangeMotion";

export function verdictTone(status?: string) {
  return status === "accepted"
    ? "verdict-success"
    : status && status !== "executed"
      ? "verdict-error"
      : "verdict-neutral";
}

/** Render feedback only for the selected case's admitted result. */
export function CaseVerdict({
  result,
  pending = false,
}: {
  result?: PublicCaseResult;
  pending?: boolean;
}) {
  const motion = useChangeMotion<HTMLDivElement>(pending ? "pending" : result?.status);
  const status = pending ? "judging test case" : result?.status.replaceAll("_", " ");
  if (!status) return null;
  const tone = verdictTone(pending ? undefined : result?.status);
  const label = `${status[0].toUpperCase()}${status.slice(1)}`;
  const stderr = pending ? "" : (result?.stderr ?? "");
  const hasStderr = !!stderr.trim();
  const messages =
    tone === "verdict-error"
      ? result?.diagnostics?.map(
          (item) =>
            `${item.line != null ? `Line ${item.line}${item.column != null ? `:${item.column}` : ""}: ` : ""}${item.message}`,
        )
      : undefined;
  return (
    <div ref={motion} className="case-verdict-group" aria-live="polite" aria-atomic="true">
      <div className="case-verdict-text">
        <span className={`case-verdict ${tone}`}>
          {pending ? <Spinner /> : <Icon name={verdictIcon(result?.status)} />}
          {label}
        </span>
        {(hasStderr || !!messages?.length) && (
          <code className="case-error-message">
            {hasStderr && <span aria-label="stderr">{stderr}</span>}
            {hasStderr && !!messages?.length && !stderr.endsWith("\n") && "\n"}
            {messages?.join("\n")}
          </code>
        )}
      </div>
    </div>
  );
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
  nodeContext,
}: {
  name: string;
  value: unknown;
  purpose?: "input" | "output" | "target";
  parameter?: boolean;
  tone?: string;
  type?: string;
  sql?: PublishedQuestion["sql"];
  sqlTypes?: readonly string[];
  nodeContext?: NodeContext;
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
          <CodeLiteral
            className={`machine-value ${tone ?? ""}${type?.includes("TreeNode") ? " node-tree-literal" : ""}`}
            source={questionValue(value, language, type, nodeContext)}
            language={language}
          />
        )}
      </div>
    </div>
  );
}

export function CaseArguments({
  signature,
  args,
  expected,
  actual,
  preview = true,
  children,
}: {
  signature?: Signature;
  args: readonly unknown[];
  expected?: unknown;
  actual?: unknown;
  preview?: boolean;
  children?: ReactNode;
}) {
  const inputs = signature
    ? bindArguments(signature, args)
    : args.map((value, index) => ({ name: `Argument ${index + 1}`, value, type: undefined }));
  return (
    <CasePreviewLayout
      enabled={preview}
      context={signature ? { signature, args: args as NodeContext["args"] } : undefined}
      expected={expected}
      actual={actual}
    >
      <div className="case-call-inputs">
        {inputs.map(({ name, value, type }) => (
          <CaseValue
            key={name}
            name={name}
            value={value}
            type={type}
            parameter
            nodeContext={signature ? { signature, args: args as NodeContext["args"] } : undefined}
          />
        ))}
        {!inputs.length && <span className="case-no-inputs">No arguments</span>}
      </div>
      {children}
    </CasePreviewLayout>
  );
}

export function CaseOutput({
  result,
  showExpected = true,
  sequence,
  sql,
  returnType,
  nodeContext,
  showVerdict = true,
  preview = true,
}: {
  result: PublicCaseResult;
  showExpected?: boolean;
  showVerdict?: boolean;
  preview?: boolean;
  returnType?: string;
  nodeContext?: NodeContext;
  sql?: PublishedQuestion["sql"];
  sequence?: { calls: readonly MethodCall[]; methods: readonly Signature[] };
}) {
  const tone = verdictTone(result.status);
  return (
    <div className="case-run-output">
      {showVerdict && <CaseVerdict result={result} />}
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
                <code className="code-function">{call.methodName}</code>
              </header>
              <CaseArguments
                signature={signature}
                args={call.args}
                expected={expected}
                actual={actual}
              >
                {hasOutput &&
                  (actual !== undefined || (showExpected && expected !== undefined)) && (
                    <div className="case-output-comparison">
                      {actual !== undefined && (
                        <CaseValue
                          name="Output"
                          purpose="output"
                          value={actual}
                          type={signature?.returnType}
                          nodeContext={signature ? { signature, args: call.args } : undefined}
                          tone={tone}
                        />
                      )}
                      {showExpected && expected !== undefined && (
                        <CaseValue
                          name="Expected"
                          purpose="target"
                          value={expected}
                          type={signature?.returnType}
                          nodeContext={signature ? { signature, args: call.args } : undefined}
                          tone="verdict-success"
                        />
                      )}
                    </div>
                  )}
              </CaseArguments>
            </section>
          );
        })
      ) : (
        <CasePreviewLayout
          enabled={preview}
          context={nodeContext}
          expected={result.expected}
          actual={result.actual}
        >
          <div className="case-output-comparison">
            {result.actual !== undefined && (
              <CaseValue
                name="Output"
                purpose="output"
                value={result.actual}
                type={returnType}
                nodeContext={nodeContext}
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
                type={returnType}
                nodeContext={nodeContext}
                tone="verdict-success"
                sql={sql}
              />
            )}
          </div>
        </CasePreviewLayout>
      )}
      {!!result.stdout?.trim() && (
        <ConsoleSection label="Standard output">
          <span aria-label="stdout">{result.stdout}</span>
        </ConsoleSection>
      )}
      {tone !== "verdict-error" && !!result.diagnostics?.length && (
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
