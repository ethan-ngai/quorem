/** @file SequenceCaseValues.tsx @description Stateful calls use the shared test-value presentation. @module editor */
import type { ProblemVersion, MethodCall } from "@quorem/contracts";
import { bindArguments } from "../argumentBinding";
import { CaseValue } from "./CaseOutput";

export function SequenceCaseValues({
  problem,
  calls,
  outputLabel = "Expected output",
}: {
  problem: Pick<ProblemVersion, "odyssey" | "signature">;
  calls: MethodCall[];
  outputLabel?: "Expected output" | "Output";
}) {
  const methods = problem.odyssey?.levels.flatMap((level) => level.methods) ?? [problem.signature];
  return (
    <>
      {calls.map((call, index) => {
        const signature = methods.find((method) => method.methodName === call.methodName);
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
            {signature?.returnType !== "void" && call.expected !== undefined && (
              <CaseValue
                name={outputLabel}
                purpose={outputLabel === "Output" ? "output" : "target"}
                value={call.expected}
                type={signature?.returnType}
                tone={outputLabel === "Output" ? undefined : "verdict-success"}
              />
            )}
          </section>
        );
      })}
    </>
  );
}
